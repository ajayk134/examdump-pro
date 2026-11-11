import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://examtopicspro.duckdns.org';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private or personalised areas: no value in search, and they contain
        // account data.
        disallow: ['/dashboard', '/profile', '/security', '/history', '/bookmarks', '/notes', '/invoices', '/admin', '/api/'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
