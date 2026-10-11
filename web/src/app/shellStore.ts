import { create } from "zustand";

type ShellState = {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  newTicketOpen: boolean;
  sidebarOpen: boolean;
};

export const useShell = create<ShellState>(() => ({
  paletteOpen: false,
  shortcutsOpen: false,
  newTicketOpen: false,
  sidebarOpen: false,
}));

export const shell = {
  palette: (open = true) => useShell.setState({ paletteOpen: open }),
  shortcuts: (open = true) => useShell.setState({ shortcutsOpen: open }),
  newTicket: (open = true) => useShell.setState({ newTicketOpen: open }),
  sidebar: (open: boolean) => useShell.setState({ sidebarOpen: open }),
};

// Contextual commands a page offers the command menu (the open ticket's actions).
export type PageCommand = { id: string; label: string; group?: string; shortcut?: string; icon?: React.ReactNode; run: () => void };
type CommandsState = { commands: PageCommand[] };
export const usePageCommands = create<CommandsState>(() => ({ commands: [] }));
