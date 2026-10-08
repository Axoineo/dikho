/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],

  // Bind Tailwind's `dark:` variant to the attribute the app already toggles
  // from Settings, so new screens follow the existing theme switch instead of
  // introducing a second, competing dark-mode mechanism.
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    extend: {
      borderRadius: { bubble: '7.5px' },
      boxShadow: { bubble: 'var(--chat-shadow)' },
      colors: {
        // Mapped to the design tokens in src/index.css. Using these instead of
        // literal palette classes (bg-gray-900) means a colour only has to be
        // corrected in one place, and the light/dark toggle keeps working
        // without a `dark:` variant on every single element.
        page: 'var(--page)',
        surface: 'var(--surface)',
        line: 'var(--line)',
        'line-soft': 'var(--line-soft)',
        ink: 'var(--text)',
        muted: 'var(--muted)',
        brand: {
          DEFAULT: 'var(--brand-blue)',
          dark: 'var(--brand-blue-dark)',
          soft: 'var(--brand-blue-soft)',
        },
        ok: 'var(--success)',
        danger: 'var(--danger)',
        accent: 'var(--accent)',

        // Explicit tints rather than opacity modifiers (bg-ok/15): Tailwind v3
        // cannot apply an alpha channel to a `var(--x)` colour unless the token
        // is stored as raw channels, so the modifier would silently emit
        // nothing. These literals are the same values index.css already uses.
        tint: {
          ok: 'rgba(74, 143, 106, 0.14)',
          'ok-line': 'rgba(74, 143, 106, 0.32)',
          danger: 'rgba(217, 83, 79, 0.12)',
          'danger-line': 'rgba(217, 83, 79, 0.30)',
          warn: 'rgba(249, 175, 27, 0.15)',
          'warn-line': 'rgba(249, 175, 27, 0.32)',
          'brand-line': 'rgba(56, 128, 200, 0.28)',
        },

        // Inbox surfaces, defined in src/index.css for both themes. The inbox
        // needs a depth level the generic surface/page pair doesn't cover: a
        // canvas set back from the chrome so message bubbles lift off it.
        chat: {
          shell: 'var(--chat-shell)',
          bar: 'var(--chat-bar)',
          canvas: 'var(--chat-canvas)',
          'bubble-in': 'var(--chat-bubble-in)',
          'bubble-out': 'var(--chat-bubble-out)',
          'bubble-out-text': 'var(--chat-bubble-out-text)',
          raised: 'var(--chat-raised)',
          ring: 'var(--chat-ring)',
          text: 'var(--chat-text)',
          sub: 'var(--chat-sub)',
          accent: 'var(--chat-accent)',
          'accent-ink': 'var(--chat-accent-ink)',
          tick: 'var(--chat-tick)',
          chip: 'var(--chat-chip)',
          'row-active': 'var(--chat-row-active)',
          'row-hover': 'var(--chat-row-hover)',
          input: 'var(--chat-input)',
          'on-accent': 'var(--chat-on-accent)',
          meta: 'var(--chat-meta)',
          quote: 'var(--chat-quote)',
          'quote-you': 'var(--chat-quote-you)',
          'quote-them': 'var(--chat-quote-them)',
          secondary: 'var(--chat-secondary)',
          action: 'var(--chat-action)',
        },

        // Inbox CHROME — the list, headers, search, filters, contact panel and
        // composer controls. Separate from `chat` on purpose: `chat` is the
        // thread, which deliberately keeps WhatsApp's palette, while these
        // follow the dashboard so the surrounding UI matches the rest of the
        // app. Defined for both themes in src/index.css.
        inbox: {
          'row-hover': 'var(--inbox-row-hover)',
          'row-active': 'var(--inbox-row-active)',
          control: 'var(--inbox-control)',
          chip: 'var(--inbox-chip)',
          field: 'var(--inbox-field)',
          panel: 'var(--inbox-panel)',
          // Literal rgba, not `ring-brand/30`: per the note above, an alpha
          // modifier on a var() colour makes Tailwind emit NOTHING at all, so
          // that focus ring was silently absent rather than merely wrong.
          focus: 'var(--inbox-focus)',
          divider: 'var(--inbox-divider)',
          list: 'var(--inbox-list)',
        },

        // WhatsApp's own client colours, for the message preview only.
        // Deliberately not themed: it mimics their app, not this dashboard.
        wa: {
          canvas: '#0b141a',
          bar: '#1f2c33',
          bubble: '#005c4b',
          text: '#e9edef',
          tick: '#53bdeb',
          sub: '#8696a0',
        },
      },
    },
  },

  // Preflight is OFF on purpose. This is a retrofit into an existing
  // ~3,200-line stylesheet; Tailwind's base reset would restyle every page in
  // the dashboard (buttons, headings, tables) and break the current UI.
  corePlugins: { preflight: false },
}
