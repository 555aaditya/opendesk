// Team and inbox: invite a second agent, a forwarded email becomes a ticket
// live in both inboxes, presence and typing across two browsers, reply with
// live delivery status, a note with an @mention notifies the other agent.

import { assert, cfg, inboundEmail, mailLink, newPage, openTicket, rawEmail, shot, uid, until, api } from "../lib.mjs";
import { accessToken, register } from "./account.mjs";

export async function run(t) {
  const owner = t.owner.page;
  const { page: agent, problems } = await newPage("agent");
  t.problems.push(problems);
  const agentEmail = `agent-${uid()}@example.com`;
  t.agent = { email: agentEmail, name: "Ben Agent", page: agent };

  await t.step("second user registers", async () => {
    await register(agent, { name: "Ben Agent", email: agentEmail });
  });

  await t.step("owner invites the second user", async () => {
    await owner.goto(cfg.app + "/settings/members");
    await owner.getByRole("button", { name: "Invite people" }).click();
    const dialog = owner.getByRole("dialog");
    await dialog.getByPlaceholder("name@company.com, another@company.com").fill(agentEmail);
    await dialog.getByPlaceholder("name@company.com, another@company.com").press("Enter");
    await dialog.getByRole("button", { name: "Send invitations" }).click();
    await owner.getByText(agentEmail).first().waitFor();
  });

  await t.step("second user accepts the invitation", async () => {
    await agent.goto(await mailLink("/invite", agentEmail));
    await agent.getByRole("button", { name: "Accept invitation" }).click();
    await agent.waitForURL(/\/inbox\//);
  });

  await t.step("member list updates live for the owner", async () => {
    await owner.getByText("Ben Agent").first().waitFor();
  });

  const subject = `Cannot sign in ${uid()}`;
  t.subject = subject;
  await t.step("forwarded email becomes a ticket live in both inboxes", async () => {
    await owner.goto(cfg.app + "/inbox/unassigned");
    await agent.goto(cfg.app + "/inbox/unassigned");
    await owner.getByRole("listbox", { name: "Tickets" }).or(owner.getByText(/no tickets|all caught up|inbox zero/i)).first().waitFor();
    await agent.waitForTimeout(1500); // sockets joined
    t.customerEmail = `casey-${uid()}@customer.test`;
    t.firstMessageId = `<${uid()}@customer.test>`;
    await inboundEmail(t.forwarding, rawEmail({ from: t.customerEmail, to: t.supportEmail, subject, text: "Hi, I reset my password but still cannot sign in. Help!", messageId: t.firstMessageId }));
    await owner.getByRole("option").filter({ hasText: subject }).waitFor({ timeout: 15_000 });
    await agent.getByRole("option").filter({ hasText: subject }).waitFor({ timeout: 15_000 });
    await shot(owner, "inbox-live-ticket");
  });

  await t.step("open the ticket in both browsers: presence", async () => {
    await openTicket(owner, subject);
    await openTicket(agent, subject);
    await owner.getByRole("article").first().waitFor();
    t.ticketUrl = owner.url();
    // Each sees the other in the ticket header.
    await owner.locator('[title="Ben Agent"]').first().waitFor();
    await agent.locator('[title="Ada Owner"]').first().waitFor();
  });

  await t.step("typing shows for the other agent", async () => {
    const editor = agent.getByRole("textbox", { name: "Reply" });
    await editor.click();
    await editor.pressSequentially("Looking into it", { delay: 40 });
    await owner.getByText(/Ben Agent is typing|Ben is typing/).waitFor();
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
  });

  await t.step("reply is sent and its delivery status updates live", async () => {
    const editor = owner.getByRole("textbox", { name: "Reply" });
    await editor.click();
    await editor.fill("Thanks Casey, please try resetting again from the sign-in page.");
    await owner.getByRole("button", { name: "Send", exact: true }).click();
    const article = owner.getByRole("article").filter({ hasText: "please try resetting again" });
    await article.waitFor();
    // The other agent gets the message without reloading.
    await agent.getByRole("article").filter({ hasText: "please try resetting again" }).waitFor();
    const tok = await accessToken(owner);
    t.ownerToken = tok;
    const ticketId = owner.url().split("/").pop();
    t.ticketId = ticketId;
    const sent = await until(async () => {
      const r = await api("GET", `/v1/tickets/${ticketId}/messages`, { token: tok, workspace: t.workspaceId });
      const m = r.json?.data?.find((x) => x.body_text.includes("please try resetting again"));
      return m?.delivery_status === "sent" ? m : null;
    }, "message delivered", 20_000);
    t.replyMessageId = sent.id;
    await until(async () => !(await article.innerText()).match(/sending/i), "delivery status updated in the UI", 10_000).catch(async (e) => {
      throw new Error(`${e.message}: ${(await article.innerText()).slice(0, 200)}`);
    });
    await shot(owner, "ticket-reply-sent");
  });

  await t.step("note with an @mention notifies the other agent live", async () => {
    await owner.getByRole("radio", { name: "Note" }).or(owner.getByRole("tab", { name: "Note" })).or(owner.getByRole("button", { name: "Note", exact: true })).first().click();
    const editor = owner.getByRole("textbox", { name: "Note" });
    await editor.click();
    await editor.pressSequentially("Can you check this @Ben", { delay: 30 });
    await owner.getByRole("listbox", { name: "Mention a teammate" }).or(owner.locator('[aria-label="Mention a teammate"]')).first().waitFor();
    await owner.keyboard.press("Enter");
    await editor.pressSequentially(" please", { delay: 20 });
    await owner.getByRole("button", { name: "Add note", exact: true }).click();
    await owner.getByRole("article").filter({ hasText: "Can you check this" }).waitFor();
    // Toast and bell for the agent.
    await agent.getByText(/mentioned/i).first().waitFor({ timeout: 10_000 });
    const tok = await accessToken(agent);
    t.agentToken = tok;
    const n = await api("GET", "/v1/notifications", { token: tok, workspace: t.workspaceId });
    const mention = n.json?.data?.find((x) => x.type === "mentioned");
    assert(mention, "mention notification stored");
    assert(mention.data?.actor?.name === "Ada Owner", "notification names who mentioned");
    const msgs = await api("GET", `/v1/tickets/${t.ticketId}/messages`, { token: tok, workspace: t.workspaceId });
    const note = msgs.json.data.find((x) => x.kind === "note");
    assert(/data-type="mention"/.test(note.body_html) && /data-id="/.test(note.body_html), "mention span kept by sanitizer");
  });
}
