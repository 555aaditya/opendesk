import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import type { Mailbox, MailboxTest } from "@/lib/api/types";
import { qk, removeFromList, upsertInList } from "@/lib/queries";
import { TestResults } from "./kinds";

/** Test, enable/disable and remove, shared by the list and the detail page. */
export function useMailboxActions() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [testing, setTesting] = useState<{ mailbox: Mailbox; result?: MailboxTest; error?: unknown } | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ m, status }: { m: Mailbox; status: Mailbox["status"] }) => api.mailboxes.update(m.id, { status }),
    onMutate: ({ m, status }) => {
      const prev = qc.getQueryData<Mailbox[]>(qk.mailboxes);
      upsertInList(qc, qk.mailboxes, { ...m, status });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.mailboxes, ctx.prev);
      toast.error(e);
    },
    onSuccess: (m) => upsertInList(qc, qk.mailboxes, m),
  });

  const test = async (m: Mailbox) => {
    setTesting({ mailbox: m });
    try {
      const result = await api.mailboxes.test(m.id);
      setTesting({ mailbox: m, result });
    } catch (error) {
      setTesting({ mailbox: m, error });
    }
  };

  const remove = (m: Mailbox, after?: () => void) =>
    confirm.show(`Mail sent to ${m.email} stops arriving in opendesk. Existing tickets stay.`, async () => {
      const prev = qc.getQueryData<Mailbox[]>(qk.mailboxes);
      removeFromList(qc, qk.mailboxes, m.id);
      try {
        await api.mailboxes.remove(m.id);
        toast.success("Mailbox removed");
        after?.();
      } catch (e) {
        if (prev) qc.setQueryData(qk.mailboxes, prev);
        throw e;
      }
    }, { title: "Remove mailbox?", confirmLabel: "Remove", danger: true });

  const testDialog = testing && (
    <Dialog
      open
      onOpenChange={(o) => !o && setTesting(null)}
      size="sm"
      title="Connection test"
      description={<span className="mono">{testing.mailbox.email}</span>}
      footer={
        <Button variant="primary" onClick={() => setTesting(null)}>
          Done
        </Button>
      }
    >
      {testing.result ? (
        <TestResults result={testing.result} />
      ) : testing.error ? (
        <p className="text-xs text-danger-fg">The test couldn't run. Try again in a moment.</p>
      ) : (
        <div className="flex flex-col gap-2 py-2">
          <div className="skeleton h-3 w-2/3" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      )}
    </Dialog>
  );

  return { setStatus, test, remove, testDialog };
}
