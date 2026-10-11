import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { shortcutGroups } from "@/lib/hotkeys";
import { shell, useShell } from "./shellStore";

export function ShortcutsSheet() {
  const open = useShell((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => shell.shortcuts(o)} title="Keyboard shortcuts" description="Most things in opendesk work without a mouse." size="lg">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 pb-2 sm:grid-cols-2">
        {shortcutGroups.map((g) => (
          <section key={g.title} className={g.title === "General" ? "sm:row-span-2" : undefined}>
            <h3 className="label-caps mb-2">{g.title}</h3>
            <ul className="flex flex-col">
              {g.items.map((i) => (
                <li key={i.label} className="flex h-8 items-center justify-between border-b border-line-soft text-[12.5px] text-fg-2 last:border-0">
                  {i.label}
                  <Kbd>{i.keys}</Kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
