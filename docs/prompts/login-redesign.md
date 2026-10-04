# Archived implementation brief: sign-in redesign

> [!NOTE]
> This file preserves a sign-in redesign brief written on 2026-10-01. It was
> not implemented: the current sign-in page predates it, and the components it
> names do not exist. It is historical context, not the current development or
> security guide. Verify behavior against the code and follow `SECURITY.md`,
> `DEVELOPMENT.md`, and `docs/SECURITY-AUDIT.md` for current requirements. All
> people, invoices, amounts and phone numbers in this brief are illustrative
> test data.

## Original brief

### Redesign the Dikho sign-in page

You are working in the Dikho repo: React 19 + Vite, Supabase auth, a large hand-written stylesheet in `src/index.css` plus Tailwind with preflight turned off. Redesign the sign-in screen (`src/features/auth/Login.jsx`). Change the look, layout, copy and UX. Keep the authentication logic working exactly as it does today.

## 0. Read first, then plan

Before writing any code, read these in full:

- `src/features/auth/Login.jsx`
- `src/layouts/AuthenticatedLayout.jsx` (it applies the theme and renders `<Login>`)
- `src/components/Icon.jsx`
- `public/dikho-logo.svg`
- `src/index.css`: the `:root` token block (top of file), the `[data-theme="dark"]` token block (around line 2237), and every rule whose selector contains `login-`, `otp-`, `auth-error`, `welcome-content`, `background-logo` or `orange-mark`. Grep for them. Some are also inside the `@media (max-width: 768px)` and `@media (max-width: 520px)` blocks.

