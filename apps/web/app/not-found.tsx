import Link from 'next/link';
import { IconSearch } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-16 text-center sm:py-24">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-accent">
        <IconSearch className="h-6 w-6" />
      </span>
      <div>
        <p className="numeric text-5xl font-black tracking-tight text-accent/40">404</p>
        <h1 className="heading-1 mt-1">This page does not exist</h1>
        <p className="body-text mt-2">
          The link may be broken, or the page may have moved. Let&apos;s get you back on track.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Link href="/" className="btn-primary">
          Go home
        </Link>
        <Link href="/exams" className="btn-secondary">
          Browse exams
        </Link>
      </div>
    </div>
  );
}
