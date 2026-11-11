import type { Config } from 'tailwindcss';

/**
 * ExamDump Pro "Aurora" theme.
 *
 * Semantic tokens (surface/content/accent) are driven by CSS custom properties
 * in globals.css so light and dark stay in lockstep. Raw palette ramps remain
 * available for gradients and one-off accents.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eff8ff',
          100: '#dbeefe',
          200: '#bfe2fe',
          300: '#93d0fd',
          400: '#60b5fa',
          500: '#3b98f6',
          600: '#257aeb',
          700: '#1d63d8',
          800: '#1e51af',
          900: '#1e468a',
          950: '#172c54',
        },
        sky: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        surface: {
          base: 'rgb(var(--surface-base) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
          inset: 'rgb(var(--surface-inset) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--surface-border-strong) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--content-primary) / <alpha-value>)',
          secondary: 'rgb(var(--content-secondary) / <alpha-value>)',
          muted: 'rgb(var(--content-muted) / <alpha-value>)',
        },
        accent: 'rgb(var(--accent) / <alpha-value>)',
        positive: 'rgb(var(--success) / <alpha-value>)',
        caution: 'rgb(var(--warning) / <alpha-value>)',
        negative: 'rgb(var(--danger) / <alpha-value>)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
      },
      maxWidth: {
        '8xl': '90rem',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .32s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [
    /**
     * `touch:` variant — targets devices whose primary pointer is coarse.
     *
     * Tailwind's `hover:`/`sm:` variants cannot express "this is a finger, not
     * a mouse", so tap-target sizing had to be repeated as one-off `!min-h-*`
     * overrides on individual buttons. Exposing the media query as a variant
     * lets a component state its touch size once and keeps mouse-sized
     * controls untouched on desktop.
     */
    ({ addVariant }: { addVariant: (name: string, definition: string) => void }) => {
      addVariant('touch', '@media (pointer: coarse)');
    },
  ],
};

export default config;
