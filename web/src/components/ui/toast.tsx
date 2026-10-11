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
            "flex w-[340px] items-center gap-2.5 rounded-md bg-inverse px-3 py-2.5 text-[12.5px] text-inverse-fg shadow-float data-[mounted=true]:animate-pop-in",
          title: "font-medium",
          description: "text-xs opacity-60",
          actionButton: "ml-auto h-6 rounded-sm bg-inverse-fg/15 px-2 text-xs font-medium text-inverse-fg hover:bg-inverse-fg/25",
          cancelButton: "h-6 rounded-sm px-2 text-xs opacity-70 hover:opacity-100",
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
    sonner(msg, { ...opts, icon: <span className="size-1.5 rounded-full bg-inverse-fg/50" /> }),
  error: (e: unknown, fallback?: string) =>
    sonner.error(typeof e === "string" ? e : errorMessage(e, fallback), { icon: <span className="size-1.5 rounded-full bg-danger" /> }),
};
