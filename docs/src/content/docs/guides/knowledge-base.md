---
title: Knowledge base and help center
description: Write help articles in collections and publish them to a public help center.
---

The knowledge base holds help articles, grouped into **collections**. Published articles appear in your public **help center**, which customers can browse and search, and which the chat widget links to.

## Collections

A collection has a name, a URL slug, a description and a position that sets its order. Use collections for broad topics such as "Getting started", "Billing" or "Integrations".

## Articles

An article has a title, slug, excerpt and body, and belongs to a collection (or none). Each article is a **draft** or **published**:

- Drafts are visible only to your team.
- Published articles appear in the help center and its search, and their view count increases as customers read them.

Article bodies are sanitized before they are stored, so only safe formatting reaches readers.

## The help center

Turn the help center on in workspace settings and give it a title. It is served from your workspace's slug, and lists your collections, featured articles and a search box. Only published articles are ever shown.

The help center is read through public, unauthenticated endpoints. See [Public help center API](/api/resources/public/).

## Using articles in the inbox

Global search in the inbox finds articles alongside tickets and contacts, so agents can link a customer to the right answer. Combine this with [saved replies](/guides/saved-replies-and-views/) for common questions.

## Related

- [Knowledge base API](/api/resources/knowledge-base/)
