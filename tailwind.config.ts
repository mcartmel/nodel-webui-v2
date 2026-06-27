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
          surfaceRaised: 'rgb(var(--nodel-surface-raised) / <alpha-value>)',
          muted: 'rgb(var(--nodel-muted) / <alpha-value>)',
          border: 'rgb(var(--nodel-border) / <alpha-value>)',
          accent: 'rgb(var(--nodel-accent) / <alpha-value>)',
          accentFill: 'rgb(var(--nodel-accent-fill) / <alpha-value>)',
          onAccent: 'rgb(var(--nodel-on-accent) / <alpha-value>)',
          info: 'rgb(var(--nodel-info) / <alpha-value>)',
          infoFill: 'rgb(var(--nodel-info-fill) / <alpha-value>)',
          onInfo: 'rgb(var(--nodel-on-info) / <alpha-value>)',
          backdrop: 'rgb(var(--nodel-backdrop) / <alpha-value>)',
          danger: 'rgb(var(--nodel-danger) / <alpha-value>)',
          dangerFill: 'rgb(var(--nodel-danger-fill) / <alpha-value>)',
          onDanger: 'rgb(var(--nodel-on-danger) / <alpha-value>)',
          dangerBg: 'rgb(var(--nodel-danger-bg) / <alpha-value>)',
          dangerBorder: 'rgb(var(--nodel-danger-border) / <alpha-value>)',
          focus: 'rgb(var(--nodel-focus) / <alpha-value>)',
          statusOff: 'rgb(var(--nodel-status-off) / <alpha-value>)',
          success: 'rgb(var(--nodel-success) / <alpha-value>)',
          successFill: 'rgb(var(--nodel-success-fill) / <alpha-value>)',
          onSuccess: 'rgb(var(--nodel-on-success) / <alpha-value>)',
          warning: 'rgb(var(--nodel-warning) / <alpha-value>)',
          warningFill: 'rgb(var(--nodel-warning-fill) / <alpha-value>)',
          onWarning: 'rgb(var(--nodel-on-warning) / <alpha-value>)'
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
        'nodel-card': 'var(--nodel-shadow-card)',
        'nodel-control': 'var(--nodel-shadow-control)',
        'nodel-control-active': 'var(--nodel-shadow-control-active)',
        'nodel-panel': 'var(--nodel-shadow-panel)',
        'nodel-popover': 'var(--nodel-shadow-popover)',
        'nodel-editor-status': 'var(--nodel-shadow-editor-status)'
      }
    }
  },
  plugins: []
} satisfies Config;