Then write me a short plan (files you'll add, change and delete) and start.

## 1. What is wrong today (why we're doing this)

1. **Theme leak (the most visible bug).** `AuthenticatedLayout` applies the saved theme (`localStorage['dikho-theme']`, default `system`) to `<html data-theme>` even when nobody is signed in, and it renders `<Login>` from inside itself. The login CSS mixes hard-coded light colours with theme tokens. So when the theme resolves to dark, half the page goes dark: the selected "Email" tab turns into a near-black pill (`var(--surface)` = `#1a1d23`) with blue text, and the tab track gets a dark outline (`var(--line)`).
2. **Unreadable text.** The subtitle (`rgba(24,84,148,.55)`, 2.7:1), labels (`.7`, 3.7:1), placeholder (`.32`, 1.7:1) and OTP footer (`.5`, 2.4:1) all fail WCAG AA 4.5:1.
3. The "Send code" button has a 2.5px amber bottom border (`.login-button`) that looks like a rendering glitch.
4. The right half is a generic "Welcome to Dikho" gradient with a 2.8%-opacity watermark. It says nothing about what the product does.
5. The WhatsApp number field shows no country code, even though numbers default to +91.
6. Dikho is invite-only (`shouldCreateUser: false`), but the page never says so until an error appears.
7. On phones the decorative panel stacks *under* the form (min-height 260px), which is wasted scrolling.

## 2. Design direction

A calm, professional B2B sign-in. On desktop there are two columns: a clean form column on the left, and on the right a navy brand panel in the same navy as the app's sidebar (`--sidebar`). That way signing in flows straight into the product's own chrome, and the panel shows what Dikho actually does (an invoice and a WhatsApp message) instead of a generic welcome.

**The page must be fully theme-aware.** Every colour comes from a CSS custom property, so it renders correctly in light *and* dark rather than fighting whatever theme `<html>` has. Do not hard-code hex or rgba colours in the login styles. The only exception is `box-shadow` values. If you need a colour that doesn't exist, add a token.

### 2.1 New tokens

Add these tokens to `src/index.css`, in both the `:root` block and the `[data-theme="dark"]` block:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--auth-bg` | `#ffffff` | `#111318` | Form column background |
| `--field-bg` | `#ffffff` | `#1a1d23` | Input and OTP box background |
| `--field-border` | `#8390a4` | `#687080` | Input and OTP borders: 3.2:1 on white, 3.4:1 on `#1a1d23` (WCAG 1.4.11 needs 3:1) |
| `--segment-active` | `#ffffff` | `#2a2e36` | Selected tab in the method switch |
| `--segment-shadow` | `0 1px 2px rgba(24,40,65,.14), 0 0 0 1px rgba(24,40,65,.06)` | `0 1px 2px rgba(0,0,0,.4)` | Lift on the selected tab |
| `--link` | `#185494` | `#5ba0e0` | Text links and the back button (7.7:1 / 6.7:1) |
| `--danger-text` | `#b23b43` | `#e5807c` | Error text (5.8:1 / 6.2:1). The dark `--danger` `#d9534f` is only 4.3:1 as text. |
| `--on-brand` | `#ffffff` | `#ffffff` | Text on the primary button |
| `--logo` | `#185494` | `#e2e5ea` | Logo wordmark colour |
| `--tint-ok` | `rgba(74,143,106,0.14)` | (not needed) | "Paid" pill background in the brand panel |

Also change the opening `:root {` of the light token block to `:root, [data-theme="light"] {`. That lets a subtree opt back into light tokens; the brand panel uses it (see 2.5).

Existing tokens you should use: `--page`, `--surface`, `--text`, `--muted`, `--line`, `--line-soft`, `--brand-blue`, `--brand-blue-dark` (hover), `--accent`, `--danger` (error borders and icons), `--focus-ring`, `--focus-ring-soft`, `--sidebar`, `--sidebar-text`, `--sidebar-muted`, `--chat-accent`, `--chat-accent-ink`, `--chat-bubble-out`, `--chat-bubble-out-text`, `--chat-tick`, `--chat-meta`.

Fonts are already loaded in `index.html`:

- Display: `"Google Sans", "Google Sans Text", sans-serif`
- Body: the `body` stack (Google Sans Text first)

### 2.2 Layout

**Desktop (≥ 1100px)**

- The page is `min-height: 100dvh`, `display: grid; grid-template-columns: 600px 1fr`, with background `--auth-bg`.
- **Left column:** padding `48px 64px`, flex column with `justify-content: space-between`, holding three things:
  - The logo at the top.
  - The form block, 368px wide, centred horizontally and vertically.
  - The footer at the bottom.
- **Right column:** the brand panel, inset 16px from the top, right and bottom (0 on the left), `border-radius: 24px`.

**Below 1100px:** hide the brand panel. The form column goes full width and the form block is centred at a max width of 400px.

**≤ 520px (phones):**

- Column padding `32px 24px 24px`.
- The form block sits 48px below the logo (top-aligned, not vertically centred).
- The h1 is 26px/32px.
- Tabs are 44px tall.
- Inputs are 48px tall with **16px** text, which stops iOS zooming in on focus.
- The primary button is 52px tall.

### 2.3 Form column: exact content and styling

**Logo.** Create `src/components/DikhoLogo.jsx` by inlining the paths from `public/dikho-logo.svg`:

- The five wordmark paths (`fill="#185494"`) become `fill="currentColor"`.
- The dot path (`fill="#F9AF1B"`) becomes `fill="var(--accent)"`.
- Keep the viewBox `0 0 1241 420`.
- Add `role="img"` and `aria-label="Dikho"`.
- Props: `width`, `className`.

Render it at 104px wide (92px on phones) with `color: var(--logo)`.

**Step 1: entry**

- **Heading:**
  - h1 "Sign in to Dikho": display font, 500, 28px/34px, letter-spacing -0.4px, `--text`.
  - Below it, 8px gap, then p "No password needed — we'll send you a one-time code.": 15px/22px, `--muted`.
- **32px gap.**
- **Method switch (segmented tabs):**
  - Track: `--line-soft` background, radius 10px, padding 4px, two equal columns with a 4px gap.
  - Each tab: 40px tall, radius 7px, an 18px icon plus the label at 14px, 8px gap.
  - Selected tab: background `--segment-active`, text `--text` weight 600, `box-shadow: var(--segment-shadow)`.
  - Unselected tab: transparent, `--muted`, weight 500; hover changes the text to `--text`.
  - Email icon: `<Icon name="mail" />`, coloured `--link` when selected and `--muted` otherwise.
  - WhatsApp icon: the existing `WhatsAppMark` glyph, coloured `--chat-accent` when selected and `--muted` otherwise.
- **20px gap.**
- **Email field:**
  - Label "Work email": 13px/18px, 600, `--text`.
  - Input:
    - `type="email"`, `autocomplete="email"`, placeholder "you@company.com".
    - 44px tall, padding `0 14px`, 1px `--field-border`, radius 10px, `--field-bg`, 15px `--text`.
    - Placeholder colour `--muted` with `opacity: 1`.
  - Helper text under it: "Use the email your admin invited you with." (13px/18px, `--muted`).
  - 8px gaps between label, input and helper.
  - Autofocus the input only when `matchMedia('(min-width: 1100px)')` matches, so phones don't pop the keyboard.
- **WhatsApp field:**
  - Label "WhatsApp number".
  - One bordered wrapper (same border, radius and background as the input) holding two things:
    - A non-editable "+91" prefix: padding `0 12px`, background `--page`, 1px `--line` divider on its right, 15px 500 `--text`.
    - The input: `type="tel"`, `inputMode="numeric"`, `autocomplete="tel-national"`, placeholder "98765 43210", `font-variant-numeric: tabular-nums`, no border of its own.
  - Format 10-digit numbers as `98765 43210` while typing.
  - The focus ring goes on the wrapper via `:focus-within`.
  - Helper: "We'll send the code to this number on WhatsApp."
  - The prefix is visual only. Keep `toE164()` as the source of truth. If the user types or pastes a number with a leading `+` or 11–15 digits, pass it through `toE164()` unchanged so international numbers still work.
- **Field states (all fields):**
  - Focus: border `--focus-ring` plus `box-shadow: 0 0 0 3px var(--focus-ring-soft)`.
  - Error: border `--danger`, `aria-invalid="true"`, and `aria-describedby` pointing at the error message.
- **20px gap.**
- **Primary button:**
  - Full width, 48px, radius 10px, background `--brand-blue`, text `--on-brand` at 15px 600, `border: 0`.
  - **Remove the amber bottom border.**
  - Hover `--brand-blue-dark`; disabled `opacity: .5`.
  - Label "Email me a code" or "Send code on WhatsApp".
  - While loading: a 16px spinner (reuse `@keyframes spin`) plus "Sending code…", with `aria-busy="true"`.
- **Inline error.** This replaces the big red `.auth-error` box. It sits directly under the field: a 16px `alert` icon plus the message, 13px/18px, `--danger-text`, `role="alert"`.
- **32px gap.**
- **Access note:** "Don't have access yet? Ask your Dikho admin to invite you." (13px, `--muted`).

**Step 2: enter the code**

- **Back link:** a text button with a chevron-left icon, `--link`, 14px 500, 32px tall. It reads "Use a different email" or "Use a different number". It returns to step 1, keeps what was typed and focuses the input.
- **20px gap.**
- **Heading:**
  - h1 "Check your email" or "Check WhatsApp".
  - p "We sent a 6-digit code to **{destination}**." For WhatsApp, append " on WhatsApp" and show the number formatted as `+91 98765 43210`.
  - The destination is bold (600, `--text`).
- **32px gap.**
- **Code boxes:**
  - Label "Sign-in code".
  - Six boxes in a 6-column grid with 8px gap. Each box: 56px tall, radius 10px, 1px `--field-border`, `--field-bg`, centred 24px display font 600 with tabular numbers, `--text`, caret hidden.
  - Keep every existing behaviour: auto-advance, backspace to the previous box, arrow keys, pasting 6 digits, auto-submit when complete, `autocomplete="one-time-code"` on the first box.
- **Wrong or expired code:**
  - Clear the boxes and focus the first one (as today).
  - All boxes get a `--danger` border and `aria-invalid` until the user types again.
  - Show under the boxes: "That code is incorrect or has expired. Try again, or request a new code." (`--danger-text`, `role="alert"`).
- **Primary button** "Verify and sign in": loading label "Verifying…", disabled until all 6 digits are entered.
- **32px gap.**
- **Resend line:**
  - During the cooldown: "Didn't get a code? Resend in 0:42", with the countdown in m:ss and tabular numbers.
  - After the cooldown: a `--link` text button "Resend code".
  - After a successful resend, show "New code sent." in `--muted` for 4 seconds.

**Footer (both steps, bottom of the column):** "© {current year} Dikho", 13px, `--muted`.

### 2.4 Behaviour and accessibility

- **The method switch is a real tab set:**
  - `role="tablist"` with `aria-label="Sign-in method"`; each tab has `role="tab"`, `aria-selected` and `aria-controls`.
  - The form area is `role="tabpanel"` with `aria-labelledby`.
  - Roving tabindex: the selected tab is `0`, the other `-1`.
  - ArrowLeft, ArrowRight, Home and End move between tabs and select them.
- **Remember the method.** Store the last-used method in `localStorage['dikho-login-method']`: the method only, never the email or number. Wrap the access in try/catch.
- **Validation:**
  - Step 1 is a real `<form noValidate>` so Enter submits. Validate in JS:
    - Empty email: "Enter your work email."
    - Invalid email: "Enter a valid email address, like you@company.com."
    - Bad phone: "Enter a 10-digit mobile number."
  - Validate on submit. Re-validate while typing only after the first failed submit.
  - Trim and lowercase the email before sending.
- **Supabase error messages.** Extend `friendlyError()` to cover:
  - User not found, signups not allowed, or `otp_disabled`:
    - Email: "This email isn't registered with Dikho. Ask your admin to invite you."
    - WhatsApp: keep the existing "This number isn't authorized. Contact an admin to get access."
  - Rate limit (status 429, or the message mentions "security purposes" or "rate limit"): "Too many attempts. Please wait a minute and try again." If the message says "after N seconds", use N.
  - Network failure (`Failed to fetch`): "Couldn't reach Dikho. Check your connection and try again."
  - Verify errors (invalid or expired token): the step 2 message above.
  - Anything else: the raw message.
- **Focus:**
  - Entering step 2 focuses the first box (as today); going back focuses the input.
  - Every control shows `:focus-visible` as a 2px solid `--focus-ring` outline with a 2px offset.
- **Tab title.** Set `document.title = 'Sign in · Dikho'` while the login is shown. Note: `AuthenticatedLayout` sets `'Dikho CRM'` in a mount effect, and parent effects run *after* child effects, so it would overwrite the login's title. Change the layout to set `'Dikho CRM'` only when a session exists.
- Honour `prefers-reduced-motion`: no transitions, and no spinning (show just the "Sending code…" text).
- Every touch target is at least 44px.

### 2.5 Brand panel (desktop only, decorative)

Build it in `src/features/auth/BrandPanel.jsx` and give its root `data-theme="light"`. Together with the `:root, [data-theme="light"]` change, that makes it look identical in both themes: navy background, white invoice card. Put `aria-hidden="true"` on the illustration only; the headline text stays readable.

- **Container:** background `--sidebar`, radius 24px, padding `72px 72px 80px`, flex column with `space-between`, `overflow: hidden`.
- **Top block (16px gaps):**
  - Eyebrow "Be seen · Be sold": 12px, 600, uppercase, letter-spacing .14em, `--accent`.
  - h2 "Your clients, orders and WhatsApp — in one place.": display font 500, 40px/48px, letter-spacing -0.8px, `--sidebar-text`, max-width 580px.
  - p "Send invoices, track sales and purchase orders, and reply to customers on WhatsApp — without switching apps.": 16px/26px, `--sidebar-muted`, max-width 520px.
- **Illustration** (pinned to the bottom, a 560×330px relative box). It uses clearly fake sample data and is built from markup and tokens, not an image.
  - **Invoice card**, at top-left (0,0):
    - 400px wide, padding 24px, background `--surface`, radius 16px, `box-shadow: 0 24px 56px rgba(0,0,0,.32)`, flex column with 16px gap.
    - Header row: on the left, "INVOICE" (12px, 600, uppercase, .06em, `--muted`) above "INV-2041 · Sharma Traders" (15px, 600, `--text`). On the right, a "Paid" pill: 24px tall, radius 999px, background `--tint-ok`, text `--chat-accent-ink` at 12px 600, with a 12px check icon.
    - Amount "₹48,500.00": display font 500, 34px/40px, -0.6px, tabular numbers.
    - Line items: 1px `--line-soft` top border, 16px top padding, 10px gap, 14px/20px, amounts right-aligned with tabular numbers. The two rows are "Steel brackets × 120 … ₹36,000.00" and "Installation … ₹12,500.00".
    - Last line: "Paid 28 Sep 2026 · UPI", 13px, `--muted`.
  - **WhatsApp bubble**, absolutely positioned at left 236px, top 222px:
    - 324px wide, background `--chat-bubble-out`, radius `7.5px 0 7.5px 7.5px` (the tail is top-right), padding `10px 12px 8px`, `box-shadow: 0 16px 40px rgba(0,0,0,.3)`.
    - Text: "Hi Rohan, invoice INV-2041 for ₹48,500 is ready. Tap the link to view or download it.", 14px/20px, `--chat-bubble-out-text`.
    - Right-aligned meta row: "10:42" (11px, `--chat-meta`) plus a double-tick icon in `--chat-tick`.

## 3. Files

- **Add** `src/features/auth/Login.css`, imported by `Login.jsx`. It holds all login styles, uses the class prefix `auth-`, and takes colours only from `var(--…)`.
- **Split** `Login.jsx`:
  - Keep all state and Supabase logic in `Login.jsx`.
  - Move the presentational pieces into `MethodTabs.jsx`, `PhoneField.jsx`, `OtpInput.jsx` (the six boxes and their handlers) and `BrandPanel.jsx`, all in `src/features/auth/`.
  - Add `src/components/DikhoLogo.jsx`.
- **Edit** `src/index.css`:
  - Add the tokens from 2.1 and change `:root {` to `:root, [data-theme="light"] {`.
  - Delete the old login-only rules: `.login-*`, `.otp-*`, `.welcome-content*`, `.background-logo` and `.orange-mark`, plus their lines in the 768px and 520px media queries.
  - Delete the empty `/* Login page - keep light themed */` comment.
  - Grep before deleting anything shared. `.primary-button` is used across the app, so keep it. `.auth-error` shares a rule with `.page-error, .form-error`: remove `.auth-error` only from selectors where it is now unused.
- **Edit** `src/layouts/AuthenticatedLayout.jsx`: only the document-title change described in 2.4.

## 4. Do not change

- The Supabase calls:
  - `signInWithOtp` with `shouldCreateUser: false`.
  - The `verifyOtp` params (`type: 'sms'` for WhatsApp, `'email'` for email).
- `toE164()`, `checkDevice()`, `onLogin(data.session)`, the 60-second resend cooldown and the 6-digit code length.
- The theme switch itself, the sidebar, and any other screen's styles.

## 5. Done when

- `npm run check` passes.
- `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src/features/auth/Login.css` finds only `box-shadow` values.
- **The original bug is gone:** run `localStorage.setItem('dikho-theme', 'dark')`, sign out and reload. The whole login is dark and legible, the selected tab is `#2a2e36` with light text, and the brand panel looks exactly as it does in light mode. Also check `light` and `system` (with the OS set to dark).
- **Keyboard only:**
  - Tab goes tabs → field → button → links, in that order.
  - The arrow keys switch tabs.
  - Enter submits.
  - A focus ring is visible on every control.
- **At 390px wide:**
  - No horizontal scroll.
  - The panel is hidden.
  - Inputs use 16px text (iOS doesn't zoom).
- **Code step:**
  - Pasting `123456` fills all six boxes and submits.
  - A wrong code shows the inline error and clears the boxes.
  - The resend countdown shows m:ss, then "Resend code".
- All text is at least 4.5:1 and field borders at least 3:1, in both themes.

Run `npm run dev` and check every state above at 1440px, 1024px and 390px, in light and dark. Then summarise what you changed and anything you couldn't do.
