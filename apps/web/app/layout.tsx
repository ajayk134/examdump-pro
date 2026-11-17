import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Manrope, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppProviders } from '@/components/providers';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import { AnnouncementBanner } from '@/components/announcement-banner';

/**
 * The identity's type system: a geometric display face (Space Grotesk) over a
 * rounded text face (Manrope), with JetBrains Mono for code and keycaps. All
 * three are open-source (OFL) and self-hosted by `next/font` at build time, so
 * there is no runtime request and no layout shift.
 */
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

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
    { media: '(prefers-color-scheme: light)', color: '#faf9ff' },
    { media: '(prefers-color-scheme: dark)', color: '#080514' },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('examdump-theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${manrope.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppProviders>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
          >
            Skip to content
          </a>
          <Navbar />
          <AnnouncementBanner />
          <main
            id="main"
            className="mx-auto flex w-full min-h-0 max-w-7xl flex-1 flex-col px-3.5 py-5 sm:px-6 sm:py-8 lg:pb-12"
          >
            {children}
          </main>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}