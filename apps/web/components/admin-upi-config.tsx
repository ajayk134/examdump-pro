'use client';

/**
 * Admin → UPI → Gateway settings.
 *
 * Lets an operator configure the integration from the dashboard instead of
 * editing environment variables and running an OAuth script on the host.
 *
 * Three deliberate constraints are visible in this UI rather than buried:
 *
 *  1. Collecting money and reading the mailbox are *separate* switches. That is
 *     what lets an operator prove detection works before opening checkout.
 *  2. Automatic approval is off, is not switched on by any other action, and
 *     requires typing a confirmation. It is the only setting here that can cause
 *     a payment to settle with no human involved.
 *  3. There is no "test payment" button. The only way to know a UPI ID receives
 *     money is to send money to it, and a fake notification would be teaching the
 *     operator to trust exactly the signal the risk engine distrusts.
 *
 * No credential is ever rendered. The API reports presence as booleans, and this
 * component has nothing else to display.
 */

import { useCallback, useEffect, useState } from 'react';
import { del, get, patch, post } from '@/lib/api';
import { useToast } from '@/components/providers';
import { Alert, Badge, Card, SectionTitle, Spinner } from '@/components/ui';

interface ConfigResponse {
  payee: { vpa: string | null; name: string; source: string };
  switches: { paymentsEnabled: boolean; gmailEnabled: boolean; autoApprove: boolean };
  switchSource: { paymentsEnabled: string; autoApprove: string; gmail: string };
  gmail: {
    connected: boolean;
    observerConfigured: boolean;
    user: string | null;
    connectedEmail: string | null;
    connectedAt: string | null;
    scopes: string | null;
    lastVerifiedAt: string | null;
    hasClientSecret: boolean;
    hasRefreshToken: boolean;
    serverCredentialsConfigured: boolean;
    canStoreCredentials: boolean;
    lastPollAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    consecutiveFailures: number;
  };
  redirectUri: string;
  source: { payeeVpa: string; paymentsEnabled: string; gmail: string; autoApprove: string };
}

/** "Setting comes from the environment" is worth saying out loud, once. */
function SourceNote({ source }: { source: string }) {
  if (source === 'db') return <span className="text-xs text-content-muted">set from this dashboard</span>;
  if (source === 'env') return <span className="text-xs text-content-muted">set on the server configuration</span>;
  return <span className="text-xs text-content-muted">not configured</span>;
}

