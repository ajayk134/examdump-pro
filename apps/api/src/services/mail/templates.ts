/**
 * ExamDump Mail templates.
 *
 * Plain functions returning `{ subject, text, html }`. No template engine: the
 * whole surface is small, the output has to be escaped anyway, and keeping it
 * explicit avoids a dependency on a 2-axis template language.
 *
 * Design constraints that matter for real inboxes:
 *  - Tables + inline styles only. Gmail/Outlook strip <style> blocks and
 *    external CSS, so every rule is inline on the element.
 *  - No web fonts, no images, no tracking pixels: reliable and privacy-safe.
 *  - Every message ships a plain-text fallback.
 *  - All interpolation is HTML-escaped; user-controlled values (names, exam
 *    titles, coupon codes) never reach the HTML unescaped.
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface BrandContext {
  /** Absolute base URL, e.g. https://examtopicspro.duckdns.org */
  webUrl: string;
  /** Reply-to / support address. */
  supportEmail: string;
  productName?: string;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SKY = '#0ea5e9';
const BRAND = '#2563eb';
const INK = '#0f172a';
const BODY = '#475569';
const MUTED = '#94a3b8';
const BORDER = '#e2e8f0';
const BG = '#f1f5f9';

interface LayoutOptions {
  brand: BrandContext;
  /** Inbox preview line. */
  preheader: string;
  heading: string;
  /** Inner HTML, already escaped by the caller. */
  blocks: string;
  /** Optional smaller footnote under the main card. */
  footnote?: string;
}

/**
 * Shared responsive shell. Inline styles mean it renders identically in Gmail
 * (web, iOS, Android), Apple Mail and Outlook.
 */
function layout({ brand, preheader, heading, blocks, footnote }: LayoutOptions): string {
  const product = escapeHtml(brand.productName ?? 'ExamDump');
  const web = escapeHtml(brand.webUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
        <tr>
          <td style="padding:0 0 16px 4px;">
            <span style="font:700 17px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">${product}</span>
            <span style="font:600 11px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${SKY};letter-spacing:.08em;text-transform:uppercase;padding-left:8px;">Mail</span>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:28px 24px;">
            <h1 style="margin:0 0 12px;font:700 20px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(heading)}</h1>
            ${blocks}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 6px 0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
            ${footnote ? `<p style="margin:0 0 8px;">${escapeHtml(footnote)}</p>` : ''}
            <p style="margin:0;">${product} &middot; <a href="${web}" style="color:${MUTED};text-decoration:underline;">${web}</a></p>
            <p style="margin:6px 0 0;">Need help? Reply to this email or write to <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(brand.supportEmail)}</a>.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 16px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BODY};">${html}</p>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
    <tr><td style="border-radius:10px;background:${BRAND};">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font:600 15px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

