import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-6xl font-black text-brand-400">404</p>
      <h1 className="text-2xl font-bold">This page does not exist</h1>
      <p className="max-w-md text-content-muted">The link may be broken, or the page may have moved. Let&apos;s get you back on track.</p>
      <div className="flex gap-2">
        <Link href="/" className="btn-primary">Go home</Link>
        <Link href="/browse" className="btn-secondary">Browse exams</Link>
      </div>
    </div>
  );
}