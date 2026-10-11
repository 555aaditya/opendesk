// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.opendesk.sh',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'opendesk docs',
      description: 'Documentation for opendesk, the open-source helpdesk: shared inboxes, live chat, a knowledge base and a public API.',
      logo: {
        light: './src/assets/lockup.svg',
        dark: './src/assets/lockup-white.svg',
        replacesTitle: true,
        alt: 'opendesk',
      },
      favicon: '/favicon.svg',
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs.opendesk.sh/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/opendesk/opendesk' }],
      editLink: { baseUrl: 'https://github.com/opendesk/opendesk/edit/main/docs/' },
      lastUpdated: false,
      disable404Route: true,
      customCss: [
        '@fontsource/geist-sans/400.css',
        '@fontsource/geist-sans/500.css',
        '@fontsource/geist-sans/600.css',
        '@fontsource/geist-mono/400.css',
        '@fontsource/geist-mono/500.css',
        './src/styles/theme.css',
      ],
      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      expressiveCode: {
        themes: ['min-dark', 'min-light'],
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'var(--sl-color-hairline)',
          codeFontFamily: 'var(--__sl-font-mono)',
          uiFontFamily: 'var(--__sl-font)',
          frames: { shadowColor: 'transparent' },
        },
      },
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'What is opendesk', slug: 'getting-started/introduction' },
            { label: 'Quickstart (Cloud)', slug: 'getting-started/quickstart-cloud' },
            { label: 'Quickstart (self-host)', slug: 'getting-started/quickstart-self-host' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Inbox and tickets', slug: 'guides/inbox-and-tickets' },
            {
              label: 'Mailboxes',
              items: [
                { label: 'Overview', slug: 'guides/mailboxes' },
                { label: 'Forwarding', slug: 'guides/mailboxes/forwarding' },
                { label: 'IMAP and SMTP', slug: 'guides/mailboxes/imap-smtp' },
                { label: 'Connect Google', slug: 'guides/mailboxes/google' },
                { label: 'Connect Microsoft', slug: 'guides/mailboxes/microsoft' },
              ],
            },
            {
              label: 'Live chat widget',
              items: [
                { label: 'Embed the widget', slug: 'guides/live-chat' },
                { label: 'Identity verification', slug: 'guides/live-chat/identity-verification' },
              ],
            },
            { label: 'Knowledge base and help center', slug: 'guides/knowledge-base' },
            { label: 'Automations', slug: 'guides/automations' },
            { label: 'SLA policies', slug: 'guides/sla-policies' },
            { label: 'Saved replies and views', slug: 'guides/saved-replies-and-views' },
            { label: 'Teams and roles', slug: 'guides/teams-and-roles' },
            { label: 'Reports', slug: 'guides/reports' },
            { label: 'CSAT', slug: 'guides/csat' },
            { label: 'Notifications', slug: 'guides/notifications' },
            { label: 'AI features', slug: 'guides/ai' },
            { label: 'Cloud plans and billing', slug: 'guides/billing' },
            { label: 'Keyboard shortcuts', slug: 'guides/keyboard-shortcuts' },
          ],
        },
        {
          label: 'API',
          items: [
            { label: 'Overview', slug: 'api' },
            { label: 'Authentication', slug: 'api/authentication' },
            { label: 'Errors', slug: 'api/errors' },
            { label: 'Pagination', slug: 'api/pagination' },
            { label: 'Rate limits', slug: 'api/rate-limits' },
            { label: 'Idempotency', slug: 'api/idempotency' },
            {
              label: 'Resources',
              items: [
                { label: 'Tickets', slug: 'api/resources/tickets' },
                { label: 'Messages and attachments', slug: 'api/resources/messages' },
                { label: 'Contacts and companies', slug: 'api/resources/contacts' },
                { label: 'Tags, views and saved replies', slug: 'api/resources/organization' },
                { label: 'Automations and SLA', slug: 'api/resources/automations-sla' },
                { label: 'Knowledge base', slug: 'api/resources/knowledge-base' },
                { label: 'Mailboxes', slug: 'api/resources/mailboxes' },
                { label: 'Widget', slug: 'api/resources/widget' },
                { label: 'Workspace and members', slug: 'api/resources/workspace' },
                { label: 'Account and auth', slug: 'api/resources/account' },
                { label: 'API keys and webhooks', slug: 'api/resources/api-keys-webhooks' },
                { label: 'Search and reports', slug: 'api/resources/search-reports' },
                { label: 'AI', slug: 'api/resources/ai' },
                { label: 'Billing', slug: 'api/resources/billing' },
                { label: 'Public help center and CSAT', slug: 'api/resources/public' },
                { label: 'System', slug: 'api/resources/system' },
              ],
            },
            { label: 'Webhooks', slug: 'api/webhooks' },
            { label: 'Realtime', slug: 'api/realtime' },
            { label: 'Events catalog', slug: 'api/events' },
            { label: 'OpenAPI reference', slug: 'api/openapi' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Overview', slug: 'self-hosting' },
            { label: 'Requirements', slug: 'self-hosting/requirements' },
            { label: 'Install script', slug: 'self-hosting/install-script' },
            { label: 'Docker Compose', slug: 'self-hosting/docker-compose' },
            { label: 'Configuration reference', slug: 'self-hosting/configuration' },
            { label: 'Postgres and Neon', slug: 'self-hosting/postgres' },
            { label: 'Email setup', slug: 'self-hosting/email' },
            { label: 'Google and Microsoft OAuth', slug: 'self-hosting/oauth-apps' },
            { label: 'Storage', slug: 'self-hosting/storage' },
            { label: 'AI', slug: 'self-hosting/ai' },
            { label: 'Scaling', slug: 'self-hosting/scaling' },
            { label: 'Backups and upgrades', slug: 'self-hosting/backups-and-upgrades' },
            { label: 'Security hardening', slug: 'self-hosting/hardening' },
          ],
        },
        {
          label: 'Cloud architecture',
          items: [{ label: 'Domains, AWS and Cloudflare', slug: 'cloud/architecture' }],
        },
        {
          label: 'Security',
          items: [
            { label: 'Security controls', slug: 'security' },
            { label: 'Responsible disclosure', slug: 'security/disclosure' },
          ],
        },
        { label: 'Contributing', items: [{ label: 'Contributing', slug: 'contributing' }] },
      ],
    }),
  ],
});
