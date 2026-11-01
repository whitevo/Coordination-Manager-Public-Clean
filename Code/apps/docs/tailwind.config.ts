import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        surface: {
          0: '#ffffff',
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          700: '#1e293b',
          800: '#0f172a',
          850: '#0c1322',
          900: '#020617',
        },
        // Web-app HSL token contract -- only resolves inside a `.cm-preview`
        // surface (see index.css) where the CSS variables are defined. Lets the
        // design catalog render real web-app recipes (bg-primary, bg-card, ...)
        // faithfully in both light and dark.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        icon: 'hsl(var(--icon))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          subtle: 'hsl(var(--primary) / 0.12)',
          muted: 'hsl(var(--primary) / 0.28)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          subtle: 'hsl(var(--info-subtle))',
          muted: 'hsl(var(--info-muted))',
          foreground: 'hsl(var(--info-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          subtle: 'hsl(var(--success-subtle))',
          muted: 'hsl(var(--success-muted))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          subtle: 'hsl(var(--warning-subtle))',
          muted: 'hsl(var(--warning-muted))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          subtle: 'hsl(var(--danger-subtle))',
          muted: 'hsl(var(--danger-muted))',
          foreground: 'hsl(var(--danger-foreground))',
        },
        neutral: {
          DEFAULT: 'hsl(var(--neutral))',
          subtle: 'hsl(var(--neutral-subtle))',
          muted: 'hsl(var(--neutral-muted))',
          foreground: 'hsl(var(--neutral-foreground))',
        },
        feature: {
          ai: {
            DEFAULT: 'hsl(var(--feature-ai))',
            subtle: 'hsl(var(--feature-ai) / 0.12)',
            muted: 'hsl(var(--feature-ai) / 0.28)',
          },
          chat: {
            DEFAULT: 'hsl(var(--feature-chat))',
            subtle: 'hsl(var(--feature-chat) / 0.12)',
            muted: 'hsl(var(--feature-chat) / 0.28)',
          },
          support: {
            DEFAULT: 'hsl(var(--feature-support))',
            subtle: 'hsl(var(--feature-support) / 0.12)',
            muted: 'hsl(var(--feature-support) / 0.28)',
          },
          feedback: {
            DEFAULT: 'hsl(var(--feature-feedback))',
            subtle: 'hsl(var(--feature-feedback) / 0.12)',
            muted: 'hsl(var(--feature-feedback) / 0.28)',
          },
          commons: {
            DEFAULT: 'hsl(var(--feature-commons))',
            subtle: 'hsl(var(--feature-commons) / 0.12)',
            muted: 'hsl(var(--feature-commons) / 0.28)',
          },
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
          },
        },
      },
      // Mirror of the web-app motion registry so the catalog can demo real
      // animations. See Code/apps/web/tailwind.config.ts.
      animation: {
        'unmarked-pulse': 'unmarked-pulse 2s ease-in-out infinite',
        'cyan-pulse': 'cyan-pulse 2.2s ease-in-out infinite',
        'emerald-pulse': 'emerald-pulse 1.4s ease-in-out infinite',
        'attachment-pulse': 'attachment-pulse 1.8s ease-in-out infinite',
        'spin-once': 'spin-once 0.5s ease-out',
        'gradient-shift': 'gradient-shift 3.6s ease-in-out infinite',
        'indeterminate': 'indeterminate 1.5s ease-in-out infinite',
        'slide-in-right': 'slide-in-right 0.3s ease-out both',
        'fade-in-up': 'fade-in-up 0.7s ease-out both',
      },
    },
  },
  plugins: [],
} satisfies Config
