'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { useAuth, useToast } from './providers';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';
import { IconGoogle } from './icons';

interface GoogleCredentialResponse {
  credential?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: { client_id: string; callback: (r: GoogleCredentialResponse) => void }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const { refresh } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (!response.credential) return;
      try {
        await post<{ user: User }>('/auth/google', { idToken: response.credential });
        await refresh();
        toast('Signed in with Google', 'success');
        router.push('/dashboard');
      } catch (err) {
        toast((err as Error).message || 'Google sign-in failed', 'error');
      }
    },
    [refresh, router, toast],
  );

  useEffect(() => {
    if (!clientId || !ready) return;
    const google = window.google;
    if (!google || !containerRef.current) return;
    google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
    google.accounts.id.renderButton(containerRef.current, {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'continue_with',
    });
    setVisible(true);
  }, [clientId, ready, handleCredential]);

  if (!clientId) return null;

  return (
    <div className="flex flex-col gap-3">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <div ref={containerRef} className={visible ? 'flex justify-center' : 'hidden'} />
      {!visible ? (
        <button type="button" className="btn-secondary w-full" disabled>
          <IconGoogle /> {label}
        </button>
      ) : null}
      <div className="flex items-center gap-3 text-xs text-content-muted">
        <span className="h-px flex-1 bg-surface-border" /> or <span className="h-px flex-1 bg-surface-border" />
      </div>
    </div>
  );
}