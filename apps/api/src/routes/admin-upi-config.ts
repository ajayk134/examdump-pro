/**
 * Admin UPI configuration API (mounted under /admin-ops).
 *
 *   GET    /upi/config                 - current settings (never secrets)
 *   PATCH  /upi/config                 - payee VPA, payee name
 *   PATCH  /upi/config/switches        - payment acceptance, observer, auto-approve
 *   POST   /upi/config/payee/validate  - check a VPA before saving
 *   POST   /upi/config/gmail/start     - begin the Connect handshake
 *   GET    /upi/config/gmail/callback  - OAuth redirect target (public route)
 *   POST   /upi/config/gmail/test      - prove the stored credentials work
 *   DELETE /upi/config/gmail           - revoke and forget the connection
 *
 * Authorization is per route, matching `admin-upi.ts`:
 *   payments.read    - read the configuration
 *   payments.manage  - every mutation
 * Nothing here moves money. Approving a payment still goes through the existing
 * match route, and refunds still require `payments.refund`.
 *
 * No response in this file contains a secret. Credentials are reported only as
 * booleans ("a client secret is stored"), which is all the UI needs.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { requirePermission } from '../lib/guards.js';
import { parseOrThrow } from '../lib/validation.js';
import { badRequest } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { gmailOauthStates, upiObserverState } from '../db/schema/index.js';
import { recordAudit } from '../services/audit.service.js';
import { isValidVpa } from '../services/upi/uri.js';
import { isGmailObserverConfigured, resolveUpiConfig } from '../services/upi/config.service.js';
import {
  ConfigValidationError,
  clearGmailConnection,
  markGmailVerified,
  storeGmailConnection,
  updatePayee,
  updateSwitches,
} from '../services/upi/config-write.service.js';
import {
  OAuthError,
  consentUrl,
  consumeState,
  exchangeCode,
  fetchAccountEmail,
  issueState,
  redirectUri,
  revokeToken,
  verifyCredentials,
} from '../services/upi/gmail-oauth.service.js';

const payeeSchema = z.object({
  payeeVpa: z.string().max(320).nullable().optional(),
  payeeName: z.string().max(64).optional(),
});

const switchesSchema = z.object({
  paymentsEnabled: z.boolean().optional(),
  gmailEnabled: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  /**
   * Guard for the one switch that lets a bank email settle a payment unattended.
   * Typing the word is a deliberate speed bump, not a security control: the real
   * control is that enabling it requires a connected, enabled observer.
   */
  confirm: z.string().optional(),
});

const validateVpaSchema = z.object({ payeeVpa: z.string().max(320) });

/*
 * Both fields are optional. Omitting them means "use the credentials this server
 * is already configured with", which is the normal case: the operator set
 * UPI_GOOGLE_CLIENT_ID / UPI_GOOGLE_CLIENT_SECRET in Doppler.
 *
 * Before this, the dashboard demanded a hand-typed pair even when the server
 * held them, so the token exchange ran against whatever had been pasted into a
 * form. One wrong character produced a generic "connection could not be
 * completed" with no way to tell what had gone wrong.
 *
 * Empty strings are treated as absent so a blank form field is not a failure.
 */
const optionalCredential = z
  .string()
  .max(300)
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const startSchema = z.object({
  clientId: optionalCredential,
  clientSecret: optionalCredential,
});

/** Redeem the code, verify it, and store the encrypted result. */
async function completeConnection(
  env: Env,
  code: string,
  adminId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ email: string | null }> {
  const tokens = await exchangeCode(env, code, clientId, clientSecret);

  /* Prove the token works before storing it. A connection recorded as healthy
   * without ever having been used is the failure mode that looks fine in the UI
   * and drops every payment. */
  const check = await verifyCredentials(env, {
    clientId,
    clientSecret,
    refreshToken: tokens.refreshToken,
  });
  if (!check.ok) throw new OAuthError('verification_failed', check.message);

  const email = check.email ?? (await fetchAccountEmail(tokens.accessToken));

  await storeGmailConnection(
    env,
    {
      user: email ?? '',
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scope,
      connectedEmail: email ?? undefined,
    },
    adminId,
  );

  return { email };
}

