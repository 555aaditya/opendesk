---
title: Profile pictures and logos
description: Where pictures of agents, customers and companies come from, how to upload your own, and how they are kept safe.
---

opendesk shows a picture next to every agent, contact and company. When there is none, it shows initials. Pictures come from an upload or from an automatic source, and an upload always wins.

## Where pictures come from

| Who | Sources, highest first |
| --- | --- |
| Agents | Your upload, then the picture from Google or GitHub when you sign in with them |
| Contacts | An agent's upload, then the picture your site passes to a verified chat widget session, then Gravatar (when turned on) |
| Companies | An agent's upload, then the company website's icon (when turned on) or the logo provider your instance configures |
| Workspace | The logo an admin uploads |

Microsoft and single sign-on accounts carry no picture, so those agents upload one.

### Gravatar

Gravatar is **off** by default. When an admin turns it on in workspace settings, opendesk sends a hash of each contact's email to Gravatar and uses the picture if one exists. Turning it off removes Gravatar pictures.

### Company websites

Company logos are on by default. opendesk reads the company domain's home page for its app icon or favicon and uses the first usable square image of at least 32 px. Turn it off with the **Company logos** setting.

### Chat widget

When your site [verifies the visitor](/guides/live-chat/identity-verification/), it can pass `avatar_url` with the session. opendesk copies that picture to the contact. Unverified sessions never set a picture.

## Upload a picture

- **Your photo**: in **Settings, Profile**.
- **Contacts and companies**: on the contact or company page. Any agent can upload or remove one.
- **Workspace logo and brand images**: admins, in workspace settings. The help center uses its own logo and favicon if set, else the workspace logo. The chat widget uses its avatar and launcher icon if set, else the workspace logo.

Images are PNG, JPEG, GIF or WebP, at most 5 MB. Removing an upload brings back the automatic picture, if there is one.

## How pictures are handled

- Every picture is downloaded by the server, never loaded from the original site by your browser or your customers'.
- Only PNG, JPEG, GIF and WebP content is accepted, checked from the bytes themselves. SVG and anything else is refused.
- Size is capped before decoding (5 MB, 4096 px a side). Pictures are cropped to a square, resized to 256 and 64 px and saved as PNG without any metadata, so location and camera data never survive.
- Downloads use https only, refuse private and internal network addresses on every redirect, and time out after 10 seconds.
- Pictures are served with long-lived caching and strict headers that stop them from running as anything other than an image.
- Uploads and removals are recorded in the audit log.

## Refreshing

Automatic pictures are checked again every 30 days. When a lookup finds nothing, opendesk waits 1, 2, 4, 8 and 16 days before trying again, then every 30 days. To look one up now, call `POST /v1/contacts/{id}/avatar/refresh` or `POST /v1/companies/{id}/avatar/refresh`.

## Self-hosting

Company logos from websites work with no setup. To use [logo.dev](https://logo.dev) instead, set `LOGO_DEV_TOKEN` (see the [configuration reference](/self-hosting/configuration/#profile-pictures)).
