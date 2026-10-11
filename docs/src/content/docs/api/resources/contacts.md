---
title: Contacts and companies
description: Manage the people who write in and the companies they belong to.
---

Scopes: `contacts:read` to read, `contacts:write` to change.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/contacts` | List contacts. Filters: `q`, `company_id` |
| `POST` | `/v1/contacts` | Create a contact |
| `GET` | `/v1/contacts/{id}` | Get a contact |
| `PATCH` | `/v1/contacts/{id}` | Update a contact |
| `DELETE` | `/v1/contacts/{id}` | Delete a contact |
| `GET` | `/v1/contacts/{id}/tickets` | The contact's tickets |
| `GET`, `POST` | `/v1/companies` | List or create companies |
| `GET`, `PATCH`, `DELETE` | `/v1/companies/{id}` | Get, update or delete a company |

## Objects

```ts
type Contact = {
  id: string;
  email: string | null;
  name: string;
  phone: string;
  avatar_url: string;
  company: { id: string; name: string; domain: string } | null;
  external_id: string | null;
  notes: string;
  custom: Record<string, unknown>;
  blocked: boolean;
  ticket_count: number;
  created_at: string;
  updated_at: string;
};

type Company = {
  id: string;
  name: string;
  domain: string;
  notes: string;
  custom: Record<string, unknown>;
  contact_count: number;
  created_at: string;
  updated_at: string;
};
```

A contact's email is unique within the workspace, and so is its `external_id`, your own id for the person (set by [verified widget sessions](/guides/live-chat/identity-verification/)). A company's domain is unique within the workspace.

## Examples

```sh
# Search
curl "https://api.opendesk.sh/v1/contacts?q=ana" -H "Authorization: Bearer od_live_..."

# Create
curl https://api.opendesk.sh/v1/contacts \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "email": "ana@example.com", "name": "Ana Silva", "custom": { "plan": "pro" } }'

# Block
curl -X PATCH https://api.opendesk.sh/v1/contacts/0192f0c4-... \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "blocked": true }'
```

## Events

`contact.created`, `contact.updated`, `contact.deleted`, and the same for `company.*`.
