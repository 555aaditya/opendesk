// Mounted once in the app shell: the floating panel (and the phone sheet) and
// the global ⌘J toggle. The docked column is AssistantDock, in the main row.

import { useHotkeys } from "@/lib/hotkeys";
import { AssistantFloat } from "./AssistantPanel";
import { useAssistantOn } from "./OllieButton";
import { ollie } from "./store";

export { AssistantDock } from "./AssistantPanel";
export { OllieButton } from "./OllieButton";

export function AssistantRoot() {
  const on = useAssistantOn();
  useHotkeys({ "mod+j": () => ollie.toggle() }, on);
  if (!on) return null;
  return <AssistantFloat />;
}
