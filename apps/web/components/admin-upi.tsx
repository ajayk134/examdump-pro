'use client';

/**
 * Admin → UPI collections.
 *
 * Three things this panel refuses to hide:
 *
 *  1. approvals are inferred from bank *alerts*, not from the bank's settlement
 *     ledger, so a warning sits at the top of every view;
 *  2. unmatched credits are listed and never auto-resolved: a human decides;
 *  3. a refund is only "complete" once a payout reference is recorded.
 *
 * Nothing here moves money. Approving a notification grants the entitlement that
 * the bank alert paid for; refunds are recorded after they are made by hand.
 */

import { useCallback, useEffect, useState } from 'react';
import { get, post } from '@/lib/api';
import { useToast } from '@/components/providers';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  SectionTitle,
  Spinner,
  StatCard,
  TableScroll,
} from '@/components/ui';

interface Overview {
  pending: number;
  settled: number;
  unmatched: number;
  rejected: number;
  settledToday: number;
  amountSettledPaise: number;
  observerConfigured: boolean;
  autoApprove: boolean;
  payeeVpa: string | null;
  verification: string;
  verificationWarning: string;
  lastUnmatchedAt: string | null;
}

interface OrderRow {
  id: string;
  reference: string;
  status: string;
  /** Payable amount, i.e. the plan price plus the uniqueness suffix. */
  amountPaise: number;
  /** Quoted plan price before the suffix. */
  baseAmountPaise?: number;
  userEmail?: string | null;
  planId?: string | null;
  createdAt: string;
  settledAt?: string | null;
  expiresAt: string;
}

