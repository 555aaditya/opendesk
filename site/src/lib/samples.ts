// Code samples shown on the site. They follow contracts/api.md, events.md and realtime.md.
export const CREATE_TICKET = `curl https://api.opendesk.sh/v1/tickets \\
  -H "Authorization: Bearer od_live_..." \\
  -H "Idempotency-Key: 6f1c2b7e-0d4a-4f8e-9b1a-2c3d4e5f6a7b" \\
  -H "Content-Type: application/json" \\
  -d '{
    "subject": "Order 4521 arrived damaged",
    "contact": { "email": "sam@example.com", "name": "Sam Lee" },
    "channel": "api",
    "body_html": "<p>The box was crushed in transit.</p>",
    "priority": "high",
    "tags": ["shipping"]
  }'`;

export const WEBHOOK = `POST /hooks/opendesk HTTP/1.1
Content-Type: application/json
OD-Event-Type: ticket.created
OD-Event-Id: 0192f0c4-7b1e-7c2a-9f1e-3b5d2a8c4e10
OD-Signature: t=1760173200,v1=9c1e5f...

{
  "id": "0192f0c4-7b1e-7c2a-9f1e-3b5d2a8c4e10",
  "seq": 1042,
  "workspace_id": "6a0e...",
  "type": "ticket.created",
  "visibility": "agents",
  "data": { "ticket": { "number": 1042, "status": "open", "priority": "high" } },
  "occurred_at": "2026-10-11T09:00:00Z"
}`;

export const VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto';

// OD-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<body>")>
export function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest('hex');
  const a = Buffer.from(parts.v1 ?? '', 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}`;

export const REALTIME = `import { Socket } from 'phoenix';

// A short-lived token for the gateway (purpose "ws").
const { token, url } = await od.post('/v1/realtime/token');

const socket = new Socket(url, { params: { token } });
socket.connect();

const channel = socket.channel(\`workspace:\${workspaceId}\`);
channel.on('event', async (event) => {
  // seq is contiguous per workspace: a gap means we missed something.
  if (event.seq !== lastSeq + 1) await replay(lastSeq); // GET /v1/events?since=
  apply(event);
  lastSeq = event.seq;
});
channel.join();`;
