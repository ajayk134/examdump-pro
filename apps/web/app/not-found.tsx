import Link from 'next/link';
import { IconArrowRight, IconSearch } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="relative isolate mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center overflow-hidden py-16 text-center sm:py-24">
      <span aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 top-0 h-56 opacity-60" />
      <span aria-hidden="true" className="orb -left-10 top-4 h-44 w-44 bg-brand-500/20" />
      <span aria-hidden="true" className="orb -right-10 top-16 h-40 w-40 bg-accent-2/15" />

      <div className="relative flex flex-col items-center gap-5">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/20">
          <IconSearch width={26} height={26} />
        </span>

        <div>
          <p className="numeric gradient-text text-5xl font-black tracking-tight sm:text-6xl">404</p>
          <h1 className="heading-1 mt-3 text-balance">This page does not exist</h1>
          <p className="body-text mx-auto mt-2 max-w-sm text-pretty">
            The link may be broken, or the page may have moved. Let&apos;s get you back on track.
          </p>
        </div>

        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Link href="/" className="btn-primary">
            Go home
          </Link>
          <Link href="/exams" className="btn-secondary">
            Browse exams
            <IconArrowRight width={16} height={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}
