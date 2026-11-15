import Link from 'next/link';
import { IconArrowRight, IconSearch } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="relative isolate mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center py-16 text-center sm:py-24">
      <div aria-hidden="true" className="grid-fade pointer-events-none absolute inset-x-0 top-0 h-48 opacity-50" />

      <div className="relative flex flex-col items-center gap-5">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
          <IconSearch width={26} height={26} />
        </span>

        <div>
          <p className="numeric text-5xl font-black tracking-tight text-accent/40 sm:text-6xl">404</p>
          <h1 className="heading-1 mt-2 text-balance">This page does not exist</h1>
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
