import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPublishedPosts } from '../../lib/blog';

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts();
  return rss({
    title: 'opendesk blog',
    description: 'Notes from the team building opendesk, the open-source helpdesk.',
    site: context.site ?? 'https://opendesk.sh',
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: `/blog/${p.id}/`,
    })),
    customData: '<language>en-us</language>',
  });
}
