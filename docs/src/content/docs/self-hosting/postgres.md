---
title: Postgres and Neon
description: Use the bundled Postgres, your own server, or a managed service such as Neon.
---

Postgres is opendesk's only datastore. Tickets, email metadata, background jobs and the event log all live there. Migrations are embedded in the binary and run automatically at start.

The self-host bundle includes a `postgres` container. You can point opendesk at any other Postgres instead. opendesk uses stock Postgres features only, so any recent managed or self-run Postgres works.

## Two connection strings

| variable | used by |
| --- | --- |
| `DATABASE_URL` | Request handlers. Can go through a connection pooler. |
| `DATABASE_URL_DIRECT` | Migrations, background jobs and the event relay. Must be a **direct** connection, because they use session features such as `LISTEN`/`NOTIFY`. |

When `DATABASE_URL_DIRECT` is empty, opendesk uses `DATABASE_URL` for both. That is right for the bundled Postgres or any database without a transaction-mode pooler in front.

## Neon

On [Neon](https://neon.tech), each branch has a pooled and a direct host:

```sh
# Pooled: the host contains "-pooler"
DATABASE_URL=postgres://user:pass@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/opendesk?sslmode=require
# Direct: the same host without "-pooler"
DATABASE_URL_DIRECT=postgres://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/opendesk?sslmode=require
```

Turn off autosuspend (scale to zero) on the branch opendesk uses. The event relay and job workers hold a direct connection open, and suspending the compute interrupts realtime delivery.

## Other managed Postgres

The same rule applies to any provider with a pooler, such as PgBouncer in transaction mode: put the pooled URL in `DATABASE_URL` and a direct URL in `DATABASE_URL_DIRECT`. Use `sslmode=require` (or stricter) for any database reached over a network.

## Extensions

The schema uses `citext` and `gen_random_uuid()`, both available on stock Postgres 13 and later. The migration creates `citext` if it is missing, so the database user needs permission to create it, or an administrator can create it first.

## Retention

Events are kept for replay for `EVENT_RETENTION` (7 days by default), then pruned. Deleting a workspace removes all of its rows.
