import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import type { StarlightRouteData } from '@astrojs/starlight/route-data';
import { sectionFor } from './lib/sections';

type Entry = StarlightRouteData['sidebar'][number];
type Link = Extract<Entry, { type: 'link' }>;

const links = (entries: Entry[]): Link[] =>
  entries.flatMap((e) => (e.type === 'link' ? [e] : links(e.entries)));

// Scope the sidebar and the previous/next links to the current page's section.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const section = sectionFor(context.url.pathname);
  if (!section || !route.hasSidebar) return;

  let groups = route.sidebar.filter((e) => e.type === 'group' && section.groups.includes(e.label));
  if (groups.length === 0) return;
  // A section made of one group lists its entries directly, without a heading.
  if (groups.length === 1 && groups[0].type === 'group') groups = groups[0].entries;
  route.sidebar = groups;

  const flat = links(groups);
  const i = flat.findIndex((l) => l.isCurrent);
  if (i === -1) return;
  const { prev, next } = route.pagination;
  route.pagination = {
    prev: prev && i > 0 ? { ...prev, ...flat[i - 1] } : undefined,
    next: next && i < flat.length - 1 ? { ...next, ...flat[i + 1] } : undefined,
  };
});
