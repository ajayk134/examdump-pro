/**
 * Deliverability self-check.
 *
 * There is no way for us to read a recipient's Spam folder from here, so this
 * module reports the things we *can* determine objectively:
 *
 *  - whether the sending identity is a domain we control (SPF/DKIM/DMARC are
 *    then possible) or a shared consumer domain like gmail.com (they are not),
 *  - what authentication would actually apply to mail sent as the configured
 *    From address,
 *  - and concrete, non-fictional recommendations.
 *
 * It never claims authentication that does not exist. If we send as `gmail.com`
 * it says so plainly, because an operator reading a green "all good" would be
 * misled about why mail lands in Spam.
 */

export interface DeliverabilityReport {
  /** Domain that appears in the From header. */
  fromDomain: string;
  /** True when that domain is one we could publish SPF/DKIM/DMARC for. */
  ownedDomain: boolean;
  /** Shared consumer mailbox providers we cannot authenticate. */
  sharedConsumerDomain: boolean;
  authentication: {
    spf: { status: 'possible' | 'not_possible'; detail: string };
    dkim: { status: 'possible' | 'not_possible'; detail: string };
    dmarc: { status: 'possible' | 'not_possible'; detail: string };
  };
  /** Severity for a UI banner. */
  risk: 'low' | 'high';
  summary: string;
  recommendations: string[];
}

/** Consumer mailbox providers whose domains a third party cannot authenticate. */
const SHARED_CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'rediffmail.com',
  'zoho.com',
]);

function domainOf(address: string): string {
  const match = address.match(/@([A-Za-z0-9.-]+)/);
  return (match?.[1] ?? '').toLowerCase().replace(/[.>]+$/, '');
}

/**
 * Inspect the configured sender and explain what authentication is achievable.
 *
 * `hasCustomDomainSender` is true when the operator has pointed MAIL_FROM at a
 * domain they registered, which is the only situation where SPF/DKIM/DMARC can
 * be published and alignment achieved.
 */
export function auditSenderIdentity(mailFrom: string): DeliverabilityReport {
  const fromDomain = domainOf(mailFrom);
  const shared = SHARED_CONSUMER_DOMAINS.has(fromDomain);
  const owned = Boolean(fromDomain) && !shared;

  const recommendations: string[] = [];
  if (shared) {
    recommendations.push(
      `Sending as ${fromDomain} means you cannot publish SPF, DKIM or DMARC for that domain, because you do not control it. Receiving providers therefore cannot verify your mail and will apply the mailbox provider's own DMARC policy, which commonly quarantines it.`,
    );
    recommendations.push(
      'Use a domain you own (for example examdump.pro) with SPF, a DKIM key and a DMARC record. This is the only change that removes the failure mode entirely.',
    );
    recommendations.push(
      'Until then, expect some messages to be filtered to Spam at Gmail, Outlook and corporate gateways. Keep volumes low and avoid bulk marketing from this identity.',
    );
    recommendations.push(
      'Ask the hosting provider to add a PTR (reverse DNS) record for the sending IP. Its absence is a further negative reputation signal.',
    );
  } else if (owned) {
    recommendations.push(`Publish SPF for ${fromDomain} including your relay (for Gmail Workspace, include:_spf.google.com).`);
    recommendations.push(`Publish a DKIM key at <selector>._domainkey.${fromDomain} and verify it appears in delivered headers.`);
    recommendations.push(`Publish DMARC for ${fromDomain} starting at p=none with a rua= reporting address, then move to p=quarantine.`);
  }

  return {
    fromDomain,
    ownedDomain: owned,
    sharedConsumerDomain: shared,
    authentication: shared
      ? {
          spf: {
            status: 'not_possible',
            detail: `SPF belongs to ${fromDomain}, not to us. Receiving servers check the ${fromDomain} record, which does not authorise this server.`,
          },
          dkim: {
            status: 'not_possible',
            detail: `A DKIM selector must be published under ${fromDomain}, which we do not control. Gmail does not DKIM-sign third-party submissions on behalf of a ${fromDomain} From address.`,
          },
          dmarc: {
            status: 'not_possible',
            detail: `DMARC is published by the owner of ${fromDomain}. We are subject to their policy, which commonly sets a quarantine action.`,
          },
        }
      : {
          spf: { status: 'possible', detail: `Publish an SPF TXT record for ${fromDomain}.` },
          dkim: { status: 'possible', detail: `Publish a DKIM key under ${fromDomain}.` },
          dmarc: { status: 'possible', detail: `Publish a DMARC TXT record for ${fromDomain}.` },
        },
    risk: shared ? 'high' : 'low',
    summary: shared
      ? `Mail is sent as ${fromDomain}, a shared consumer domain we cannot authenticate. Spam filtering at large providers is expected, not a code defect.`
      : `Mail is sent as ${fromDomain}. Authentication is achievable and should be configured.`,
    recommendations,
  };
}
