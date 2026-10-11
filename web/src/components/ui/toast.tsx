import { Toaster as Sonner, toast as sonner } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { useTheme } from "@/lib/theme";

export function Toaster() {
  const { dark } = useTheme();
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      gap={6}
      visibleToasts={4}
      offset={16}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[340px] items-center gap-2.5 rounded-lg border border-line bg-raised px-3 py-2.5 text-[12.5px] text-fg shadow-float",
          title: "font-medium",
          description: "text-fg-3 text-xs",
          actionButton: "ml-auto h-6 rounded-[6px] bg-inverse px-2 text-xs font-medium text-inverse-fg",
          cancelButton: "h-6 rounded-[6px] px-2 text-xs text-fg-3 hover:bg-hover",
          icon: "[&_svg]:size-3.5",
        },
      }}
    />
  );
}

export const toast = {
  success: (msg: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner.success(msg, { ...opts, icon: <span className="size-1.5 rounded-full bg-ok" /> }),
  info: (msg: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner(msg, { ...opts, icon: <span className="size-1.5 rounded-full bg-fg-3" /> }),
  error: (e: unknown, fallback?: string) =>
    sonner.error(typeof e === "string" ? e : errorMessage(e, fallback), { icon: <span className="size-1.5 rounded-full bg-danger" /> }),
};
