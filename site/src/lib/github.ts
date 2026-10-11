import { LINKS } from './site';

// The repository's star count, read once per build for the header. A build that
// cannot reach GitHub shows the link without a number rather than an invented one.
let cache: Promise<string | null> | undefined;

export function getRepoStars(): Promise<string | null> {
  cache ??= load();
  return cache;
}

async function load(): Promise<string | null> {
  const repo = new URL(LINKS.github).pathname.replace(/^\//, '');
  try {
    const token = import.meta.env.GITHUB_TOKEN as string | undefined;
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'opendesk-site',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    const n = Number(((await res.json()) as { stargazers_count?: number }).stargazers_count);
    if (!Number.isFinite(n)) return null;
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
  } catch (err) {
    console.info(`[github] star count unavailable, showing the link without it (${(err as Error).message})`);
    return null;
  }
}
