import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
});

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
export const IconBook = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
);
export const IconChart = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 3v18h18" /><path d="m7 15 3-4 3 2 4-6" /></svg>
);
export const IconTrophy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4a2 2 0 0 0 2 4h1" /><path d="M17 6h3a2 2 0 0 1-2 4h-1" /></svg>
);
export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
);
export const IconBell = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
);
export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconBookmark = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></svg>
);
export const IconNote = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m8 5 12 7-12 7V5Z" /></svg>
);
export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconSparkles = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" /><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m20 6-11 11-5-5" /></svg>
);
export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
);
export const IconHistory = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
);
export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
);
export const IconShield = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconFlame = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 22c4.4 0 7-2.9 7-6.5 0-2.6-1.4-4.6-3-6.2-.8-.8-2-.3-2 .8 0 1.2-.8 2-1.6 1.2C11 9.8 10 7.3 10 5c0-1.1-1.2-1.7-2-.9C6.4 5.7 5 8.2 5 11c0 5 3.4 11 7 11Z" /></svg>
);
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconGrid = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const IconGoogle = (p: SVGProps<SVGSVGElement>) => (
  <svg width={18} height={18} viewBox="0 0 24 24" {...p}>
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8Z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
  </svg>
);
export const IconSend = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12 20 4l-6 16-3-6-7-2z" /></svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" /></svg>
);
export const IconRefresh = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 11a8 8 0 1 0-2.3 6M20 5v6h-6" /></svg>
);
export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
);
export const IconMessage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1-5a8 8 0 1 1 17-6z" /></svg>
);
export const IconThumbUp = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M7 22V11l4-8a2 2 0 0 1 2 2v5h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 22H7z" /><path d="M7 11H4v11h3" /></svg>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
);

export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V21h13V9.5" /></svg>
);
export const IconStar = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.2 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" /></svg>
);
export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M14 5.5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 4 4v16a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 14 20v-1.5" /><path d="M9.5 12H21" /><path d="m17.5 8.5 3.5 3.5-3.5 3.5" /></svg>
);
export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="m9 5 7 7-7 7" /></svg>
);
export const IconFilter = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
);
export const IconArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 12H4" /><path d="m10 6-6 6 6 6" /></svg>
);
export const IconCheckCircle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></svg>
);
export const IconAlertCircle = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.1" /></svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9.5 5v14M14.5 5v14" /></svg>
);
export const IconLightning = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13.5 3 5 13.5h5.5L10 21l8.5-10.5H13z" /></svg>
);
