# opendesk brand

Monochrome, geometric and quiet. The mark is the "o" of opendesk drawn as a speech bubble.

Figma source: https://www.figma.com/design/JfEIfmFuwLsDJCSRXOUQGH/Branding

## Files

| Path | Use |
| --- | --- |
| `logo/lockup.svg`, `logo/lockup-white.svg` | Primary logo (mark + wordmark) |
| `logo/stacked*.svg` | Square spaces, splash screens |
| `logo/mark*.svg` | Mark on its own (avatars, small sizes) |
| `logo/wordmark*.svg` | Wordmark on its own, outlined |
| `icons/favicon.svg` | Favicon that adapts to light and dark |
| `icons/icon-*.png`, `icons/apple-touch-icon.png` | PWA, browser and app icons |
| `social/og.png` | Open Graph / GitHub social preview (1200×630) |
| `tokens.css`, `tokens.json` | Colours and type tokens |
| `logo/concepts/` | The 10 explored directions, kept for reference |

Regenerate the SVGs with `node scripts/build-brand.mjs`.

## Rules

- **Colour:** ink `#0A0A0A` on paper `#FFFFFF`, or the reverse. No gradients, tints, outlines or shadows.
- **Clear space:** at least ¼ of the mark's height on every side.
- **Minimum size:** mark 16px; lockup 80px wide.
- **Type:** Geist SemiBold at −4% tracking for headlines, Geist Regular for body, Geist Mono for code and labels.
- **Name:** always lowercase: `opendesk`. Use `opendesk.sh` only when you mean the domain.

## Palette

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#0A0A0A` | Logo, primary text, primary buttons |
| Coal | `#171717` | Dark surfaces |
| Charcoal | `#262626` | Raised dark surfaces, dark borders |
| Graphite | `#525252` | Secondary text |
| Smoke | `#8A8A8A` | Muted text, icons |
| Ash | `#E4E4E4` | Borders, dividers |
| Mist | `#F4F4F4` | Subtle fills, hover |
| Paper | `#FFFFFF` | Background |
