// URLs and copy shared across the site. Domains follow AGENTS.md.
export const SITE = {
  name: 'opendesk',
  url: 'https://opendesk.sh',
  tagline: 'The open-source helpdesk',
  description:
    'opendesk is the open-source helpdesk: shared email inboxes, live chat in 13 languages, AI drafts and translation, a knowledge base, automations, SLAs, reports and a public API, all updating live across your team. Free to start, or self-host it in one command.',
} as const;

export const LINKS = {
  app: 'https://app.opendesk.sh',
  signup: 'https://app.opendesk.sh/signup',
  login: 'https://app.opendesk.sh/login',
  docs: 'https://docs.opendesk.sh',
  api: 'https://api.opendesk.sh',
  apiReference: 'https://api.opendesk.sh/docs',
  openapi: 'https://api.opendesk.sh/v1/openapi.json',
  github: 'https://github.com/useopendesk/opendesk',
  githubIssues: 'https://github.com/useopendesk/opendesk/issues',
  githubReleases: 'https://github.com/useopendesk/opendesk/releases',
  license: 'https://github.com/useopendesk/opendesk/blob/main/LICENSE',
  install: 'curl -fsSL https://opendesk.sh/install.sh | sh',
} as const;

export const EMAILS = {
  hello: 'hello@opendesk.sh',
  support: 'support@opendesk.sh',
  security: 'security@opendesk.sh',
  privacy: 'privacy@opendesk.sh',
  legal: 'legal@opendesk.sh',
} as const;

// PLACEHOLDER: the operating company is not confirmed yet. Replace before launch;
// these strings appear on /privacy, /terms and /contact.
export const COMPANY = {
  legalName: '[Company legal name]',
  address: '[Registered address]',
  jurisdiction: '[Governing law jurisdiction]',
} as const;

export const NAV = [
  { href: '/self-hosting/', label: 'Self-hosting' },
  { href: '/pricing/', label: 'Pricing' },
  { href: LINKS.docs, label: 'Docs' },
  { href: '/changelog/', label: 'Changelog' },
  { href: '/blog/', label: 'Blog' },
] as const;

// The Product menu in the header and the feature anchors on /features.
export const PRODUCT_NAV = [
  { icon: 'inbox', href: '/features/#inbox', title: 'Shared inbox', desc: 'Every mailbox and channel in one queue.' },
  { icon: 'chat', href: '/features/#chat', title: 'Live chat', desc: 'A light widget that speaks 13 languages.' },
  { icon: 'sparkles', href: '/features/#ai', title: 'AI', desc: 'Drafts, summaries, triage and translation.' },
  { icon: 'book', href: '/features/#knowledge-base', title: 'Knowledge base', desc: 'A help center customers search themselves.' },
  { icon: 'zap', href: '/features/#automations', title: 'Automations and SLAs', desc: 'Rules and targets that run on arrival.' },
  { icon: 'chart', href: '/features/#reports', title: 'Reports and CSAT', desc: 'Medians, breaches and satisfaction.' },
  { icon: 'radio', href: '/features/#realtime', title: 'Realtime', desc: 'Presence, typing and live updates.' },
  { icon: 'braces', href: '/features/#api', title: 'API and webhooks', desc: 'The same REST API the app uses.' },
  { icon: 'shield', href: '/security/', title: 'Security', desc: 'CASA Tier 1 controls, written down.' },
] as const;
