import type { Config } from 'tailwindcss';

/**
 * ExamDump Pro "Nova" theme.
 *
 * Semantic tokens (surface/content/accent) are driven by CSS custom properties
 * in globals.css so light and dark stay in lockstep. The named ramps below are
 * the *only* raw colours the UI reaches for, so the identity stays coherent:
 * iris (violet) is the primary, flare (magenta) and aqua (cyan) are its
 * gradient partners, and ink is a deep indigo neutral.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        /** Primary — electric violet. */
        iris: {
          50: '#f2eeff',
          100: '#e7dfff',
          200: '#d0c0ff',
          300: '#b39bff',
          400: '#9772ff',
          500: '#7c4dff',
          600: '#6d3bf5',
          700: '#5a29d6',
          800: '#4a21ae',
          900: '#3d1e8a',
          950: '#241050',
        },
        /** Secondary — hot magenta. */
        flare: {
          50: '#fff0f8',
          100: '#ffe0f0',
          200: '#ffc2e2',
          300: '#ff96cb',
          400: '#ff5fac',
          500: '#f52e8f',
          600: '#e5308c',
          700: '#c0166e',
          800: '#9e155a',
          900: '#83174d',
        },
        /** Tertiary — bright cyan. */
        aqua: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
        /** Deep indigo neutral used for ink and dark surfaces. */
        ink: {
          50: '#f5f3ff',
          100: '#ece9fb',
          200: '#d6d0f0',
          300: '#b4a9e0',
          400: '#8b7cc6',
          500: '#6757a8',
          600: '#4d3f87',
          700: '#3a2f68',
          800: '#241a48',
          900: '#160b33',
          950: '#0b0618',
        },
        /** Legacy ramp names remapped onto the new hues, so gradients written
            before the redesign inherit the identity instead of a second blue. */
        brand: {
          50: '#f2eeff',
          100: '#e7dfff',
          200: '#d0c0ff',
          300: '#b39bff',
          400: '#9772ff',
          500: '#7c4dff',
          600: '#6d3bf5',
          700: '#5a29d6',
          800: '#4a21ae',
          900: '#3d1e8a',
          950: '#241050',
        },
        sky: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
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
        'accent-2': 'rgb(var(--accent-2) / <alpha-value>)',
        'accent-3': 'rgb(var(--accent-3) / <alpha-value>)',
        positive: 'rgb(var(--success) / <alpha-value>)',
        caution: 'rgb(var(--warning) / <alpha-value>)',
        negative: 'rgb(var(--danger) / <alpha-value>)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        glow: 'var(--shadow-glow)',
        'glow-sm': 'var(--shadow-glow-sm)',
      },
      maxWidth: {
        '8xl': '90rem',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.4, 0.5, 1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '0.95' },
        },
      },
      animation: {
        'fade-in': 'fade-in .32s cubic-bezier(.22,1,.36,1) both',
        rise: 'rise .5s cubic-bezier(.22,1,.36,1)',
        pop: 'pop .22s cubic-bezier(.22,1,.36,1)',
        sheet: 'sheet-up .28s cubic-bezier(.22,1,.36,1) both',
        'slide-in': 'slide-in-right .28s cubic-bezier(.22,1,.36,1) both',
        float: 'float 6s ease-in-out infinite',
        'gradient-pan': 'gradient-pan 9s ease infinite',
        marquee: 'marquee 34s linear infinite',
        'glow-pulse': 'glow-pulse 5s ease-in-out infinite',
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
