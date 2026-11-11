import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://examtopicspro.duckdns.org';

/**
 * Static public routes. Exam and provider pages are generated on demand from
 * the private dataset, so they are intentionally not enumerated here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: Array<{ path: string; priority: number; freq: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '/', priority: 1, freq: 'weekly' },
    { path: '/exams', priority: 0.9, freq: 'daily' },
    { path: '/practice', priority: 0.8, freq: 'weekly' },
    { path: '/mock', priority: 0.8, freq: 'weekly' },
    { path: '/ask', priority: 0.8, freq: 'weekly' },
    { path: '/pricing', priority: 0.7, freq: 'monthly' },
    { path: '/support', priority: 0.5, freq: 'monthly' },
    { path: '/terms', priority: 0.3, freq: 'yearly' },
    { path: '/privacy', priority: 0.3, freq: 'yearly' },
  ];

  return routes.map((r) => ({
    url: `${BASE}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
