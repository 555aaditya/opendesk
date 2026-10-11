// Mounted once in the app shell: the floating panel (and the phone sheet) and
// the global ⌘J toggle. The docked column is AssistantDock, in the main row.

import { useHotkeys } from "@/lib/hotkeys";
import { AssistantFloat } from "./AssistantPanel";
import { useAssistantOn } from "./JevButton";
import { jev } from "./store";

export { AssistantDock } from "./AssistantPanel";
export { JevButton } from "./JevButton";

export function AssistantRoot() {
  const on = useAssistantOn();
  useHotkeys({ "mod+j": () => jev.toggle() }, on);
  if (!on) return null;
  return <AssistantFloat />;
}