function when(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function UpiGatewaySettings() {
  const { toast } = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [payeeVpa, setPayeeVpa] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [vpaMessage, setVpaMessage] = useState('');
  const [vpaValid, setVpaValid] = useState<boolean | null>(null);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  /* Default: use the pair the server already has. An operator only reaches for
   * the fields when pointing at a different Google project. */
  const [useCustomCredentials, setUseCustomCredentials] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await get<ConfigResponse>('/admin-ops/upi/config');
      setConfig(data);
      setPayeeVpa(data.payee.vpa ?? '');
      setPayeeName(data.payee.name ?? '');
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Surface the outcome of the OAuth redirect, which returns to /admin?... */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('gmail');
    if (!outcome) return;
    if (outcome === 'connected') toast('Gmail account connected.', 'success');
    else if (outcome === 'denied') toast('Access was not granted, so nothing was connected.', 'error');
    else if (outcome === 'bad_state')
      toast('That sign-in link was invalid or expired. Start the connection again.', 'error');
    else if (outcome === 'failed')
      toast(params.get('detail') ?? 'The connection could not be completed.', 'error');
    else if (outcome === 'invalid') toast('The sign-in response was incomplete.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }, [toast]);

  async function savePayee() {
    setBusy(true);
    try {
      await patch('/admin-ops/upi/config', { payeeVpa: payeeVpa.trim(), payeeName: payeeName.trim() });
      toast('Merchant UPI details saved.', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function validateVpa() {
    try {
      const result = await post<{ valid: boolean; message: string }>(
        '/admin-ops/upi/config/payee/validate',
        { payeeVpa },
      );
      setVpaValid(result.valid);
      setVpaMessage(result.message);
    } catch (err) {
      setVpaValid(false);
      setVpaMessage((err as Error).message);
    }
  }

  async function toggle(key: 'paymentsEnabled' | 'gmailEnabled' | 'autoApprove', value: boolean) {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { [key]: value };
      if (key === 'autoApprove' && value) payload.confirm = confirmText;
      await patch('/admin-ops/upi/config/switches', payload);
      toast('Setting updated.', 'success');
      setConfirmText('');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function startConnect() {
    setBusy(true);
    try {
      const custom = useCustomCredentials;
      const result = await post<{ url: string }>('/admin-ops/upi/config/gmail/start', {
        /* Omitted when using the server's own credentials; the API then resolves
         * them from the deployment configuration. */
        ...(custom ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : {}),
      });
      /* Full navigation, not a popup: Google blocks OAuth in embedded frames. */
      window.location.href = result.url;
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    try {
      const result = await post<{ ok: boolean; message: string; email: string | null }>(
        '/admin-ops/upi/config/gmail/test',
        {},
      );
      toast(result.message, result.ok ? 'success' : 'error');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect the payment mailbox? Automatic approval will also be turned off.')) {
      return;
    }
    setBusy(true);
    try {
      const result = await del<{ message: string }>('/admin-ops/upi/config/gmail');
      toast(result.message, 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load gateway settings">{error}</Alert>;
  if (!config) return null;

  const { gmail, switches } = config;
  const stale =
    gmail.lastSuccessAt && Date.now() - new Date(gmail.lastSuccessAt).getTime() > 15 * 60 * 1000;

  return (
    <div className="flex flex-col gap-5">
      <SectionTitle
        title="Gateway settings"
        subtitle="Configure the UPI integration without editing environment variables."
      />

      {/* ---------------------------------------------------------- payee */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-content-primary">Merchant UPI ID</h3>
          <SourceNote source={config.payee.source} />
        </div>
        <p className="mt-1 text-xs text-content-muted">
          The UPI ID that receives payments. Every order is sent here, so a wrong value sends money to
          the wrong account.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-content-secondary">UPI ID</span>
            <input
              className="input font-mono"
              value={payeeVpa}
              placeholder="yourname@okhdfcbank"
              onBlur={() => void (payeeVpa ? validateVpa() : null)}
              onChange={(e) => {
                setPayeeVpa(e.target.value);
                setVpaValid(null);
                setVpaMessage('');
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-content-secondary">Payee name shown to the payer</span>
            <input
              className="input"
              value={payeeName}
              placeholder="ExamDump"
              onChange={(e) => setPayeeName(e.target.value)}
            />
          </label>
        </div>

        {vpaMessage && (
          <p className={`mt-2 text-xs ${vpaValid ? 'text-content-secondary' : 'text-danger'}`}>
            {vpaMessage}
          </p>
        )}

        <div className="mt-3 flex justify-end">
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => void savePayee()}>
            Save UPI details
          </button>
        </div>
      </Card>

      {/* -------------------------------------------------------- switches */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-content-primary">Controls</h3>
        <p className="mt-1 text-xs text-content-muted">
          Collection and detection are separate on purpose: you can prove the mailbox works before
          accepting money.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={switches.paymentsEnabled}
              disabled={busy}
              onChange={(e) => void toggle('paymentsEnabled', e.target.checked)}
            />
            <span>
              <span className="font-medium text-content-primary">Accept UPI payments</span>
              <span className="block text-xs text-content-muted">
                Shows the UPI checkout to customers. Requires a saved UPI ID above.{' '}
                <SourceNote source={config.switchSource.paymentsEnabled} />
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={switches.gmailEnabled}
              disabled={busy || !gmail.connected}
              onChange={(e) => void toggle('gmailEnabled', e.target.checked)}
            />
            <span>
              <span className="font-medium text-content-primary">Watch the payment mailbox</span>
              <span className="block text-xs text-content-muted">
                {gmail.connected
                  ? 'Polls Gmail for bank alerts and tries to match them to open orders.'
                  : 'Connect a Gmail account first.'}{' '}
                <SourceNote source={config.switchSource.gmail} />
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-border p-3">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={switches.autoApprove}
                disabled={busy || !gmail.observerConfigured}
                onChange={(e) => void toggle('autoApprove', e.target.checked)}
              />
              <span>
                <span className="font-medium text-content-primary">Automatic approval</span>
                <span className="block text-xs text-content-muted">
                  When on, a matched bank alert settles the order and grants access with no human
                  review. Keep this off while testing.{' '}
                  <SourceNote source={config.switchSource.autoApprove} />
                </span>
              </span>
            </label>

            {!switches.autoApprove && gmail.observerConfigured && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-content-secondary">Type CONFIRM to enable</span>
                  <input
                    className="input font-mono"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CONFIRM"
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={busy || confirmText.trim().toUpperCase() !== 'CONFIRM'}
                  onClick={() => void toggle('autoApprove', true)}
                >
                  Enable automatic approval
                </button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ----------------------------------------------------------- gmail */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-content-primary">Payment mailbox (Gmail)</h3>
          <Badge tone={gmail.connected ? 'success' : 'warning'}>
            {gmail.connected ? 'Connected' : 'Not connected'}
          </Badge>
        </div>

        {gmail.connected ? (
          <div className="mt-3 flex flex-col gap-3">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-content-muted">Mailbox</dt>
                <dd className="font-mono text-content-primary">{gmail.connectedEmail ?? gmail.user}</dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">Access</dt>
                <dd className="text-content-primary">
                  {gmail.scopes?.includes('gmail.readonly') ? 'Read-only Gmail' : 'As granted'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">Connected</dt>
                <dd className="text-content-primary">{when(gmail.connectedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-content-muted">Last successful check</dt>
                <dd className="text-content-primary">{when(gmail.lastSuccessAt)}</dd>
              </div>
            </dl>

            {stale && (
              <Alert tone="warning" title="The mailbox has not been read recently">
                The last successful poll was {when(gmail.lastSuccessAt)}. Payments may be arriving
                without being detected.
              </Alert>
            )}
            {gmail.lastError && (
              <Alert tone="error" title="Last polling attempt failed">
                {gmail.lastError}
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => void testConnection()}>
                Test connection
              </button>
              <button type="button" className="btn-ghost text-sm text-danger" disabled={busy} onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {!gmail.canStoreCredentials && (
              <Alert tone="error" title="Credential storage is not available">
                The server has no encryption key configured (UPI_SECRETS_KEY), so credentials cannot be
                stored securely. An operator must set it before this account can be connected.
              </Alert>
            )}

            <p className="text-xs text-content-muted">
              Create an OAuth client in Google Cloud with{' '}
              <span className="font-mono">gmail.readonly</span> access, then add this exact redirect URI:
            </p>
            <code className="block break-all rounded bg-surface-secondary px-2 py-1 font-mono text-xs">
              {config.redirectUri}
            </code>

            {gmail.serverCredentialsConfigured ? (
              <div className="rounded border border-line-subtle bg-surface-secondary p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={useCustomCredentials}
                    onChange={(e) => setUseCustomCredentials(e.target.checked)}
                  />
                  <span>
                    <span className="text-content-primary">Use a different Google project</span>
                    <span className="block text-xs text-content-muted">
                      {useCustomCredentials
                        ? 'Enter the client ID and secret below.'
                        : 'This server is already configured with OAuth credentials. Leave this off to use them.'}
                    </span>
                  </span>
                </label>
              </div>
            ) : (
              <Alert tone="warning" title="No OAuth client configured on the server">
                Set <span className="font-mono">UPI_GOOGLE_CLIENT_ID</span> and{' '}
                <span className="font-mono">UPI_GOOGLE_CLIENT_SECRET</span> in Doppler, or enter them below
                to use a different Google project.
              </Alert>
            )}

            {(!gmail.serverCredentialsConfigured || useCustomCredentials) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-content-secondary">Client ID</span>
                  <input
                    className="input font-mono text-xs"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="…apps.googleusercontent.com"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-content-secondary">Client secret</span>
                  <input
                    className="input font-mono text-xs"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="stored encrypted, never shown again"
                  />
                </label>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={
                  busy ||
                  !gmail.canStoreCredentials ||
                  (useCustomCredentials && (!clientId.trim() || !clientSecret.trim()))
                }
                onClick={() => void startConnect()}
              >
                Connect Gmail
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}