'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { get } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { Spinner } from '@/components/ui';
import { formatDate, formatMoneyMinor } from '@/lib/format';

interface InvoiceResponse {
  invoice: Invoice;
  buyer: { name: string; email: string } | null;
}

export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params?.id) return;
    void get<InvoiceResponse>(`/payments/invoices/${params.id}`)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [params?.id]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        <Link href="/profile" className="btn-secondary mt-4">
          Back to profile
        </Link>
      </div>
    );
  }

  if (!data) return <Spinner label="Loading invoice…" />;

  const { invoice, buyer } = data;

  return (
    <div className="mx-auto max-w-2xl space-y-4 py-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/profile" className="btn-ghost">
          ← Back
        </Link>
        <button type="button" className="btn-secondary" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>

      <article className="card p-8 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-border pb-5">
          <div>
            <p className="text-lg font-bold">ExamDump Pro</p>
            <p className="text-xs text-content-muted">Exam preparation platform</p>
            <p className="text-xs text-content-muted">support@examdump.pro</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-content-muted">Invoice</p>
            <p className="font-mono text-sm font-semibold">{invoice.number}</p>
            <p className="mt-1 text-xs text-content-muted">Issued {formatDate(invoice.issuedAt)}</p>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-content-muted">Billed to</p>
            <p className="mt-1 text-sm font-medium">{buyer?.name || invoice.billedTo.name}</p>
            <p className="text-sm text-content-secondary">{buyer?.email || invoice.billedTo.email}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-content-muted">Status</p>
            <p className="mt-1 text-sm font-medium capitalize">{invoice.status.replace('_', ' ')}</p>
            <p className="text-xs text-content-muted">Payment {invoice.paymentId.slice(0, 8)}</p>
          </div>
        </section>

        <table className="mt-6 w-full text-sm">
          <thead className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted">
            <tr>
              <th className="py-2">Description</th>
              <th className="py-2 text-center">Qty</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.lineItems ?? []).map((item, i) => (
              <tr key={`${item.description}-${i}`} className="border-b border-surface-border/60">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-center">{item.quantity}</td>
                <td className="py-2 text-right">
                  {formatMoneyMinor(item.amountMinor * item.quantity, invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-content-secondary">Subtotal</span>
            <span>{formatMoneyMinor(invoice.subtotalMinor, invoice.currency)}</span>
          </div>
          {invoice.discountMinor > 0 ? (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>Discount</span>
              <span>-{formatMoneyMinor(invoice.discountMinor, invoice.currency)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-surface-border pt-1 font-semibold">
            <span>Total</span>
            <span>{formatMoneyMinor(invoice.totalMinor, invoice.currency)}</span>
          </div>
        </div>

        <p className="mt-6 text-xs text-content-muted">
          This is a computer-generated receipt for a digital subscription. No physical goods are shipped.
        </p>
      </article>
    </div>
  );
}
