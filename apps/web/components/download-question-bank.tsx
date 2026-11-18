'use client';

import { apiBase } from '@/lib/api';
import { IconDownload } from './icons';

/**
 * Server-rendered PDF download. The endpoint enforces full-exam access again,
 * so showing this link is a convenience, not the permission check.
 */
export function DownloadQuestionBank({
  providerId,
  examKey,
  examCode,
  block = false,
}: {
  providerId: string;
  examKey: string;
  examCode: string;
  block?: boolean;
}) {
  const href = `${apiBase()}/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(examKey)}/questions.pdf`;
  return (
    <a
      href={href}
      className={`btn-secondary btn-sm${block ? ' btn-block' : ''}`}
      title={`Download every ${examCode} question with answers, explanations and community votes`}
    >
      <IconDownload className="h-4 w-4" />
      Download PDF
    </a>
  );
}