interface NotificationRow {
  id: string;
  source: string;
  status: string;
  amountPaise: number | null;
  bankReference: string | null;
  senderVpa: string | null;
  observedAt: string | null;
  receivedAt: string;
  decisionReason: string | null;
  confidence: number | null;
  preview: string;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

const statusTone: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'accent'> = {
  pending: 'warning',
  settled: 'success',
  expired: 'default',
  cancelled: 'default',
  refunded: 'accent',
  unmatched: 'warning',
  matched: 'success',
  rejected: 'danger',
  ignored: 'default',
  duplicate: 'default',
};

export function AdminUpiPanel() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, ord, note] = await Promise.all([
        get<Overview>('/admin-ops/upi/overview'),
        get<{ orders: OrderRow[] }>('/admin-ops/upi/orders'),
        get<{ notifications: NotificationRow[] }>('/admin-ops/upi/notifications'),
      ]);
      setOverview(o);
      setOrders(ord.orders);
      setNotifications(note.notifications);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // The observer runs continuously; refresh the view without a full reload.
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function matchNotification(notificationId: string) {
    const orderId = window.prompt('Order id to match this credit against:');
    if (!orderId) return;
    const note = window.prompt('Reason (recorded in the audit log):') ?? '';
    setBusy(true);
    try {
      await post(`/admin-ops/upi/notifications/${notificationId}/match`, { orderId, note });
      toast('Approved and settled', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pollNow() {
    setBusy(true);
    try {
      const result = await post<{ scanned: number; ingested: number; matched: number }>(
        '/admin-ops/upi/observer/poll',
        {},
      );
      toast(`Scanned ${result.scanned}, matched ${result.matched}`, 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refund(order: OrderRow) {
    const amount = window.prompt(`Refund amount in rupees (max ${rupees(order.amountPaise)}):`);
    if (!amount) return;
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) {
      toast('Enter a valid amount', 'error');
      return;
    }
    setBusy(true);
    try {
      await post(`/admin-ops/upi/orders/${order.id}/refund`, {
        amountPaise: paise,
        reason: 'requested from admin console',
      });
      toast('Refund recorded as pending', 'success');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <Alert tone="error" title="Could not load UPI collections">{error}</Alert>;
  if (!overview) return <EmptyState title="No UPI data" description="Nothing has been collected yet." />;

  const unmatched = notifications.filter((n) => n.status === 'unmatched');

  return (
    <div className="flex flex-col gap-5">
      {/*
        The limitation is stated before any number, so an operator reading the
        dashboard cannot come away believing we have bank confirmation.
      */}
      <Alert tone="warning" title="Confirmation is notification-based, not bank-verified">
        {overview.verificationWarning}
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Awaiting payment" value={overview.pending} />
        <StatCard label="Settled today" value={overview.settledToday} />
        <StatCard label="Collected" value={rupees(overview.amountSettledPaise)} />
        <StatCard label="Unmatched credits" value={overview.unmatched} />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={overview.observerConfigured ? 'success' : 'warning'}>
              {overview.observerConfigured ? 'Mailbox observer connected' : 'Observer not configured'}
            </Badge>
            <Badge tone={overview.autoApprove ? 'success' : 'default'}>
              {overview.autoApprove ? 'Auto-approve on' : 'Manual approval'}
            </Badge>
            {overview.payeeVpa && (
              <span className="text-content-secondary">
                Payee <span className="font-mono text-content-primary">{overview.payeeVpa}</span>
              </span>
            )}
          </div>
          <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => void pollNow()}>
            Check mailbox now
          </button>
        </div>
        {overview.lastUnmatchedAt && (
          <p className="mt-3 text-xs text-content-muted">
            Most recent unmatched credit: {when(overview.lastUnmatchedAt)}
          </p>
        )}
      </Card>

      {unmatched.length > 0 && (
        <>
          <SectionTitle
            title="Needs a human decision"
            subtitle="A credit arrived that could not be matched to exactly one order. Nothing was granted."
          />
          <Card className="p-0">
            <TableScroll>
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted">
                  <tr>
                    <th className="px-4 py-3">Received</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Why held</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {unmatched.map((n) => (
                    <tr key={n.id}>
                      <td className="px-4 py-2 whitespace-nowrap text-content-secondary">
                        {when(n.receivedAt)}
                      </td>
                      <td className="px-4 py-2 font-medium">
                        {n.amountPaise ? rupees(n.amountPaise) : '—'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-content-secondary">
                        {n.bankReference ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-content-secondary">{n.decisionReason ?? '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={busy}
                          onClick={() => void matchNotification(n.id)}
                        >
                          Match to order
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}

      <SectionTitle title="Recent orders" subtitle="Every QR issued, and what became of it." />
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" description="Orders appear here as soon as a buyer opens a UPI checkout." />
      ) : (
        <Card className="p-0">
          <TableScroll>
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted">
                <tr>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2 font-mono text-xs">{o.reference}</td>
                    <td className="px-4 py-2 text-content-secondary">{o.userEmail ?? '—'}</td>
                    <td className="px-4 py-2 font-medium">
                      {rupees(o.amountPaise)}
                      {/*
                        The suffix is what makes the payment unattributable to
                        anyone else's checkout, so show it rather than leaving a
                        reconciliation mismatch that looks like a rounding bug.
                      */}
                      {typeof o.baseAmountPaise === 'number' && o.baseAmountPaise !== o.amountPaise ? (
                        <span className="ml-1 text-xs font-normal text-content-muted">
                          ({rupees(o.baseAmountPaise)} +{o.amountPaise - o.baseAmountPaise}p)
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={statusTone[o.status] ?? 'default'}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-content-secondary">
                      {when(o.createdAt)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {o.status === 'settled' && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={busy}
                          onClick={() => void refund(o)}
                        >
                          Refund
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <SectionTitle
        title="Notification log"
        subtitle="Every alert the observer read, including the ones it refused."
      />
      <Card className="p-0">
        <TableScroll>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-surface-border text-xs uppercase tracking-wide text-content-muted">
              <tr>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Preview</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {notifications.slice(0, 100).map((n) => (
                <tr key={n.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-content-secondary">
                    {when(n.receivedAt)}
                  </td>
                  <td className="px-4 py-2 text-content-secondary">{n.source}</td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone[n.status] ?? 'default'}>{n.status}</Badge>
                  </td>
                  <td className="px-4 py-2">{n.amountPaise ? rupees(n.amountPaise) : '—'}</td>
                  <td className="px-4 py-2 text-content-secondary">
                    {n.confidence === null ? '—' : `${n.confidence}%`}
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-2 text-xs text-content-muted">
                    {n.preview}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}
