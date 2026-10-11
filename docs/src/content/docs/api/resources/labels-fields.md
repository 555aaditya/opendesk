---
title: Labels and custom fields
description: Manage labels, label groups and custom field definitions, and set them on tickets, contacts and companies.
---

Labels are called `tags` in the API: the routes, body members and event names keep that word. See the [Labels and custom fields guide](/guides/labels-and-custom-fields/) for how they behave in the app.

Definitions (labels, label groups, custom fields) are settings. Everyone in the workspace can read them: viewers, and API keys with `settings:read`, `tickets:read` or `contacts:read`. Changing them needs an `admin` user or a key with `settings:write`, and every change is written to the [audit log](/api/resources/workspace/). Applying labels and setting values on records is an ordinary write: `tickets:write` for tickets, `contacts:write` for contacts and companies.

| Method | Path | Description |
| --- | --- | --- |
| `GET`, `POST` | `/v1/tags` | List or create labels |
| `GET`, `PATCH`, `DELETE` | `/v1/tags/{id}` | Get, update or delete a label |
| `POST` | `/v1/tags/{id}/merge` | Merge a label into another |
| `POST` | `/v1/tags/reorder` | Set the order of labels |
| `GET`, `POST` | `/v1/tag-groups` | List or create label groups |
| `GET`, `PATCH`, `DELETE` | `/v1/tag-groups/{id}` | Get, update or delete a label group |
| `POST` | `/v1/tag-groups/reorder` | Set the order of label groups |
| `GET`, `POST` | `/v1/custom-fields` | List or create custom fields |
| `GET`, `PATCH`, `DELETE` | `/v1/custom-fields/{id}` | Get, update or delete a custom field |
| `POST` | `/v1/custom-fields/reorder` | Set the order of one entity's fields |

## Objects

```ts
type LabelColor = "gray" | "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "teal"
                | "cyan" | "blue" | "indigo" | "violet" | "purple" | "pink" | "rose";

type Tag = {
  id: string;
  name: string;
  color: LabelColor;
  description: string;
  group_id: string | null;
  position: number;
  archived: boolean;
  applies_to: ("tickets" | "contacts" | "companies")[];
  usage: { tickets: number; contacts: number; companies: number };
  created_at: string;
  updated_at: string;
};

// How a label appears on a ticket, contact or company.
type TagRef = { id: string; name: string; color: LabelColor; group_id: string | null };

type TagGroup = {
  id: string;
  name: string;
  color: LabelColor | null;
  exclusive: boolean; // at most one label of the group per record
  position: number;
  tag_count: number;
  created_at: string;
  updated_at: string;
};

type CustomField = {
  id: string;
  entity: "ticket" | "contact" | "company";
  key: string; // the key under `fields`; never changes
  name: string;
  type: "text" | "long_text" | "number" | "select" | "multi_select" | "date"
      | "checkbox" | "url" | "email" | "user";
  options: { id: string; label: string; color: LabelColor }[]; // select and multi_select
  required_on_solve: boolean; // tickets only
  description: string;
  position: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
};
```

Tickets, contacts and companies carry `tags: TagRef[]` and `fields: Record<string, FieldValue>`. `fields` only holds keys that have a value, so a cleared field is absent.

## Labels

```sh
curl https://api.opendesk.sh/v1/tags \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "name": "Churn risk", "color": "red", "description": "Talking about leaving", "applies_to": ["contacts", "companies"] }'
```

| Field | Notes |
| --- | --- |
| `name` | required. 1 to 50 characters: letters, digits, spaces and `- _ . / : & + #`. Unique in the workspace, ignoring case (`409 conflict`) |
| `color` | a `LabelColor`. Defaults to a palette colour picked from the name |
| `description` | up to 300 characters |
| `group_id` | a label group, or `null` |
| `applies_to` | which records may carry it. Defaults to all three |
| `position` | order within its group. Defaults to the end |
| `archived` | `PATCH` only. Archived labels stay on records but are hidden from pickers |

`GET /v1/tags` returns every label in one page, ordered by group position, then position, then name. Filter with `q`, `group_id` (an id or `none`), `archived` (`true`, `false` or `any`, the default) and `applies_to`.

A rename also updates the automations and views that name the label. Deleting a label removes it from every record. A workspace can have up to 1000 labels.

### Merge

```sh
curl https://api.opendesk.sh/v1/tags/$FROM_ID/merge \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "into": "'$INTO_ID'" }'
```

Every record that carried the label gets `into` instead, and the label is deleted. If `into` belongs to an exclusive group, it replaces that group's other labels on those records. Automations and views are rewritten to name `into`. The response is the `into` label.

### Reorder

`POST /v1/tags/reorder` with `{ "ids": [...] }` sets each label's `position` to its index in the list. `POST /v1/tag-groups/reorder` does the same for groups.

## Label groups

```sh
curl https://api.opendesk.sh/v1/tag-groups \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "name": "Account health", "exclusive": true }'
```

`name` is 1 to 50 characters. `color` is optional. A workspace can have up to 50 groups. Deleting a group keeps its labels and leaves them ungrouped.

