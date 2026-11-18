'use client';

import { useCallback, useEffect, useState } from 'react';
import { get, patch } from '@/lib/api';
import { useToast } from '@/components/providers';
import { Alert, Badge, Spinner } from '@/components/ui';
import { cn, formatNumber } from '@/lib/format';
import { IconChevronDown, IconEye, IconEyeOff } from '@/components/icons';

interface AdminProvider {
  providerId: string;
  title: string;
  slug: string;
  examCount: number;
  totalQuestions: number;
  enabled: boolean;
  enabledExamCount: number;
}

interface AdminExam {
  providerId: string;
  key: string;
  code: string;
  title: string;
  questionCount: number;
  enabled: boolean;
}

/**
 * Admin control for catalogue visibility.
 *
 * Changes apply immediately: a disabled provider or exam disappears from every
 * listing, search result and direct request for regular users, without deleting
 * rows or revoking entitlements.
 */
export function VisibilityPanel() {
  const { toast } = useToast();
  const [providers, setProviders] = useState<AdminProvider[] | null>(null);
  const [exams, setExams] = useState<Record<string, AdminExam[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<{ providers: AdminProvider[] }>('/admin/catalog/providers');
      setProviders(data.providers);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadExams = useCallback(
    async (providerId: string) => {
      try {
        const data = await get<{ exams: AdminExam[] }>(
          `/admin/catalog/providers/${encodeURIComponent(providerId)}/exams`,
        );
        setExams((prev) => ({ ...prev, [providerId]: data.exams }));
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    },
    [toast],
  );

  const toggleProvider = async (provider: AdminProvider) => {
    const next = !provider.enabled;
    setBusy(`provider:${provider.providerId}`);
    try {
      await patch(`/admin/catalog/providers/${encodeURIComponent(provider.providerId)}`, {
        enabled: next,
      });
      setProviders((prev) =>
        prev
          ? prev.map((p) => (p.providerId === provider.providerId ? { ...p, enabled: next } : p))
          : prev,
      );
      toast(`${provider.title} ${next ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleExam = async (providerId: string, exam: AdminExam) => {
    const next = !exam.enabled;
    setBusy(`exam:${providerId}:${exam.key}`);
    try {
      await patch(
        `/admin/catalog/exams/${encodeURIComponent(providerId)}/${encodeURIComponent(exam.key)}`,
        { enabled: next },
      );
      setExams((prev) => ({
        ...prev,
        [providerId]: (prev[providerId] ?? []).map((e) =>
          e.key === exam.key ? { ...e, enabled: next } : e,
        ),
      }));
      setProviders((prev) =>
        prev
          ? prev.map((p) =>
              p.providerId === providerId
                ? { ...p, enabledExamCount: p.enabledExamCount + (next ? 1 : -1) }
                : p,
            )
          : prev,
      );
      toast(`${exam.code} ${next ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleExpanded = (providerId: string) => {
    const opening = expanded !== providerId;
    setExpanded(opening ? providerId : null);
    if (opening && !exams[providerId]) void loadExams(providerId);
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!providers) return <Spinner />;

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex items-start gap-3 p-4">
        <IconEye className="mt-0.5 shrink-0 text-accent" />
        <div className="text-sm text-content-secondary">
          <p className="font-semibold text-content-primary">Control what learners can see</p>
          <p className="mt-1">
            Disabling a provider hides it and every one of its exams. Exams can also be hidden
            individually. Hidden content stays in the database with its questions, subscriptions and
            access records intact, and disappears from listings, search and direct links
            immediately.
          </p>
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="panel p-5 text-sm text-content-muted">
          No catalogue synced yet. Run a dataset sync first.
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {providers.map((provider) => {
          const isOpen = expanded === provider.providerId;
          const providerBusy = busy === `provider:${provider.providerId}`;
          const providerExams = exams[provider.providerId];
          const hiddenExams = provider.examCount - provider.enabledExamCount;
          return (
            <li key={provider.providerId} className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  type="button"
                  onClick={() => toggleExpanded(provider.providerId)}
                  aria-expanded={isOpen}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <IconChevronDown
                    className={cn('shrink-0 text-content-muted transition-transform', isOpen && 'rotate-180')}
                    width={18}
                    height={18}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-content-primary">
                      {provider.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-content-muted">
                      <span>{formatNumber(provider.examCount)} exams</span>
                      {hiddenExams > 0 ? (
                        <span className="text-caution">{formatNumber(hiddenExams)} hidden</span>
                      ) : null}
                    </span>
                  </span>
                </button>

                <Badge tone={provider.enabled ? 'success' : 'danger'}>
                  {provider.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <VisibilityToggle
                  checked={provider.enabled}
                  busy={providerBusy}
                  label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.title}`}
                  onToggle={() => void toggleProvider(provider)}
                />
              </div>

              {isOpen ? (
                <div className="border-t border-surface-border bg-surface-sunken px-4 py-3">
                  {!provider.enabled ? (
                    <p className="mb-2 text-xs text-content-muted">
                      This provider is disabled, so its exams are hidden regardless of their own
                      setting.
                    </p>
                  ) : null}
                  {!providerExams ? (
                    <Spinner />
                  ) : providerExams.length === 0 ? (
                    <p className="text-xs text-content-muted">No exams in this provider.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-surface-border">
                      {providerExams.map((exam) => (
                        <li key={exam.key} className="flex items-center gap-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-content-primary">
                              {exam.title}
                            </span>
                            <span className="text-xs text-content-muted">
                              {exam.code} · {formatNumber(exam.questionCount)} questions
                            </span>
                          </span>
                          <Badge tone={exam.enabled ? 'success' : 'danger'}>
                            {exam.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                          <VisibilityToggle
                            checked={exam.enabled}
                            busy={busy === `exam:${provider.providerId}:${exam.key}`}
                            label={`${exam.enabled ? 'Disable' : 'Enable'} ${exam.code}`}
                            onToggle={() => void toggleExam(provider.providerId, exam)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VisibilityToggle({
  checked,
  busy,
  label,
  onToggle,
}: {
  checked: boolean;
  busy: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-positive' : 'bg-surface-border-strong',
      )}
    >
      <span
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-content-primary shadow-sm transition-transform',
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
        )}
      >
        {checked ? (
          <IconEye width={12} height={12} />
        ) : (
          <IconEyeOff width={12} height={12} />
        )}
      </span>
    </button>
  );
}
