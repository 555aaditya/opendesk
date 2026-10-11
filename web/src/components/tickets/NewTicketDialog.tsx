import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast";
import { RichEditor, type RichEditorHandle } from "@/components/editor/RichEditor";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Contact, Priority } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { patchTicketEverywhere } from "@/lib/ticketCache";
import { useSession } from "@/lib/session";
import { useConfirm } from "@/components/ui/confirm";
import { shell } from "@/app/shellStore";
import { PriorityIcon, priorityLabel, priorityOrder } from "./bits";
import { ChevronDown } from "lucide-react";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NewTicketDialog() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const me = useSession((s) => s.user!.id);
  const { data: mailboxes } = useQuery(q.mailboxes());
  const { data: members } = useQuery(q.members());

  const [to, setTo] = useState<{ contact?: Contact; email?: string } | null>(null);
  const [toQuery, setToQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [mailbox, setMailbox] = useState<string | undefined>();
  const [priority, setPriority] = useState<Priority>("normal");
  const [assignee, setAssignee] = useState<string | null>(me);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<RichEditorHandle>(null);

  useEffect(() => {
    if (!mailbox && mailboxes?.length) setMailbox(mailboxes.find((m) => m.status === "active")?.id ?? mailboxes[0].id);
  }, [mailboxes, mailbox]);

  const contacts = useQuery({
    queryKey: ["contacts", "pick", toQuery],
    queryFn: () => api.contacts.search({ q: toQuery, limit: 8 }),
    enabled: toQuery.trim().length > 0,
  });

  const dirty = !!(to || subject || body);
  const close = () => shell.newTicket(false);
  const requestClose = () => {
    if (!dirty) return close();
    confirm.show("Your draft will be lost.", close, { title: "Discard this ticket?", confirmLabel: "Discard", danger: true });
  };

  const create = useMutation({
    mutationFn: () =>
      api.tickets.create({
        subject: subject.trim(),
        contact_id: to?.contact?.id,
        contact: !to?.contact && to?.email ? { email: to.email, name: "" } : undefined,
        // An email ticket needs its mailbox (later replies go out through it), also when it starts as a note.
        channel: mailbox ? "email" : "api",
        mailbox_id: mailbox || undefined,
        body_html: body,
        kind,
        priority,
        assignee_id: assignee ?? undefined,
        status: kind === "reply" ? "pending" : "open",
      }),
    onSuccess: (t) => {
      patchTicketEverywhere(qc, t, me);
      void qc.invalidateQueries({ queryKey: qk.counts });
      toast.success(`Ticket #${t.number} created`);
      close();
      void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: t.assignee?.id === me ? "mine" : "open", ticketId: t.id } });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = () => {
    setError(null);
    if (!to) return setError("Add a recipient.");
    if (!subject.trim()) return setError("Add a subject.");
    if (!body) return setError("Write a message.");
    create.mutate();
  };

  const toItems = [
    ...(contacts.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name || c.email || "Unnamed",
      hint: c.email ?? undefined,
      icon: <Avatar name={c.name || c.email || "?"} src={c.avatar_url} size="xs" />,
    })),
  ];
  const assigneeName = members?.find((m) => m.user.id === assignee)?.user.name;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && requestClose()}
      title="New ticket"
      size="lg"
      onEscapeKeyDown={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      onInteractOutside={(e) => {
        e.preventDefault();
        requestClose();
      }}
      footer={
        <>
          {error && <p className="mr-auto text-xs text-danger-fg">{error}</p>}
          <Button variant="ghost" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            {kind === "reply" ? "Create and send" : "Create ticket"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "reply", label: "Email the customer" },
            { value: "note", label: "Log internally" },
          ]}
        />
        <div className="grid grid-cols-[1fr_200px] gap-3">
          <Field label="To">
            {({ id }) =>
              to ? (
                <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface pl-2 pr-1 text-sm">
                  <Avatar name={to.contact?.name || to.email || "?"} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{to.contact ? `${to.contact.name} ` : ""}<span className="text-fg-3">{to.contact?.email ?? to.email}</span></span>
                  <Button size="xs" variant="ghost" onClick={() => setTo(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <Picker
                  items={toItems}
                  value={null}
                  width={380}
                  placeholder="Search contacts or type an email"
                  emptyText={toQuery ? "No contacts. Type a full email to use it." : "Start typing"}
                  onSelect={(v) => setTo({ contact: contacts.data?.data.find((c) => c.id === v) })}
                  onCreate={(v) => emailRe.test(v) && setTo({ email: v })}
                  createLabel="Use"
                  trigger={
                    <button id={id} type="button" className="flex h-8 w-full items-center rounded-md border border-line bg-surface px-2.5 text-left text-sm text-fg-4 hover:border-line-strong">
                      Search contacts or type an email
                    </button>
                  }
                  onQueryChange={setToQuery}
                />
              )
            }
          </Field>
          <Field label="From">
            {({ id }) => (
              <Select
                id={id}
                value={mailbox}
                onChange={setMailbox}
                disabled={kind === "note" || !mailboxes?.length}
                placeholder="No mailbox"
                options={(mailboxes ?? []).map((m) => ({ value: m.id, label: m.email }))}
              />
            )}
          </Field>
        </div>
        <Field label="Subject">
          {({ id }) => <TextInput id={id} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is this about?" />}
        </Field>
        <div className="rounded-md border border-line focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]">
          <RichEditor ref={editor} value={body} onChange={setBody} placeholder={kind === "reply" ? "Write your message" : "Describe the issue"} contentClassName="min-h-[160px]" onSubmit={submit} />
        </div>
        <div className="flex items-center gap-2">
          <Picker
            items={priorityOrder.map((p) => ({ value: p, label: priorityLabel[p], icon: <PriorityIcon priority={p} /> }))}
            value={priority}
            onSelect={(v) => setPriority(v as Priority)}
            placeholder="Priority"
            trigger={
              <Button size="sm" icon={<PriorityIcon priority={priority} />} iconRight={<ChevronDown className="size-3 text-fg-4" />}>
                {priorityLabel[priority]}
              </Button>
            }
          />
          <Picker
            items={[
              { value: "__none", label: "Unassigned" },
              ...(members ?? []).filter((m) => m.role !== "viewer").map((m) => ({ value: m.user.id, label: m.user.name, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> })),
            ]}
            value={assignee ?? "__none"}
            onSelect={(v) => setAssignee(v === "__none" ? null : v)}
            placeholder="Assign to"
            trigger={
              <Button size="sm" icon={<Avatar name={assigneeName ?? "?"} size="xs" className={assignee ? "" : "opacity-40"} />} iconRight={<ChevronDown className="size-3 text-fg-4" />}>
                {assignee ? (assignee === me ? "You" : assigneeName) : "Unassigned"}
              </Button>
            }
          />
        </div>
      </div>
    </Dialog>
  );
}
