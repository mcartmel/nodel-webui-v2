import type { Config } from 'tailwindcss';

export default {
  content: ['./*.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      borderRadius: {
        control: 'var(--nodel-radius-control)',
        card: 'var(--nodel-radius-card)',
        panel: 'var(--nodel-radius-panel)',
        popover: 'var(--nodel-radius-popover)'
      },
      colors: {
        nodel: {
          bg: 'rgb(var(--nodel-bg) / <alpha-value>)',
          fg: 'rgb(var(--nodel-fg) / <alpha-value>)',
          surface: 'rgb(var(--nodel-surface) / <alpha-value>)',
          muted: 'rgb(var(--nodel-muted) / <alpha-value>)',
          border: 'rgb(var(--nodel-border) / <alpha-value>)',
          accent: 'rgb(var(--nodel-accent) / <alpha-value>)',
          info: 'rgb(var(--nodel-info) / <alpha-value>)',
          backdrop: 'rgb(var(--nodel-backdrop) / <alpha-value>)',
          danger: 'rgb(var(--nodel-danger) / <alpha-value>)',
          dangerBg: 'rgb(var(--nodel-danger-bg) / <alpha-value>)',
          dangerBorder: 'rgb(var(--nodel-danger-border) / <alpha-value>)',
          success: 'rgb(var(--nodel-success) / <alpha-value>)',
          warning: 'rgb(var(--nodel-warning) / <alpha-value>)'
        }
      },
      fontSize: {
        13: ['0.8125rem', { lineHeight: '1.25rem' }],
        15: ['0.9375rem', { lineHeight: '1.625rem' }]
      },
      opacity: {
        disabled: '0.55',
        faint: '0.6',
        muted: '0.65',
        attention: '0.72'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        'nodel-panel': '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        'nodel-popover': '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 4px 6px -4px rgb(15 23 42 / 0.1)',
        'nodel-editor-status': '0 0.5rem 1.5rem rgb(15 23 42 / 0.14)'
      }
    }
  },
  plugins: []
} satisfies Config;
