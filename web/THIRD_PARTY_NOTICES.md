# Third-party notices

This file lists third-party source code that is copied or adapted into the opendesk web app.
Dependencies installed from npm carry their own licenses in `node_modules` and are not listed here.

## Beautiful UI

- Source: https://www.beautifului.dev/ (copy-paste components; the source is published on the site)
- License: MIT
- Adapted in: `src/components/ai/ui/` (Thinking, StreamingText, Cards, Recommendation, DiffView,
  TaskRows, PromptBar) and used by `src/components/ai/**` and the Ask AI mode of
  `src/app/CommandPalette.tsx`.
- Components adapted: Thinking, Loading State, Streaming Text, Tool Chips, Approval Card,
  Recommendation Card, Context Cards, Insight Cards, Diff Table, Task Rows, Prompt Bar, Chat Composer.
- Changes: restyled to opendesk design tokens, radii and the violet AI tone; rewritten for
  Tailwind v4, motion/react and lucide-react; scripted demo timelines replaced by real
  progress; demo data, charts, shaders and brand marks removed; strings moved to i18next.

```
MIT License

Copyright (c) 2026 Shane Levine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
