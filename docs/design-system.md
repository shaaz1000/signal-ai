# Design system

**Reference.** Apple's Human Interface Guidelines (https://developer.apple.com/design/human-interface-guidelines): clarity, deference to content, depth through hierarchy rather than decoration. No Apple-specific design skill was installed in the build environment; the general `frontend-design` and `artifact-design` skills were applied alongside the HIG and the tokens in the product brief.

**Direction.** Editorial reading surface, macOS-style sidebar, disciplined interaction. One accent colour, used only for action and selection. No gradients, no glass panels, no coloured cards. Shadows appear in exactly one place (the selected segment of a segmented control).

**The one signature element** is the confidence indicator: four bars, like signal strength, always paired with a text label so it never relies on colour. It appears on every card, row and detail page.

## Tokens

Defined once in `app/globals.css` as CSS variables, mapped into Tailwind with `@theme inline`, and compiled into both the app and the Artifact.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F5F7` | `#101114` | Page |
| `--surface` | `#FFFFFF` | `#1C1D21` | Cards, grouped lists, fields |
| `--surface-2` | `#FAFAFC` | `#232429` | Row hover |
| `--fg` | `#1D1D1F` | `#F5F5F7` | Primary text |
| `--fg2` | `#636369` | `#A1A1A6` | Secondary text |
| `--fg3` | `#86868B` | `#7C7C82` | Decoration only: icons, placeholders. Never body text. |
| `--sep` / `--sep-soft` | `#D2D2D7` / `#E6E6EB` | `#34353A` / `#2A2B30` | Hover borders / resting borders and rules |
| `--accent-fill` | `#0071E3` | `#0071E3` | Filled buttons (white text) |
| `--accent-text` | `#0066CC` | `#4AA3FF` | Links, selected icons |
| `--good` / `--warn` / `--bad` | `#1D7A35` / `#8F5600` / `#C22B1F` | `#4CC267` / `#E8AD3C` / `#FF6B5E` | Status only, always with a word or icon |

**Refinements made to the brief's starting tokens, and why**

- Secondary text moved from `#6E6E73` to `#636369` in light mode. The original passes 4.5:1 on white but not on tinted fills (tags, segmented controls). Found by the automated accessibility scan.
- The dark accent `#0A84FF` is kept for non-text accents, but filled buttons use `#0071E3` in both themes: white on `#0A84FF` is 3.7:1.
- Accent used as text is darker than accent used as fill (`#0066CC` on light backgrounds).

Themes follow the three-state contract: no attribute means "follow the system" (`prefers-color-scheme`), and `data-theme="light"` or `"dark"` on the root overrides it in either direction. In the app the server sets the attribute from a cookie, so there is no flash and no inline script.

## Type

System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. San Francisco renders on Apple devices; Inter is used when it is installed; no font files are bundled or downloaded.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Hero (`.t-hero`) | 28 to 44px, fluid | 700 | −0.024em |
| Page title (`.t-page`) | 26 to 34px, fluid | 700 | −0.022em |
| Section (`.t-section`) | 21px | 650 | −0.016em |
| Card title (`.t-card`) | 17px | 600 | −0.012em |
| Body (`.t-body`) | 16px / 1.55 | 400 | 0 |
| Small (`.t-small`) | 15px / 1.5 | 400 | 0 |
| Metadata (`.t-meta`) | 13px / 1.4 | 400 | 0 |

Running text is capped at 68 characters (`.measure`). Headings use `text-wrap: balance`. Numbers that line up use tabular figures (`.t-num`).

## Layout

- **Desktop (1024px and up):** fixed 248px sidebar, one content column capped at 1240px, 40px gutters.
- **Tablet and phone:** sticky top bar, bottom tab bar with five destinations (Today, Discover, Radar, Research, More), 16 to 24px gutters. Nothing depends on hover.
- **Density:** `data-density="compact"` tightens card padding, row padding and grid gaps through three variables.
- Radius: 16px for cards and grouped lists, 10px for fields, full for buttons and chips. Touch targets are 36 to 44px.

**Cards versus lists.** Cards are for standalone stories (discovery grid, featured story). Dense, comparable data (repositories, recent updates, settings, sources) uses grouped lists: one surface with hairline separators.

## Components

| Component | File | Notes |
|---|---|---|
| Navigation (sidebar, top bar, tab bar) | `components/navigation/shell.tsx` | Skip link, `aria-current`, remembers each section's last filters |
| Search field, filter controls, time-window selector, reset, load more | `components/discovery/filter-bar.tsx`, `components/ui/controls.tsx` | Debounced search; filters live in the URL |
| Discovery card, featured story, repository row, compact row | `components/discovery/card.tsx` | Whole card is one link; bookmark sits above it |
| Category chip, tag | `.chip`, `.tag` | Chips are toggle buttons with `aria-pressed` |
| Credibility indicator | `Confidence` in `components/ui/primitives.tsx` | Bars plus text |
| Loading skeleton, empty state, error state, notice | `components/ui/primitives.tsx` | Errors say what happened and what to do |
| Bookmark control | `components/discovery/bookmark-button.tsx` | `aria-pressed`, label names the item |
| Detail page | `components/discovery/detail.tsx` | A page, not a drawer, so it has a shareable URL |
| Theme toggle | `components/ui/controls.tsx` | Cycles system, light, dark; label states the current setting |

## Motion

Colour and border transitions of 150ms on interactive elements, a pulse on skeletons and a spin on the refresh icon. No entrance animations. Everything is disabled under `prefers-reduced-motion: reduce`.

## Accessibility

Target: WCAG 2.2 AA. Semantic landmarks and heading order; visible focus rings; all controls reachable and operable by keyboard; status conveyed by text as well as colour; no horizontal scrolling at 390px. Verified by automated axe scans (light and dark, three viewports) and keyboard tests in `tests/e2e/app.spec.ts`. Automated scans do not replace testing with a screen reader, which has not been done.
