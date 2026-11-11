'use client';

import Link from 'next/link';
import { useAuth } from '@/components/providers';
import { IconArrowRight } from '@/components/icons';

/**
 * Primary landing-page call to action.
 *
 * The label used to be static, so a signed-in visitor was still offered
 * "Start free" and pushed to /register — where creating an account with their
 * own email fails, and the recovery path lands them on the sign-in page. That
 * is what made a valid session look like a logout. The action now follows the
 * session: signed-in visitors go straight into practising.
 */
export function HeroCta() {
  const { user, loading } = useAuth();

  if (loading) {
    // Reserve the button's height so the hero does not jump when auth resolves.
    return (
      <span
        aria-hidden="true"
        className="btn-primary btn-lg pointer-events-none opacity-60"
      >
        Start free — no card needed
      </span>
    );
  }

  if (user) {
    return (
      <Link href="/exams" className="btn-primary btn-lg">
        Continue practising
        <IconArrowRight width={16} height={16} />
      </Link>
    );
  }

  return (
    <Link href="/register" className="btn-primary btn-lg">
      Start free — no card needed
    </Link>
  );
}
