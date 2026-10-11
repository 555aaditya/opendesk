---
title: Public help center and CSAT
description: Unauthenticated endpoints for the public help center and customer satisfaction ratings.
---

These endpoints need no credentials. They are what the help center and the CSAT page use, and you can use them to build your own.

## Help center

Only published articles are returned.

| method | path | |
| --- | --- | --- |
| `GET` | `/v1/public/help/{workspace_slug}` | `{ title, collections, featured }` |
| `GET` | `/v1/public/help/{workspace_slug}/collections/{slug}` | `{ collection, articles }` |
| `GET` | `/v1/public/help/{workspace_slug}/articles/{slug}` | The article; counts a view |
| `GET` | `/v1/public/help/{workspace_slug}/search?q=` | Matching articles |

```sh
curl https://api.opendesk.sh/v1/public/help/example/search?q=password
```

## CSAT

| method | path | |
| --- | --- | --- |
| `GET` | `/v1/public/csat/{token}` | The rating request |
| `POST` | `/v1/public/csat/{token}` | `{ score, comment? }` |

The token comes from the link in the rating email. See [CSAT](/guides/csat/).
