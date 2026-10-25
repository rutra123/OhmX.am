export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        card: 'rgb(var(--card) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-soft': 'rgb(var(--fg-soft) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-faint': 'rgb(var(--fg-faint) / <alpha-value>)',
        'fg-strong': 'rgb(var(--fg-strong) / <alpha-value>)',
        amber: {
          50: 'rgb(255 251 235)',
          100: 'rgb(254 243 199)',
          200: 'rgb(253 230 138)',
          700: 'rgb(180 83 9)',
          800: 'rgb(146 64 14)',
          900: 'rgb(120 53 15)',
        },
      }
    }
  },
  plugins: []
};