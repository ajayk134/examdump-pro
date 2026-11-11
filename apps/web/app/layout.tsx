import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProviders } from '@/components/providers';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import { AnnouncementBanner } from '@/components/announcement-banner';

export const metadata: Metadata = {
  title: {
    default: 'ExamDump Pro — Pass your certification with confidence',
    template: '%s · ExamDump Pro',
  },
  description:
    'A premium exam-preparation platform with real practice questions, mock exams, AI explanations, weak-topic analytics and streaks across 160+ certification providers.',
  keywords: ['exam prep', 'certification', 'practice tests', 'mock exams', 'IT certification', 'ExamDump'],
  openGraph: {
    title: 'ExamDump Pro',
    description: 'Premium certification exam preparation with AI explanations and analytics.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7fbff' },
    { media: '(prefers-color-scheme: dark)', color: '#060c18' },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('examdump-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppProviders>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>
          <Navbar />
          <AnnouncementBanner />
          <main id="main" className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-7xl px-4 py-8 sm:px-6">
            {children}
          </main>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}