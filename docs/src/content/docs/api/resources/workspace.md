---
title: Workspace and members
description: The workspace, its members, invitations, teams, audit logs and notifications.
---

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/workspaces` | Create a workspace; you become its owner |
| `GET`, `PATCH` | `/v1/workspace` | The current workspace (`OD-Workspace`) |
| `DELETE` | `/v1/workspace` | Owner with two-factor: delete it and all its data |
| `POST` | `/v1/workspace/transfer` | Owner with two-factor: transfer ownership |
| `POST` | `/v1/workspace/widget-secret/rotate` | Admin: new widget secret, shown once |
| `GET` | `/v1/members` | List members |
| `PATCH`, `DELETE` | `/v1/members/{user_id}` | Change a role, or remove a member |
| `GET`, `POST` | `/v1/invitations` | List or send invitations |
| `DELETE` | `/v1/invitations/{id}` | Revoke an invitation |
| `GET` | `/v1/invitations/lookup?token=` | Public: what an invitation is for |
| `POST` | `/v1/invitations/accept` | Accept an invitation (no workspace header) |
| `GET`, `POST` | `/v1/teams` | List or create teams |
| `GET`, `PATCH`, `DELETE` | `/v1/teams/{id}` | |
| `GET` | `/v1/audit-logs` | Admin: the audit log |
| `GET` | `/v1/notifications` | Your notifications |
| `POST` | `/v1/notifications/read` | Mark notifications read |

## Objects

```ts
type Workspace = { id: string; name: string; slug: string; widget_key: string; settings: WorkspaceSettings; created_at: string };
type WorkspaceSettings = {
  brand_color?: string;
  timezone?: string;
  help_center_enabled?: boolean;
  help_center_title?: string;
  csat_enabled?: boolean;
  auto_assign?: "none" | "round_robin";
};
type Member = { user: UserRef; role: "owner" | "admin" | "agent" | "viewer"; created_at: string };
type Invitation = { id: string; email: string; role: Role; expires_at: string; created_at: string; invited_by: UserRef | null };
type Team = { id: string; name: string; member_ids: string[]; created_at: string };
type AuditLog = {
  id: string;
  actor: { type: "user" | "api_key" | "system"; user: UserRef | null; api_key_id: string | null };
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown>;
  ip: string;
  created_at: string;
};
```

## Update settings

```sh
curl -X PATCH https://api.opendesk.sh/v1/workspace \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{ "settings": { "csat_enabled": true, "auto_assign": "round_robin" } }'
```

## Invite a member

```sh
curl https://api.opendesk.sh/v1/invitations \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{ "email": "sam@example.com", "role": "agent" }'
```

Invitations can grant `admin`, `agent` or `viewer`.

## Delete the workspace

```sh
curl -X DELETE https://api.opendesk.sh/v1/workspace \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "OD-Workspace: $WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{ "confirm_name": "Example" }'
```

Requires the owner, with two-factor authentication and a recent sign-in. All workspace data is removed.

## Notifications

```ts
type Notification = {
  id: string;
  type: "assigned" | "mentioned" | "customer_replied" | "sla_breached";
  ticket: { id: string; number: number; subject: string } | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
```

Mark some or all read with `POST /v1/notifications/read` and `{ "ids": [...] }` or `{ "all": true }`. New notifications arrive live as `notification.created` on your `user:<uid>` topic.

## Events

`member.added`, `member.updated`, `member.removed`, `team.*`, `notification.created`.
