---
title: Teams and roles
description: Invite members, choose their role, group them into teams and secure their accounts.
---

## Roles

Every member of a workspace has one role. Roles are ordered: each one can do everything the role below it can.

| Role | Can |
| --- | --- |
| `owner` | Everything, including deleting the workspace and transferring ownership. |
| `admin` | Manage settings: mailboxes, members, API keys, webhooks, automations, SLA policies and the chat widget. |
| `agent` | Work tickets, contacts and the knowledge base. |
| `viewer` | Read only. |

## Inviting members

Admins invite people by email with a role. The invitation link expires; pending invitations can be revoked. When someone accepts, they join with the invited role. Changing a role or removing a member takes effect immediately, and a removed member's open sessions and sockets are closed. Member and role changes are recorded in the audit log.

## Teams

A **team** is a named group of members, such as "Billing" or "Tier 2". Tickets and mailboxes can belong to a team, views and automations can filter on it, and [automations](/guides/automations/) can assign to it.

## Ownership

A workspace has an owner. The owner can transfer ownership to another member, and can delete the workspace, which removes all of its data. Both actions require two-factor authentication and a recent sign-in.

## Two-factor authentication

Every member can turn on time-based one-time passwords (TOTP) in their account settings, with any authenticator app. When you enable it, you receive single-use recovery codes. Store them safely: each one works once.

## Sessions

Your account settings list your active sessions with their device and last use. Revoke any session to sign it out everywhere, including its live connections. Changing your password signs out your other sessions.

## Deleting your account

You can delete your account from your account settings. Your data is removed, not hidden. If you are the only owner of a workspace with other members, transfer ownership first.
