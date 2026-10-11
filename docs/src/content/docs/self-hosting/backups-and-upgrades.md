---
title: Backups and upgrades
description: Back up and restore a self-hosted opendesk, and move between releases.
---

## What to back up

| What | Why |
| --- | --- |
| The Postgres database | Everything except files. |
| The data volume (`/data`) | Attachments and raw email with the `local` storage driver. |
| `.env` | Secrets. **`CREDENTIALS_KEY` cannot be recovered**, and without it stored mailbox credentials cannot be decrypted. |

## Back up

```sh
/opt/opendesk/opendesk-ctl backup [dir]
```

This writes `backups/<UTC time>/` (or under `dir`) containing:

- `db.dump`: a `pg_dump` in custom format
- `data.tar.gz`: the opendesk data volume
- `env`: a copy of `.env`
- `VERSION`: the running release

The directory is created with mode `0700`. It contains your secrets: copy it off the machine, to encrypted storage you control. Schedule it with cron:

```sh
0 3 * * * /opt/opendesk/opendesk-ctl backup >> /var/log/opendesk-backup.log 2>&1
```

If you use an external database or S3 storage, back those up with your provider's tools as well.

## Restore

```sh
/opt/opendesk/opendesk-ctl restore /path/to/backups/20261011T030000Z
```

It stops the app, replaces the database and the data volume, and asks you to type `restore` first (`OPENDESK_YES=1` skips the prompt). Keep the same `CREDENTIALS_KEY` and `AUTH_SECRET` as the backup.

## Upgrade

```sh
/opt/opendesk/opendesk-ctl upgrade            # the newest release
/opt/opendesk/opendesk-ctl upgrade v1.2.3     # a specific release
```

An upgrade:

1. takes a backup (skip with `OPENDESK_SKIP_BACKUP=1`)
2. downloads that release's installer and checks it against its published SHA-256
3. reruns it in place with `--version`, keeping every secret and setting
4. pulls the new images and restarts

Migrations run when opendesk starts, so there is no separate migration step. Read the [release notes](https://github.com/useopendesk/opendesk/releases) before upgrading across several versions.

To roll back, restore the backup taken before the upgrade, then install the earlier version with `--version`.