/** Reduce a caller-supplied OAuth error marker to a short, safe identifier. */
function safeOAuthErrorCode(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const cleaned = raw.trim().toLowerCase();
  return /^[a-z0-9_.-]{1,40}$/.test(cleaned) ? cleaned : 'unknown';
}

export async function adminUpiConfigRoutes(app: FastifyInstance, env: Env): Promise<void> {
  /* ------------------------------------------------------------------ read */
  app.get('/upi/config', async (request) => {
    await requirePermission(request, env, 'payments.read');
    const config = await resolveUpiConfig(env, true);

    const db = getDb();
    const [observer] = await db
      .select()
      .from(upiObserverState)
      .where(eq(upiObserverState.id, 'gmail'))
      .limit(1);

    return {
      payee: { vpa: config.payeeVpa, name: config.payeeName, source: config.source.payeeVpa },
      switches: {
        paymentsEnabled: config.paymentsEnabled,
        gmailEnabled: config.gmailEnabled,
        autoApprove: config.autoApprove,
      },
      switchSource: {
        paymentsEnabled: config.source.paymentsEnabled,
        autoApprove: config.source.autoApprove,
        gmail: config.source.gmail,
      },
      gmail: {
        connected: Boolean(config.gmailRefreshToken && config.gmailClientId),
        observerConfigured: isGmailObserverConfigured(config),
        user: config.gmailUser,
        connectedEmail: config.gmailConnectedEmail,
        connectedAt: config.gmailConnectedAt?.toISOString() ?? null,
        scopes: config.gmailScopes,
        lastVerifiedAt: config.gmailLastVerifiedAt?.toISOString() ?? null,
        /* Presence only. The values themselves never leave the server. */
        hasClientSecret: Boolean(config.gmailClientSecret),
        hasRefreshToken: Boolean(config.gmailRefreshToken),
        /**
         * True when a usable client id/secret pair is already resolved on the
         * server, so the dashboard can default to using it instead of asking the
         * operator to paste one that is already configured.
         */
        serverCredentialsConfigured: Boolean(config.gmailClientId && config.gmailClientSecret),
        /**
         * Whether credentials can be stored at all. Without the encryption key
         * the Connect button is disabled here rather than failing after the
         * operator has already approved consent in Google.
         */
        canStoreCredentials: config.secretsUsable,
        lastPollAt: observer?.lastPollAt?.toISOString() ?? null,
        lastSuccessAt: observer?.lastSuccessAt?.toISOString() ?? null,
        lastError: observer?.lastError ?? null,
        consecutiveFailures: observer?.consecutiveFailures ?? 0,
      },
      redirectUri: redirectUri(env),
      source: config.source,
    };
  });

  /* ----------------------------------------------------------------- write */
  app.patch('/upi/config', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const input = parseOrThrow(payeeSchema, request.body);

    try {
      await updatePayee(env, input, auth.user.id);
    } catch (err) {
      if (err instanceof ConfigValidationError) throw badRequest(err.message);
      throw err;
    }

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'admin.upi_config_updated',
      targetType: 'upi_config',
      targetId: 'global',
      /* Field names only. Recording values would put the VPA in the audit log
       * and then in every export of it. */
      metadata: { fields: Object.keys(input) },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });

    return { ok: true };
  });

  app.patch('/upi/config/switches', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const input = parseOrThrow(switchesSchema, request.body);

    if (input.autoApprove === true && (input.confirm ?? '').trim().toUpperCase() !== 'CONFIRM') {
      throw badRequest(
        'Enabling automatic approval needs confirmation. Type CONFIRM to acknowledge that a bank email will settle payments without a human.',
      );
    }

    const { confirm: _confirm, ...patch } = input;
    try {
      await updateSwitches(env, patch, auth.user.id);
    } catch (err) {
      if (err instanceof ConfigValidationError) throw badRequest(err.message);
      throw err;
    }

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action:
        input.autoApprove !== undefined
          ? 'admin.upi_auto_approve_changed'
          : 'admin.upi_config_updated',
      targetType: 'upi_config',
      targetId: 'global',
      metadata: { switches: patch },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });

    return { ok: true };
  });

  /** Validate a VPA without saving it, so the field can warn before submit. */
  app.post('/upi/config/payee/validate', async (request) => {
    await requirePermission(request, env, 'payments.manage');
    const { payeeVpa } = parseOrThrow(validateVpaSchema, request.body);
    const trimmed = payeeVpa.trim();

    if (!trimmed) {
      return { valid: false, message: 'Enter the UPI ID that should receive payments.' };
    }
    if (!isValidVpa(trimmed)) {
      return {
        valid: false,
        message:
          'Not a valid UPI ID. It should look like name@bank, for example examdump@okhdfcbank.',
      };
    }
    /*
     * Format only. Confirming that money actually reaches this VPA requires a
     * real transfer, which Phase 3 does deliberately rather than pretending a
     * format check proves anything.
     */
    return {
      valid: true,
      message:
        'Format looks correct. Send a small test payment to confirm this UPI ID receives money.',
    };
  });

  /* ------------------------------------------------------------ gmail oauth */
  app.post('/upi/config/gmail/start', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const input = parseOrThrow(startSchema, request.body);

    if (!env.UPI_SECRETS_KEY) {
      throw badRequest(
        'UPI_SECRETS_KEY is not configured on the server, so credentials cannot be stored securely. Ask an operator to set it in Doppler first.',
      );
    }

    /*
     * Credentials: request body first, then whatever the server resolves.
     *
     * The body is still honoured so an operator can point at a different Google
     * project without a deploy. The common path supplies nothing and inherits
     * the deployment's own configuration, which is what the UI offers by
     * default. `resolveUpiConfig` prefers a dashboard-stored pair over the
     * environment, so all three sources line up with one precedence order.
     */
    const config = await resolveUpiConfig(env);
    const clientId = input.clientId ?? config.gmailClientId ?? undefined;
    const clientSecret = input.clientSecret ?? config.gmailClientSecret ?? undefined;

    if (!clientId || !clientSecret) {
      throw badRequest(
        'No Google OAuth client is configured. Set UPI_GOOGLE_CLIENT_ID and UPI_GOOGLE_CLIENT_SECRET on the server, or provide them here to use a different Google project.',
      );
    }

    /*
     * Held on the state row so the callback - which receives only a code - can
     * complete the exchange with exactly the values the consent screen was
     * started with. A different pair at that point would produce a confusing
     * Google error rather than an honest one.
     */
    const state = await issueState(env, auth.user.id, { clientId, clientSecret });

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'admin.upi_gmail_connect_started',
      targetType: 'upi_config',
      targetId: 'gmail',
      /* The tail only, enough to tell two clients apart without recording one. */
      metadata: {
        clientIdSuffix: clientId.slice(-12),
        credentialSource: input.clientId === undefined ? 'server' : 'request',
      },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });

    /*
     * Built with the submitted client id directly. An earlier version built the
     * URL from the environment client id and then overwrote the parameter, which
     * worked but meant the consent URL was correct only because of the override.
     */
    return {
      url: consentUrl(env, state, clientId),
      redirectUri: redirectUri(env),
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    };
  });

  /**
   * OAuth redirect target.
   *
   * Reached by the browser after Google redirects, so it cannot rely on an
   * admin session header being present: `state` is what proves the caller is the
   * admin who started the flow. Every outcome redirects back to the dashboard
   * with a status the UI can render, rather than rendering JSON in a browser tab.
   */
  app.get('/upi/config/gmail/callback', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const dashboard = (params: Record<string, string>) =>
      reply.redirect(`${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/admin?${new URLSearchParams(params)}`);

    if (query.error) {
      await recordAudit({
        action: 'admin.upi_gmail_connect_failed',
        targetType: 'upi_config',
        targetId: 'gmail',
        /*
         * `query.error` arrives from the caller and can be anything at all, so it
         * is reduced to a short identifier before being stored. A free-form value
         * from a URL should not become arbitrary text in the audit trail.
         */
        metadata: { code: safeOAuthErrorCode(query.error) },
        ip: request.ip,
      });
      return dashboard({ tab: 'upi', gmail: 'denied' });
    }

    if (!query.code || !query.state) {
      return dashboard({ tab: 'upi', gmail: 'invalid' });
    }

    let consumed: Awaited<ReturnType<typeof consumeState>>;
    try {
      consumed = await consumeState(env, query.state);
    } catch (err) {
      await recordAudit({
        action: 'admin.upi_gmail_connect_failed',
        targetType: 'upi_config',
        targetId: 'gmail',
        metadata: { reason: err instanceof OAuthError ? err.code : 'invalid_state' },
        ip: request.ip,
      });
      /* The state is the only thing preventing a prepared-link attack, so a bad
       * one is a hard stop: no exchange, no storage. */
      return dashboard({ tab: 'upi', gmail: 'bad_state' });
    }

    try {
      const { email } = await completeConnection(
        env,
        query.code,
        consumed.adminId,
        consumed.clientId,
        consumed.clientSecret,
      );
      await recordAudit({
        actorId: consumed.adminId,
        action: 'admin.upi_gmail_connected',
        targetType: 'upi_config',
        targetId: 'gmail',
        metadata: { email: email ?? null },
        ip: request.ip,
      });
      return dashboard({ tab: 'upi', gmail: 'connected' });
    } catch (err) {
      const message =
        err instanceof OAuthError ? err.message : 'The connection could not be completed.';

      /*
       * Record the stable error CODE, not just prose. The previous version stored
       * the sentence alone, so a failed exchange left nothing to diagnose beyond
       * "it did not work" - the operator could not tell a bad secret from a
       * rejected code or a missing scope.
       *
       * Only the code and the caller-supplied OAuth `error` value are recorded.
       * Neither carries a secret, an authorization code or a token.
       */
      await recordAudit({
        actorId: consumed.adminId,
        action: 'admin.upi_gmail_connect_failed',
        targetType: 'upi_config',
        targetId: 'gmail',
        metadata: {
          code: err instanceof OAuthError ? err.code : 'unexpected_error',
          reason: message.slice(0, 200),
        },
        ip: request.ip,
      });
      return dashboard({ tab: 'upi', gmail: 'failed', detail: message.slice(0, 160) });
    }
  });

  /** Prove the stored credentials still work. */
  app.post('/upi/config/gmail/test', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const config = await resolveUpiConfig(env, true);

    if (!config.gmailClientId || !config.gmailClientSecret || !config.gmailRefreshToken) {
      throw badRequest('No Gmail connection is stored yet. Connect the account first.');
    }

    const result = await verifyCredentials(env, {
      clientId: config.gmailClientId,
      clientSecret: config.gmailClientSecret,
      refreshToken: config.gmailRefreshToken,
    });

    if (result.ok) await markGmailVerified();

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'admin.upi_gmail_tested',
      targetType: 'upi_config',
      targetId: 'gmail',
      metadata: { ok: result.ok, email: result.email ?? null },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });

    return { ok: result.ok, message: result.message, email: result.email ?? null };
  });

  app.delete('/upi/config/gmail', async (request) => {
    const auth = await requirePermission(request, env, 'payments.manage');
    const config = await resolveUpiConfig(env, true);

    /* Revoke at Google first. Clearing only locally would leave a live token
     * that we have promised to destroy. */
    const revoked = config.gmailRefreshToken ? await revokeToken(config.gmailRefreshToken) : false;

    await clearGmailConnection(auth.user.id);

    await recordAudit({
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: 'admin.upi_gmail_disconnected',
      targetType: 'upi_config',
      targetId: 'gmail',
      metadata: { revokedAtGoogle: revoked },
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });

    return {
      ok: true,
      revokedAtGoogle: revoked,
      message: revoked
        ? 'Disconnected and access revoked at Google.'
        : 'Disconnected locally. Google did not confirm the revocation, so check myaccount.google.com/permissions.',
    };
  });
}