---
title: Pagination
description: List endpoints use cursor pagination with limit and cursor parameters.
---

List endpoints return a page of results and a cursor for the next page.

```sh
curl "https://api.opendesk.sh/v1/contacts?limit=100" \
  -H "Authorization: Bearer od_live_..."
```

```json
{
  "data": [ { "id": "..." } ],
  "next_cursor": "eyJpZCI6Ii4uLiJ9"
}
```

| Parameter | Default | Notes |
| --- | --- | --- |
| `limit` | 50 | 1 to 100 |
| `cursor` | none | The `next_cursor` from the previous page |

When `next_cursor` is `null`, you have reached the end. Cursors are opaque: pass them back exactly as received, and do not build them yourself.

## Fetching everything

```js
async function listAll(path) {
  const all = [];
  let cursor = null;
  do {
    const url = new URL(`https://api.opendesk.sh/v1${path}`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.OPENDESK_API_KEY}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const page = await res.json();
    all.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}
```

A few endpoints return a complete list rather than a page, such as a ticket's messages and activities, which are always returned in full and in ascending order.
