import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-surface-border/70">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-600 to-sky-400 text-white">E</span>
            ExamDump Pro
          </p>
          <p className="mt-3 max-w-xs text-sm text-content-muted">
            Premium exam preparation built for people who want to pass on the first attempt.
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold">Product</p>
          <ul className="mt-3 space-y-2 text-sm text-content-muted">
            <li><Link href="/browse" className="hover:text-content-primary">Browse exams</Link></li>
            <li><Link href="/pricing" className="hover:text-content-primary">Pricing</Link></li>
            <li><Link href="/leaderboard" className="hover:text-content-primary">Leaderboard</Link></li>
            <li><Link href="/api/docs" className="hover:text-content-primary">API docs</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Account</p>
          <ul className="mt-3 space-y-2 text-sm text-content-muted">
            <li><Link href="/dashboard" className="hover:text-content-primary">Dashboard</Link></li>
            <li><Link href="/ask" className="hover:text-content-primary">Ask AI</Link></li>
            <li><Link href="/profile" className="hover:text-content-primary">Settings</Link></li>
            <li><Link href="/referrals" className="hover:text-content-primary">Refer a friend</Link></li>
            <li><Link href="/support" className="hover:text-content-primary">Support</Link></li>
            <li><Link href="/login" className="hover:text-content-primary">Sign in</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold">Legal</p>
          <ul className="mt-3 space-y-2 text-sm text-content-muted">
            <li><Link href="/terms" className="hover:text-content-primary">Terms of service</Link></li>
            <li><Link href="/privacy" className="hover:text-content-primary">Privacy policy</Link></li>
            <li><Link href="/security" className="hover:text-content-primary">Security</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-surface-border/70 px-4 py-5 text-center text-xs text-content-muted">
        © {new Date().getFullYear()} ExamDump Pro. Exam names and trademarks belong to their respective owners. Study material is for educational use only.
      </div>
    </footer>
  );
}