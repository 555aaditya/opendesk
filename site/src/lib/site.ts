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
  github: 'https://github.com/opendesk/opendesk',
  githubIssues: 'https://github.com/opendesk/opendesk/issues',
  githubReleases: 'https://github.com/opendesk/opendesk/releases',
  license: 'https://github.com/opendesk/opendesk/blob/main/LICENSE',
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
  { href: '/features/', label: 'Features' },
  { href: '/self-hosting/', label: 'Self-hosting' },
  { href: '/pricing/', label: 'Pricing' },
  { href: LINKS.docs, label: 'Docs' },
  { href: '/changelog/', label: 'Changelog' },
] as const;
