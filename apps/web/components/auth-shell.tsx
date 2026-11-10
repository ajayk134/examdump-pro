import Link from 'next/link';
import type { ReactNode } from 'react';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-8">
      <div className="text-center">
        <Link href="/" className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-cyan-400 text-xl font-black text-slate-950">
          E
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-content-muted">{subtitle}</p>
      </div>
      <div className="card p-6">{children}</div>
      {footer ? <div className="text-center text-sm text-content-muted">{footer}</div> : null}
    </div>
  );
}