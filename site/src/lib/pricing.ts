/*
 * Plans and AI credits, from contracts/billing.md. Prices render on /pricing, the
 * home page teaser and the JSON-LD offers; nothing else hard-codes a price.
 *
 * PLACEHOLDER: the credit pack price is not decided (CREDIT_PACK.price). The yearly
 * Pro price is not decided either, so the site shows monthly pricing only.
 */
export const PRO_PRICE = 19; // USD per seat per month, billed monthly

export const CREDIT_PACK = {
  credits: 2000,
  price: null as number | null, // PLACEHOLDER: pack price not decided yet
};

export type Plan = {
  id: 'free' | 'pro' | 'self_hosted';
  name: string;
  blurb: string;
  price: string;
  unit: string;
  note: string;
  cta: { label: string; href: string };
  featured?: boolean;
  limits: string[];
};

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    blurb: 'For a founder or a one-person support desk. Free forever, for any organization.',
    price: '$0',
    unit: 'forever',
    note: 'Per workspace',
    cta: { label: 'Start for free', href: 'https://app.opendesk.sh/signup' },
    limits: ['1 mailbox', '1 team member', '50 AI credits a month', 'Every feature'],
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'For teams. Everything unlimited, billed for the people who answer customers.',
    price: `$${PRO_PRICE}`,
    unit: 'per user / month',
    note: 'Viewers are free',
    cta: { label: 'Start for free', href: 'https://app.opendesk.sh/signup' },
    featured: true,
    limits: ['Unlimited mailboxes', 'Unlimited team members', '1,000 AI credits per seat a month, pooled', 'Every feature'],
  },
  {
    id: 'self_hosted',
    name: 'Self-hosted',
    blurb: 'Run it on your own servers, with your own AI key or a local model.',
    price: '$0',
    unit: 'free, unlimited',
    note: 'Apache-2.0',
    cta: { label: 'Self-hosting guide', href: '/self-hosting/' },
    limits: ['Unlimited mailboxes', 'Unlimited team members', 'Unlimited AI with your own key', 'Every feature'],
  },
];

// Every plan runs the same code, so no feature is held back by plan.
export const ALL_FEATURES = [
  'Shared inboxes and live chat',
  'Knowledge base and help center',
  'AI drafts, summaries and copilot',
  'Translation and 13 widget languages',
  'Automations and SLA policies',
  'Reports and CSAT surveys',
  'REST API, webhooks and realtime',
  'Teams, roles, 2FA and audit log',
];

// contracts/billing.md, "Credit costs". Failed calls cost nothing.
export const CREDIT_COSTS: { feature: string; credits: number }[] = [
  { feature: 'Summarize a ticket', credits: 1 },
  { feature: 'Rewrite a draft (tone, length, grammar)', credits: 1 },
  { feature: 'Translate a message or draft', credits: 1 },
  { feature: 'Auto-triage (tags, priority, sentiment, language)', credits: 1 },
  { feature: 'Ask the copilot about a ticket', credits: 2 },
  { feature: 'Draft a reply', credits: 3 },
  { feature: 'Answer bot reply in the widget', credits: 3 },
  { feature: 'Draft a knowledge base article from tickets', credits: 5 },
];