/** Two-column key/value rows used by receipts and subscription notices. */
function detailRows(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:7px 0;font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BODY};">${escapeHtml(label)}</td>
        <td align="right" style="padding:7px 0;font:600 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
    ${body}
  </table>`;
}

function fallbackLink(href: string): string {
  return `<p style="margin:0 0 8px;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">Button not working? Copy this link into your browser:<br><span style="color:${BODY};word-break:break-all;">${escapeHtml(href)}</span></p>`;
}

const lines = (...parts: Array<string | null | undefined>) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');

/* ------------------------------ Actions ------------------------------ */

export function verificationEmail(
  brand: BrandContext,
  input: { name?: string; verifyUrl: string; expiresInHours?: number },
): EmailContent {
  const hours = input.expiresInHours ?? 24;
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: 'Verify your ExamDump email address',
    text: lines(
      hi,
      '',
      'Confirm your email address to activate your ExamDump account and keep your progress saved.',
      '',
      `Verify email: ${input.verifyUrl}`,
      '',
      `This link expires in ${hours} hours. If you did not create an account, ignore this message.`,
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: `Confirm your email to finish setting up ExamDump. Link expires in ${hours} hours.`,
      heading: 'Verify your email',
      blocks: [
        para(escapeHtml(hi)),
        para('Confirm your email address to activate your ExamDump account and keep your progress saved.'),
        button(input.verifyUrl, 'Verify email'),
        fallbackLink(input.verifyUrl),
        para(`<span style="color:${MUTED};font-size:13px;">This link expires in ${hours} hours. If you did not create an account, you can safely ignore this message.</span>`),
      ].join(''),
    }),
  };
}

export function passwordResetEmail(
  brand: BrandContext,
  input: { name?: string; resetUrl: string; expiresInMinutes?: number },
): EmailContent {
  const mins = input.expiresInMinutes ?? 60;
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: 'Reset your ExamDump password',
    text: lines(
      hi,
      '',
      'We received a request to reset your ExamDump password.',
      '',
      `Reset password: ${input.resetUrl}`,
      '',
      `This link expires in ${mins} minutes and can be used once.`,
      'If you did not request this, no action is needed — your password stays unchanged.',
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: 'Reset your ExamDump password. The link expires in one hour.',
      heading: 'Reset your password',
      blocks: [
        para(escapeHtml(hi)),
        para('We received a request to reset your ExamDump password.'),
        button(input.resetUrl, 'Reset password'),
        fallbackLink(input.resetUrl),
        para(`<span style="color:${MUTED};font-size:13px;">This link expires in ${mins} minutes and can be used once. If you did not request it, no action is needed — your password stays unchanged.</span>`),
      ].join(''),
    }),
  };
}

export function welcomeEmail(
  brand: BrandContext,
  input: { name?: string; examsUrl?: string; freeQuestions?: number },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  const examsUrl = input.examsUrl ?? `${brand.webUrl}/exams`;
  const free = input.freeQuestions ?? 5;
  return {
    subject: 'Welcome to ExamDump',
    text: lines(
      hi,
      '',
      'Your email is verified — welcome aboard.',
      '',
      `Every exam includes ${free} free questions, so you can try the format before deciding on a plan. Your progress, bookmarks and notes are saved automatically.`,
      '',
      'Getting started:',
      `1. Pick your certification: ${examsUrl}`,
      '2. Practise with instant explanations',
      '3. Take a timed mock test when you are ready',
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: 'Your exam is verified and ready. Start with your free questions.',
      heading: 'Welcome to ExamDump',
      blocks: [
        para(escapeHtml(hi)),
        para('Your email is verified — welcome aboard.'),
        para(
          `Every exam includes <strong style="color:${INK};">${free} free questions</strong>, so you can try the format before choosing a plan. Progress, bookmarks and notes save automatically.`,
        ),
        detailRows([
          ['Step 1', 'Pick your certification'],
          ['Step 2', 'Practise with instant explanations'],
          ['Step 3', 'Take a timed mock test'],
        ]),
        button(examsUrl, 'Browse exams'),
      ].join(''),
    }),
  };
}

/* ---------------------------- Commerce ---------------------------- */

export interface ReceiptLine {
  label: string;
  value: string;
}

export function paymentReceiptEmail(
  brand: BrandContext,
  input: {
    name?: string;
    invoiceNumber: string;
    amount: string;
    planName: string;
    paidAt: string;
    method?: string;
    invoiceUrl?: string;
    lines?: ReceiptLine[];
    reference?: string;
  },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  const rows: Array<[string, string]> = [
    ['Invoice', input.invoiceNumber],
    ['Plan', input.planName],
    ['Amount paid', input.amount],
    ['Paid on', input.paidAt],
    ...(input.method ? [['Method', input.method] as [string, string]] : []),
    ...(input.lines ?? []).map((l) => [l.label, l.value] as [string, string]),
  ];
  const textRows = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return {
    subject: `Your ExamDump receipt — ${input.invoiceNumber}`,
    text: lines(
      hi,
      '',
      'Thanks for your purchase. Your access is active now.',
      '',
      textRows,
      input.reference ? `\nReference: ${input.reference}` : '',
      input.invoiceUrl ? `\nView invoice: ${input.invoiceUrl}` : '',
      '',
      'Keep this email for your records.',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: `Receipt ${input.invoiceNumber} for ${input.amount}.`,
      heading: 'Payment received',
      blocks: [
        para(escapeHtml(hi)),
        para('Thanks for your purchase. Your access is active now.'),
        detailRows(rows),
        input.invoiceUrl ? button(input.invoiceUrl, 'View invoice') : '',
        para(`<span style="color:${MUTED};font-size:13px;">Keep this email for your records.</span>`),
      ].join(''),
    }),
  };
}

export function subscriptionNoticeEmail(
  brand: BrandContext,
  input: {
    name?: string;
    kind: 'activated' | 'renewed' | 'expiring' | 'cancelled';
    planName: string;
    /** Human readable date, pre-formatted by the caller. */
    dateLabel: string;
    dateValue: string;
    manageUrl?: string;
    note?: string;
  },
): EmailContent {
  const copy: Record<typeof input.kind, { subject: string; heading: string; lead: string; preheader: string }> = {
    activated: {
      subject: `Your ExamDump ${input.planName} plan is active`,
      heading: 'Your plan is active',
      lead: `Your ${input.planName} plan is now active. Full access is unlocked immediately.`,
      preheader: `Your ${input.planName} plan is active.`,
    },
    renewed: {
      subject: `Your ExamDump ${input.planName} plan renewed`,
      heading: 'Plan renewed',
      lead: `Your ${input.planName} plan has renewed. Nothing else needs to be done.`,
      preheader: `Your ${input.planName} plan renewed successfully.`,
    },
    expiring: {
      subject: `Your ExamDump ${input.planName} plan ends soon`,
      heading: 'Your plan ends soon',
      lead: `Your ${input.planName} plan is due to end. Renew to keep full access without interruption.`,
      preheader: `Your ${input.planName} plan ends soon.`,
    },
    cancelled: {
      subject: `Your ExamDump ${input.planName} plan was cancelled`,
      heading: 'Plan cancelled',
      lead: `Your ${input.planName} plan has been cancelled. You keep access until the date below, then return to the free tier.`,
      preheader: `Your ${input.planName} plan was cancelled.`,
    },
  };
  const c = copy[input.kind];
  const manageUrl = input.manageUrl ?? `${brand.webUrl}/profile`;
  return {
    subject: c.subject,
    text: lines(
      input.name ? `Hi ${input.name},` : 'Hi,',
      '',
      c.lead,
      '',
      `Plan: ${input.planName}`,
      `${input.dateLabel}: ${input.dateValue}`,
      input.note ? `\n${input.note}` : '',
      '',
      `Manage your plan: ${manageUrl}`,
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: c.preheader,
      heading: c.heading,
      blocks: [
        para(input.name ? escapeHtml(`Hi ${input.name},`) : 'Hi,'),
        para(escapeHtml(c.lead)),
        detailRows([
          ['Plan', input.planName],
          [input.dateLabel, input.dateValue],
        ]),
        input.note ? para(`<span style="color:${BODY};font-size:14px;">${escapeHtml(input.note)}</span>`) : '',
        button(manageUrl, 'Manage plan'),
      ].join(''),
    }),
  };
}

export function refundProcessedEmail(
  brand: BrandContext,
  input: { name?: string; amount: string; reference: string; reason?: string },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: `Refund processed — ${input.reference}`,
    text: lines(
      hi,
      '',
      `We have processed a refund of ${input.amount}.`,
      '',
      `Reference: ${input.reference}`,
      input.reason ? `Reason: ${input.reason}` : '',
      '',
      'Refunds usually reach your original payment method within 5-7 business days.',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: `Refund of ${input.amount} processed.`,
      heading: 'Refund processed',
      blocks: [
        para(escapeHtml(hi)),
        para(`We have processed a refund of <strong style="color:${INK};">${escapeHtml(input.amount)}</strong>.`),
        detailRows([
          ['Reference', input.reference],
          ...(input.reason ? [['Reason', input.reason] as [string, string]] : []),
        ]),
        para(`<span style="color:${MUTED};font-size:13px;">Refunds usually reach your original payment method within 5–7 business days.</span>`),
      ].join(''),
    }),
  };
}

export function testEmail(brand: BrandContext, input: { sentAt: string }): EmailContent {
  return {
    subject: `ExamDump Mail test — ${input.sentAt}`,
    text: `ExamDump Mail is configured correctly.\n\nSent at: ${input.sentAt}\nSender: ${brand.supportEmail}\n`,
    html: layout({
      brand,
      preheader: 'Mail configuration test.',
      heading: 'Mail is working',
      blocks: [
        para('ExamDump Mail is configured correctly and this message was delivered successfully.'),
        detailRows([
          ['Sent at', input.sentAt],
          ['Sender', brand.supportEmail],
        ]),
      ].join(''),
    }),
  };
}

/* -------------------------- security & account -------------------------- */

/**
 * New sign-in alert.
 *
 * Security mail is deliberately vague about "was this you?" outcomes: it never
 * includes a link that changes state, only one that leads to the account's
 * security section, so a phished email cannot be turned into an action.
 */
export function loginAlertEmail(
  brand: BrandContext,
  input: {
    name?: string;
    when: string;
    ip?: string;
    device?: string;
    location?: string;
    securityUrl: string;
  },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  const rows: Array<[string, string]> = [['Time', input.when]];
  if (input.device) rows.push(['Device', input.device]);
  if (input.ip) rows.push(['IP address', input.ip]);
  if (input.location) rows.push(['Approximate location', input.location]);

  return {
    subject: 'New sign-in to your ExamDump account',
    text: lines(
      hi,
      '',
      'Your ExamDump account was just signed in to.',
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      'If this was you, no action is needed.',
      `If it was not, secure your account: ${input.securityUrl}`,
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: `New sign-in detected${input.device ? ` from ${input.device}` : ''}.`,
      heading: 'New sign-in to your account',
      blocks: [
        para(escapeHtml(hi)),
        para('Your ExamDump account was just signed in to.'),
        detailRows(rows),
        para('If this was you, no action is needed.'),
        button(input.securityUrl, 'Review account security'),
        para(`<span style="color:${MUTED};font-size:13px;">If you do not recognise this activity, change your password and reply to this email so we can help.</span>`),
      ].join(''),
    }),
  };
}

/** Sent after a password change, so a silent takeover is noticeable. */
export function passwordChangedEmail(
  brand: BrandContext,
  input: { name?: string; when: string; resetUrl: string },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: 'Your ExamDump password was changed',
    text: lines(
      hi,
      '',
      `Your password was changed on ${input.when}.`,
      '',
      'If you made this change, no action is needed.',
      `If you did not, reset your password immediately: ${input.resetUrl}`,
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: 'Your ExamDump password was changed.',
      heading: 'Your password was changed',
      blocks: [
        para(escapeHtml(hi)),
        para(`Your ExamDump password was changed on <strong>${escapeHtml(input.when)}</strong>.`),
        para('If you made this change, no action is needed.'),
        button(input.resetUrl, 'Reset your password'),
        para(`<span style="color:${MUTED};font-size:13px;">If you did not change it, reset your password now and reply to this email.</span>`),
      ].join(''),
    }),
  };
}

/** Generic account notification (plan change, suspension, profile event). */
export function accountNoticeEmail(
  brand: BrandContext,
  input: { name?: string; heading: string; body: string; ctaLabel?: string; ctaUrl?: string },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: input.heading,
    text: lines(
      hi,
      '',
      input.body,
      '',
      ...(input.ctaUrl ? [`${input.ctaLabel ?? 'Open ExamDump'}: ${input.ctaUrl}`] : []),
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: input.body.slice(0, 120),
      heading: input.heading,
      blocks: [
        para(escapeHtml(hi)),
        para(escapeHtml(input.body)),
        ...(input.ctaUrl ? [button(input.ctaUrl, input.ctaLabel ?? 'Open ExamDump')] : []),
      ].join(''),
    }),
  };
}

/** Support enquiry acknowledgement, sent to the person who wrote in. */
export function supportReceivedEmail(
  brand: BrandContext,
  input: { name?: string; reference: string; subject: string; message: string },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: `We received your message (${input.reference})`,
    text: lines(
      hi,
      '',
      'Thanks for getting in touch with ExamDump. A member of the team will reply within one business day.',
      '',
      `Reference: ${input.reference}`,
      `Subject: ${input.subject}`,
      '',
      'Your message:',
      input.message,
      '',
      '— ExamDump Support',
    ),
    html: layout({
      brand,
      preheader: `We received your message. Reference ${input.reference}.`,
      heading: 'We received your message',
      blocks: [
        para(escapeHtml(hi)),
        para('Thanks for getting in touch with ExamDump. A member of the team will reply within one business day.'),
        detailRows([
          ['Reference', input.reference],
          ['Subject', input.subject],
        ]),
        para(`<span style="color:${MUTED};font-size:13px;">Your message:</span>`),
        para(escapeHtml(input.message).replace(/\n/g, '<br>')),
      ].join(''),
    }),
  };
}

/** Admin broadcast / announcement, delivered as marketing mail. */
export function announcementEmail(
  brand: BrandContext,
  input: { name?: string; title: string; body: string; ctaLabel?: string; ctaUrl?: string; unsubscribeUrl: string },
): EmailContent {
  const hi = input.name ? `Hi ${input.name},` : 'Hi,';
  return {
    subject: input.title,
    text: lines(
      hi,
      '',
      input.body,
      '',
      ...(input.ctaUrl ? [`${input.ctaLabel ?? 'Open ExamDump'}: ${input.ctaUrl}`] : []),
      '',
      '—',
      `You are receiving this because you opted in to ExamDump product updates.`,
      `Unsubscribe: ${input.unsubscribeUrl}`,
      '',
      '— ExamDump',
    ),
    html: layout({
      brand,
      preheader: input.body.slice(0, 120),
      heading: input.title,
      blocks: [
        para(escapeHtml(hi)),
        para(escapeHtml(input.body).replace(/\n/g, '<br>')),
        ...(input.ctaUrl ? [button(input.ctaUrl, input.ctaLabel ?? 'Open ExamDump')] : []),
        para(
          `<span style="color:${MUTED};font-size:13px;">You are receiving this because you opted in to ExamDump product updates. ` +
            `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED};">Unsubscribe</a>.</span>`,
        ),
      ].join(''),
    }),
  };
}
