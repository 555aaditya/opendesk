// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import { monoLight, monoDark } from './src/lib/shiki.mjs';

export default defineConfig({
  site: 'https://opendesk.sh',
  trailingSlash: 'always',
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  build: { format: 'directory' },
  integrations: [
    mdx(),
    sitemap({ filter: (page) => !page.includes('/404') }),
  ],
  markdown: {
    shikiConfig: { themes: { light: monoLight, dark: monoDark }, defaultColor: 'light' },
  },
  vite: { plugins: [tailwindcss()] },
});
