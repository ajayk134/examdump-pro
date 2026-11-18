'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CommunityComment, CommunityDiscussionPage, User } from '@/lib/types';
import { del, get, patch, post } from '@/lib/api';
import { cn, formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import { Avatar } from '../ui';
import {
  IconCheck,
  IconMessage,
  IconPencil,
  IconReply,
  IconSend,
  IconTrash,
  IconX,
} from '../icons';
import { useAuth, useToast } from '../providers';

/**
 * Threaded question discussion.
 *
 * Top-level comments are paginated; every reply for the current page is
 * attached by the API. Replies can nest, but the visual indentation stops
 * growing after three levels so threads stay readable on a phone.
 */
export function QuestionDiscussion({
  questionId,
  providerId,
  examKey,
}: {
  questionId: string;
  providerId: string;
  examKey: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [pagination, setPagination] = useState<CommunityDiscussionPage['pagination'] | null>(null);
  const [totalComments, setTotalComments] = useState(0);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [loading, setLoading] = useState(Boolean(user));
  const [loadingMore, setLoadingMore] = useState(false);
  const [posting, setPosting] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams({
      provider: providerId,
      exam: examKey,
      questionId,
      sort,
      pageSize: '8',
    });
    return params;
  }, [examKey, providerId, questionId, sort]);

  const load = useCallback(
    async (page: number, append: boolean) => {
      if (!user) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError('');
      try {
        const next = await get<CommunityDiscussionPage>(
          `/community/discussions?${query.toString()}&page=${page}`,
        );
        setComments((current) => (append ? [...current, ...next.comments] : next.comments));
        setPagination(next.pagination);
        setTotalComments(next.totalComments);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query, user],
  );

  useEffect(() => {
    setComments([]);
    setPagination(null);
    setTotalComments(0);
    setError('');
    void load(1, false);
  }, [load]);

  useEffect(() => {
    setBody('');
  }, [questionId]);

  const submit = async () => {
    if (!user || posting || body.trim().length < 2) return;
    setPosting(true);
    setError('');
    try {
      await post('/community/discussions', {
        provider: providerId,
        exam: examKey,
        questionId,
        body: body.trim(),
      });
      setBody('');
      await load(1, false);
    } catch (err) {
      setError((err as Error).message);
      toast((err as Error).message, 'error');
    } finally {
      setPosting(false);
    }
  };

  if (!user) {
    return (
      <section className="rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xs">
        <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
          <IconMessage width={13} height={13} /> Discussion
        </p>
        <p className="mt-2 text-sm text-content-secondary">
          <Link href="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{' '}
          to join the discussion and ask a follow-up.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`question-discussion-${questionId}`}
      className="rounded-2xl border border-surface-border bg-surface-raised p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-content-muted">
            <IconMessage width={13} height={13} /> Discussion
          </p>
          <h3 id={`question-discussion-${questionId}`} className="mt-1 text-sm font-bold text-content-primary">
            Questions and study notes
          </h3>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-surface-border bg-surface-base p-0.5">
          {(['newest', 'oldest'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSort(option)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[0.6875rem] font-bold capitalize transition-colors',
                sort === option
                  ? 'bg-surface-raised text-content-primary shadow-xs'
                  : 'text-content-muted hover:text-content-secondary',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[0.6875rem] text-content-muted">
        <span>
          {formatNumber(totalComments)} {totalComments === 1 ? 'comment' : 'comments'}
        </span>
        {loading ? <span>Loading…</span> : null}
      </div>

      <div className="mt-3">
        <label htmlFor={`discussion-body-${questionId}`} className="sr-only">
          Add a comment
        </label>
        <textarea
          id={`discussion-body-${questionId}`}
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, 2000))}
          placeholder="Share a tip, ask about the reasoning, or reply to another learner…"
          className="input min-h-20 resize-y text-sm"
          maxLength={2000}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="numeric text-[0.625rem] text-content-muted">{body.length}/2000</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={posting || body.trim().length < 2}
            className="btn-primary btn-sm"
          >
            <IconSend width={14} height={14} /> {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl bg-negative/[0.07] px-3 py-2 text-xs text-negative" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading && comments.length === 0 ? (
          <div className="space-y-3" role="status" aria-label="Loading discussion">
            <div className="skeleton h-20 w-full" />
            <div className="skeleton h-16 w-5/6" />
          </div>
        ) : comments.length === 0 ? (
          <p className="rounded-xl bg-surface-overlay/35 px-3 py-4 text-center text-xs text-content-muted">
            No comments yet. Start the discussion with a question or a study tip.
          </p>
        ) : (
          comments.map((comment) => (
            <CommentNode
              key={comment.id}
              comment={comment}
              depth={0}
              currentUser={user}
              providerId={providerId}
              examKey={examKey}
              questionId={questionId}
              onChanged={() => void load(1, false)}
            />
          ))
        )}
      </div>

      {pagination?.hasNext ? (
        <button
          type="button"
          onClick={() => void load(pagination.page + 1, true)}
          disabled={loadingMore}
          className="btn-secondary btn-sm mt-3 w-full"
        >
          {loadingMore ? 'Loading…' : 'Load more comments'}
        </button>
      ) : null}
    </section>
  );
}

