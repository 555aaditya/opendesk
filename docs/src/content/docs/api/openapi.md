---
title: OpenAPI reference
description: The machine-readable OpenAPI 3.1 document and the interactive API reference.
---

The API server generates an OpenAPI 3.1 document from the same code that serves requests, so it always matches the running version.

| | Cloud | Self-hosted |
| --- | --- | --- |
| Interactive reference | [api.opendesk.sh/docs](https://api.opendesk.sh/docs) | `https://<your-domain>/docs` |
| OpenAPI document | [api.opendesk.sh/v1/openapi.json](https://api.opendesk.sh/v1/openapi.json) | `https://<your-domain>/v1/openapi.json` |

## Generate a client

Any OpenAPI generator works. For example, TypeScript types:

```sh
npx openapi-typescript https://api.opendesk.sh/v1/openapi.json -o opendesk.d.ts
```

Or a Go client:

```sh
go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest \
  -generate types,client -package opendesk \
  https://api.opendesk.sh/v1/openapi.json > opendesk.gen.go
```

## Import into a tool

Import the document URL into Postman, Insomnia, Bruno or similar to browse and call every endpoint.

These pages explain concepts and give examples; the OpenAPI document is the authoritative list of every field and parameter.
