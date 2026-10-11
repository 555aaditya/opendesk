---
title: Storage
description: Store attachments and raw email on local disk, Amazon S3, Cloudflare R2 or MinIO.
---

opendesk stores attachments and raw inbound email in object storage. Everything else is in Postgres.

## Local disk

The default. Files are kept under `DATA_DIR` (the `/data` volume in the self-host bundle).

```sh
STORAGE_DRIVER=local
```

Back up the data volume along with the database; `opendesk-ctl backup` does both. With the local driver, downloads are streamed by opendesk.

## Amazon S3

```sh
STORAGE_DRIVER=s3
S3_BUCKET=acme-opendesk-attachments
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
```

Keep the bucket private (block all public access). opendesk hands out short-lived signed URLs for downloads. The key needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on the bucket. Leave the access key empty to use the standard AWS credential chain, such as an instance role.

## Cloudflare R2

```sh
STORAGE_DRIVER=s3
S3_BUCKET=opendesk
S3_REGION=auto
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Create an R2 API token with **Object Read & Write** on the bucket.

## MinIO

```sh
STORAGE_DRIVER=s3
S3_BUCKET=opendesk
S3_REGION=us-east-1
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

MinIO usually needs path-style URLs. The installer's `--wizard` can add a bundled S3-compatible store.

## Moving between drivers

Changing the driver does not move existing files. Copy the existing objects to the new store with the same keys (for example with `rclone` or `aws s3 sync` from the data volume) before switching, then restart opendesk.