function CommentNode({
  comment,
  depth,
  currentUser,
  providerId,
  examKey,
  questionId,
  onChanged,
}: {
  comment: CommunityComment;
  depth: number;
  currentUser: User;
  providerId: string;
  examKey: string;
  questionId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const canManage = currentUser.id === comment.user.id || currentUser.role === 'admin';

  const submitReply = async () => {
    if (busy || reply.trim().length < 2) return;
    setBusy(true);
    try {
      await post('/community/discussions', {
        provider: providerId,
        exam: examKey,
        questionId,
        parentId: comment.id,
        body: reply.trim(),
      });
      setReply('');
      setReplying(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (busy || editBody.trim().length < 2) return;
    setBusy(true);
    try {
      await patch(`/community/discussions/${comment.id}`, { body: editBody.trim() });
      setEditing(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await del(`/community/discussions/${comment.id}`);
      setConfirmingDelete(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={cn(
        'rounded-2xl border border-surface-border/80 px-3 py-3',
        depth > 0 ? 'bg-surface-overlay/25' : 'bg-surface-base',
        comment.deleted && 'opacity-75',
      )}
    >
      <div className="flex gap-2.5">
        <Avatar name={comment.user.name} src={comment.user.avatarUrl || undefined} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[0.8125rem] font-bold text-content-primary">{comment.user.name}</span>
            {comment.user.role === 'admin' ? (
              <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-[0.08em] text-accent">
                Admin
              </span>
            ) : null}
            <time
              dateTime={comment.createdAt}
              title={formatDateTime(comment.createdAt)}
              className="text-[0.6875rem] text-content-muted"
            >
              {relativeTime(comment.createdAt)}
            </time>
            {comment.edited && !comment.deleted ? (
              <span className="text-[0.625rem] text-content-muted">· edited</span>
            ) : null}
            {comment.replyCount > 0 ? (
              <span className="rounded-full bg-surface-overlay px-1.5 py-0.5 text-[0.5625rem] font-bold text-content-muted">
                {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
              </span>
            ) : null}
          </div>
          {comment.replyTo ? (
            <p className="mt-0.5 text-[0.625rem] text-content-muted">Replying to {comment.replyTo.name}</p>
          ) : null}

          {editing ? (
            <div className="mt-2">
              <textarea
                value={editBody}
                onChange={(event) => setEditBody(event.target.value.slice(0, 2000))}
                className="input min-h-20 resize-y text-sm"
                maxLength={2000}
              />
              <div className="mt-1.5 flex gap-2">
                <button type="button" onClick={() => void saveEdit()} disabled={busy} className="btn-primary btn-sm">
                  <IconCheck width={13} height={13} /> Save
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn-ghost btn-sm">
                  <IconX width={13} height={13} /> Cancel
                </button>
              </div>
            </div>
          ) : comment.deleted ? (
            <p className="mt-1.5 text-xs italic text-content-muted">This comment was deleted.</p>
          ) : (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-content-secondary">
              {comment.body}
            </p>
          )}

          {!comment.deleted && !editing ? (
            <div className="-ml-1.5 mt-1.5 flex flex-wrap items-center gap-0.5">
              <CommentAction
                icon={IconReply}
                label="Reply"
                onClick={() => {
                  setEditing(false);
                  setConfirmingDelete(false);
                  setReplying((open) => !open);
                  setReply('');
                }}
              />
              {canManage ? (
                <>
                  <CommentAction
                    icon={IconPencil}
                    label="Edit"
                    onClick={() => {
                      setReplying(false);
                      setConfirmingDelete(false);
                      setEditing(true);
                      setEditBody(comment.body);
                    }}
                  />
                  <CommentAction
                    icon={IconTrash}
                    label="Delete"
                    tone="danger"
                    onClick={() => {
                      setReplying(false);
                      setEditing(false);
                      setConfirmingDelete(true);
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {confirmingDelete ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-negative/[0.06] px-2.5 py-2">
              <span className="text-xs font-semibold text-negative">Delete this comment?</span>
              <div className="ml-auto flex items-center gap-0.5">
                <CommentAction
                  icon={IconTrash}
                  label={busy ? 'Deleting...' : 'Delete'}
                  tone="danger"
                  onClick={() => void remove()}
                  disabled={busy}
                />
                <CommentAction
                  icon={IconX}
                  label="Cancel"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                />
              </div>
            </div>
          ) : null}

          {replying ? (
            <div className="mt-2">
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value.slice(0, 2000))}
                placeholder={`Reply to ${comment.user.name}…`}
                className="input min-h-16 resize-y text-sm"
                maxLength={2000}
                autoFocus
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => void submitReply()}
                  disabled={busy || reply.trim().length < 2}
                  className="btn-primary btn-sm"
                >
                  <IconSend width={12} height={12} /> Reply
                </button>
                <button type="button" onClick={() => setReplying(false)} className="btn-ghost btn-sm">
                  <IconX width={12} height={12} /> Cancel
                </button>
              </div>
            </div>
          ) : null}

          {comment.replies.length > 0 ? (
            <div
              className={cn(
                'mt-3 space-y-2.5',
                depth < 3 && 'border-l border-surface-border/80 pl-3',
              )}
            >
              {comment.replies.map((child) => (
                <CommentNode
                  key={child.id}
                  comment={child}
                  depth={depth + 1}
                  currentUser={currentUser}
                  providerId={providerId}
                  examKey={examKey}
                  questionId={questionId}
                  onChanged={onChanged}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CommentAction({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  disabled = false,
}: {
  icon: typeof IconReply;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[0.6875rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger'
          ? 'text-content-muted hover:bg-negative/[0.08] hover:text-negative'
          : 'text-content-muted hover:bg-surface-overlay hover:text-content-secondary',
      )}
    >
      <Icon width={13} height={13} />
      {label}
    </button>
  );
}