In an **exclusive** group, a record holds at most one of the group's labels. Adding one removes the others. When a single write names several labels from the same exclusive group, the last one named wins. Turning a group exclusive leaves existing records as they are, and the rule applies the next time their labels change.

## Applying labels

Ticket, contact and company writes take label names:

| Field | Effect |
| --- | --- |
| `tags` | replaces the set |
| `add_tags` | adds these, keeping the rest |
| `remove_tags` | removes these |

```sh
curl -X PATCH https://api.opendesk.sh/v1/tickets/1042 \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "add_tags": ["Bug", "Export"] }'
```

By default a name that doesn't exist yet creates the label. When the workspace setting `label_creation` is `"admins"`, only admins and keys with `settings:write` can do that. Anyone else gets `422 unknown_label`. A label whose `applies_to` leaves out the record's kind is `422`. A record can carry up to 50 labels.

List filters take `tag=<name>` on `/v1/tickets`, `/v1/contacts` and `/v1/companies`.

## Custom fields

```sh
curl https://api.opendesk.sh/v1/custom-fields \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "entity": "ticket",
    "name": "Resolution",
    "type": "select",
    "required_on_solve": true,
    "options": [{ "label": "Fixed", "color": "green" }, { "label": "Answered", "color": "blue" }]
  }'
```

| Field | Notes |
| --- | --- |
| `entity`, `type` | required, and they can't change later |
| `name` | required, 1 to 60 characters, no `<` or `>` |
| `key` | defaults to a slug of the name. `^[a-z][a-z0-9_]{0,39}$`, unique per entity (`409 conflict` when you pass one that's taken). Never changes |
| `options` | for `select` and `multi_select`: `{ id?, label, color? }`. `id` defaults to a slug of the label, `color` to `gray`. Up to 200 |
| `required_on_solve` | tickets only |
| `description` | up to 300 characters |
| `archived` | `PATCH` only. Archived fields keep their values but refuse changes |

`GET /v1/custom-fields` returns all fields in one page, ordered by entity and then position. Filter with `entity` and `archived`. Each entity can have up to 100 fields. Removing an option clears it from stored values, and deleting a field removes its values from every record. `POST /v1/custom-fields/reorder` takes `{ "entity": "ticket", "ids": [...] }`.

### Values

Send `fields` on create or `PATCH`. It is merged into the stored values, and `null` (or an empty string or list) clears a key. A key that isn't defined is `422`, located at `body.fields.<key>`.

| Type | Value |
| --- | --- |
| `text` | a string, up to 1000 characters, single line |
| `long_text` | a string, up to 10000 characters |
| `number` | a JSON number |
| `select` | an option id |
| `multi_select` | a list of option ids |
| `date` | `YYYY-MM-DD` |
| `checkbox` | `true` or `false` |
| `url` | an `http` or `https` URL, up to 2000 characters |
| `email` | an email address (stored lowercase) |
| `user` | a workspace member's user id |

```sh
curl -X PATCH https://api.opendesk.sh/v1/tickets/1042 \
  -H "Authorization: Bearer od_live_..." \
  -H "Content-Type: application/json" \
  -d '{ "fields": { "product_area": "export", "affected_users": 12, "follow_up_on": null } }'
```

### Required on solve

When a ticket moves to `solved` or `closed` (through `PATCH`, bulk, or a reply with `status`) while a `required_on_solve` field is empty, the request fails:

```json
{
  "status": 422,
  "code": "field_required",
  "detail": "Fill in Resolution before solving this ticket.",
  "errors": [{ "location": "body.fields.resolution", "message": "Resolution is required to solve" }]
}
```

Send the value in the same request to solve in one step. Automations, ticket merges and auto-close aren't held back by required fields.

### Filter and sort

Ticket, contact and company lists take `field.<key>=<value>`, or `field.<key>[<op>]=<value>` to pick the operator:

| Type | Operators (default first) |
| --- | --- |
| `text`, `long_text`, `url`, `email` | `eq`, `ne`, `contains`, `not_contains`, `set`, `not_set` (ignore case) |
| `number`, `date` | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `set`, `not_set` |
| `checkbox` | `eq`, `ne`, `set`, `not_set` |
| `select`, `user` | `any`, `eq`, `ne`, `none`, `set`, `not_set` |
| `multi_select` | `any`, `all`, `none`, `eq`, `ne`, `set`, `not_set` |

`any`, `all` and `none` take a comma separated list, and `user` accepts `me`. `set` and `not_set` ignore the value.

```sh
curl "https://api.opendesk.sh/v1/tickets?field.product_area[any]=sync,export&field.affected_users[gte]=10&sort=field.affected_users&order=desc" \
  -H "Authorization: Bearer od_live_..."
```

Views store the same filters as `filters.fields: [{ key, op, value }]`. `sort=field.<key>` works for text, number, date, checkbox and select fields, and records without a value sort lowest. `q` also matches text field values.

## Events

`tag.created`, `tag.updated` and `tag.deleted`, plus `tag.merged` `{ tag_id, into }`. `tag_group.*` and `custom_field.*` follow the same pattern. Field changes on a ticket add `fields` to the `changes` of `ticket.updated` and log one `field_changed` activity per key. Contact and company events carry the new `fields`. See the [events catalog](/api/events/).
