// The docs are split into sections. The header switcher moves between them, and the
// sidebar shows only the groups of the section the current page belongs to.
export type Section = {
  id: string;
  label: string;
  /** A shorter label for narrow headers. */
  short: string;
  text: string;
  href: string;
  icon: 'book' | 'code' | 'server' | 'shield';
  /** Path prefixes that belong to this section. */
  prefixes: string[];
  /** Top-level sidebar group labels (from astro.config.mjs) shown in this section. */
  groups: string[];
};

export const SECTIONS: Section[] = [
  {
    id: 'guides',
    label: 'Guides',
    short: 'Guides',
    text: 'Set up and use opendesk, step by step',
    href: '/getting-started/introduction/',
    icon: 'book',
    prefixes: ['/getting-started/', '/guides/'],
    groups: ['Getting started', 'Guides'],
  },
  {
    id: 'api',
    label: 'API reference',
    short: 'API',
    text: 'REST API, webhooks, realtime and events',
    href: '/api/',
    icon: 'code',
    prefixes: ['/api/'],
    groups: ['API'],
  },
  {
    id: 'self-hosting',
    label: 'Self-hosting',
    short: 'Self-hosting',
    text: 'Install and run your own instance',
    href: '/self-hosting/',
    icon: 'server',
    prefixes: ['/self-hosting/', '/cloud/'],
    groups: ['Self-hosting', 'Cloud architecture'],
  },
  {
    id: 'security',
    label: 'Security',
    short: 'Security',
    text: 'Controls, disclosure and contributing',
    href: '/security/',
    icon: 'shield',
    prefixes: ['/security/', '/contributing/'],
    groups: ['Security', 'Contributing'],
  },
];

const withSlash = (path: string) => (path.endsWith('/') ? path : path + '/');

export function sectionFor(pathname: string): Section | undefined {
  const path = withSlash(pathname);
  return SECTIONS.find((s) => s.prefixes.some((p) => path.startsWith(p)));
}
