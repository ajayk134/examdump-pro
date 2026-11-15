'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { get } from '@/lib/api';
import type { Invoice } from '@/lib/types';
import { ErrorState, Spinner } from '@/components/ui';
import { IconArrowLeft } from '@/components/icons';
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
      <div className="mx-auto w-full max-w-2xl py-10">
        <ErrorState title="Invoice unavailable" description={error} />
        <div className="mt-4 text-center">
          <Link href="/profile" className="btn-secondary">
            Back to profile
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return <Spinner label="Loading invoice..." />;

  const { invoice, buyer } = data;
  const lineItems = invoice.lineItems ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-2 sm:py-6">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href="/profile" className="btn-ghost btn-sm">
          <IconArrowLeft width={16} height={16} />
          Back
        </Link>
        <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>
          Print / save PDF
        </button>
      </div>

      <article className="panel overflow-hidden p-0 print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-surface-border px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-sky-400 text-sm font-black text-white">
                E
              </span>
              <span className="text-lg font-bold tracking-tight">ExamDump Pro</span>
            </span>
            <p className="caption mt-2">Exam preparation platform</p>
            <p className="caption">support@examdump.pro</p>
          </div>
          <div className="min-w-0 sm:text-right">
            <p className="eyebrow">Invoice</p>
            <p className="mt-1 font-mono text-sm font-semibold">{invoice.number}</p>
            <p className="caption mt-1">Issued {formatDate(invoice.issuedAt)}</p>
          </div>
        </header>

        <section className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-7">
          <div className="min-w-0">
            <p className="eyebrow">Billed to</p>
            <p className="mt-1.5 text-sm font-medium">{buyer?.name || invoice.billedTo.name}</p>
            <p className="break-words text-sm text-content-secondary">{buyer?.email || invoice.billedTo.email}</p>
          </div>
          <div className="min-w-0 sm:text-right">
            <p className="eyebrow">Status</p>
            <p className="mt-1.5 text-sm font-medium capitalize">{invoice.status.replace('_', ' ')}</p>
            <p className="caption">Payment {invoice.paymentId.slice(0, 8)}</p>
          </div>
        </section>

        <div className="px-5 sm:px-7">
          <table className="tbl">
            <caption className="sr-only">Invoice line items</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="text-center">
                  Qty
                </th>
                <th scope="col" className="text-right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={`${item.description}-${i}`}>
                  <td className="text-content-primary">{item.description}</td>
                  <td className="numeric text-center text-content-secondary">{item.quantity}</td>
                  <td className="numeric whitespace-nowrap text-right font-medium">
                    {formatMoneyMinor(item.amountMinor * item.quantity, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex justify-end px-5 pt-5 sm:px-7">
          <dl className="w-full max-w-xs space-y-1.5 text-sm sm:max-w-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-content-secondary">Subtotal</dt>
              <dd className="numeric">{formatMoneyMinor(invoice.subtotalMinor, invoice.currency)}</dd>
            </div>
            {invoice.discountMinor > 0 ? (
              <div className="flex justify-between gap-4 text-positive">
                <dt>Discount</dt>
                <dd className="numeric">-{formatMoneyMinor(invoice.discountMinor, invoice.currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-surface-border pt-2 text-base font-semibold text-content-primary">
              <dt>Total</dt>
              <dd className="numeric">{formatMoneyMinor(invoice.totalMinor, invoice.currency)}</dd>
            </div>
          </dl>
        </div>

        <p className="mt-5 border-t border-surface-border px-5 py-4 text-xs text-content-muted sm:px-7">
          This is a computer-generated receipt for a digital subscription. No physical goods are shipped.
        </p>
      </article>
    </div>
  );
}
