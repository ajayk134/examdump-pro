import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  delivered: boolean;
  /** Present only when SMTP is not configured so local/dev flows remain testable. */
  preview?: boolean;
}

let transporter: Transporter | null = null;

function getTransporter(env: Env): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export async function sendEmail(
  env: Env,
  message: EmailMessage,
  logger?: { info: (obj: unknown, msg?: string) => void },
): Promise<EmailResult> {
  const tx = getTransporter(env);
  if (!tx) {
    logger?.info(
      { to: message.to, subject: message.subject, preview: message.text.slice(0, 500) },
      'email.skipped_no_smtp',
    );
    return { delivered: false, preview: true };
  }
  await tx.sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  return { delivered: true };
}

export function buildActionEmail(
  env: Env,
  options: { title: string; intro: string; actionLabel: string; actionUrl: string; footnote?: string },
): { text: string; html: string } {
  const { title, intro, actionLabel, actionUrl, footnote } = options;
  const text = [
    title,
    '',
    intro,
    '',
    `${actionLabel}: ${actionUrl}`,
    '',
    footnote ?? 'If you did not request this, you can safely ignore this email.',
    '',
    'ExamDump Pro',
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:Inter,Arial,sans-serif;color:#e6e8f0;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#121a33;border:1px solid #24305a;border-radius:16px;padding:32px">
    <h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <p style="line-height:1.6;color:#aab2cc;margin:0 0 24px">${escapeHtml(intro)}</p>
    <a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#22d3ee);color:#04101f;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none">${escapeHtml(actionLabel)}</a>
    <p style="line-height:1.5;color:#7d86a6;font-size:13px;margin:24px 0 0">${escapeHtml(footnote ?? 'If you did not request this, you can safely ignore this email.')}</p>
    <p style="color:#4d5573;font-size:12px;margin:24px 0 0">ExamDump Pro · ${escapeHtml(env.PUBLIC_WEB_URL)}</p>
  </div>
</body></html>`;
  return { text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}