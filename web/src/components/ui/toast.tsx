import { Toaster as Sonner, toast as sonner } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { useTheme } from "@/lib/theme";
import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { tone, type Tone } from "@/lib/tones";

function ToastIcon({ hue, children }: { hue: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] [&_svg]:size-3 [&_svg]:stroke-[2.25]", tone[hue].chip)}>{children}</span>
  );
}

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
          actionButton: "ml-auto h-6 rounded-md bg-inverse px-2 text-xs font-medium text-inverse-fg",
          cancelButton: "h-6 rounded-md px-2 text-xs text-fg-3 hover:bg-hover",
          icon: "flex",
        },
      }}
    />
  );
}

export const toast = {
  success: (msg: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner.success(msg, { ...opts, icon: <ToastIcon hue="green"><Check /></ToastIcon> }),
  info: (msg: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
    sonner(msg, { ...opts, icon: <ToastIcon hue="blue"><Info /></ToastIcon> }),
  error: (e: unknown, fallback?: string) =>
    sonner.error(typeof e === "string" ? e : errorMessage(e, fallback), { icon: <ToastIcon hue="red"><X /></ToastIcon> }),
};
