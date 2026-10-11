// A static rendering of the chat widget for the settings page. It mirrors the
// real widget's layout (web/widget) so admins see what visitors get: monochrome,
// with the workspace brand colour as the only accent.

import { ArrowUp, ChevronLeft, Paperclip, X } from "lucide-react";
import { Mark } from "@/components/brand";
import { cn } from "@/lib/cn";

function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#0a0a0a" : "#ffffff";
}

export function WidgetPreview({
  workspaceName,
  greeting,
  brandColor,
  requireEmail,
  dark,
  enabled,
  avatarUrl,
}: {
  workspaceName: string;
  greeting: string;
  brandColor?: string;
  requireEmail: boolean;
  dark: boolean;
  enabled: boolean;
  /** The widget_avatar brand image; the opendesk mark without one. */
  avatarUrl?: string | null;
}) {
  const accent = brandColor && /^#?[0-9a-f]{6}$/i.test(brandColor) ? (brandColor.startsWith("#") ? brandColor : `#${brandColor}`) : dark ? "#fafafa" : "#0a0a0a";
  const onAccent = readableOn(accent);
  const c = dark
    ? { bg: "#111111", panel: "#171717", line: "#262626", fg: "#fafafa", fg2: "#a3a3a3", bubble: "#222222", page: "#0a0a0a", dots: "#1f1f1f" }
    : { bg: "#ffffff", panel: "#ffffff", line: "#e4e4e4", fg: "#0a0a0a", fg2: "#6b6b6b", bubble: "#f4f4f4", page: "#f4f4f4", dots: "#e4e4e4" };

  return (
    <div
      className="relative h-[560px] overflow-hidden rounded-lg border border-line"
      style={{ background: c.page, backgroundImage: `radial-gradient(${c.dots} 1px, transparent 1px)`, backgroundSize: "16px 16px" }}
      aria-label="Widget preview"
      role="img"
    >
      {/* A faint stand-in for the customer's site. */}
      <div className="absolute left-5 right-5 top-5 flex flex-col gap-2 opacity-60">
        <div className="h-3 w-24 rounded" style={{ background: c.line }} />
        <div className="h-2 w-48 rounded" style={{ background: c.line }} />
        <div className="h-2 w-40 rounded" style={{ background: c.line }} />
      </div>

      {enabled ? (
        <>
          <div
            className="absolute bottom-[84px] right-5 flex h-[440px] w-[320px] flex-col overflow-hidden rounded-xl text-[12.5px]"
            style={{ background: c.panel, color: c.fg, boxShadow: `0 0 0 1px ${c.line}, 0 16px 40px -12px rgb(0 0 0 / ${dark ? 0.7 : 0.25})` }}
          >
            <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderBottom: `1px solid ${c.line}` }}>
              <ChevronLeft className="size-4" style={{ color: c.fg2 }} />
              <span className="flex size-7 items-center justify-center overflow-hidden rounded-full" style={{ background: c.bubble }}>
                {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : <Mark className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold tracking-[-0.01em]">{workspaceName}</div>
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: c.fg2 }}>
                  <span className="size-1.5 rounded-full bg-[#22c55e]" /> Usually replies in a few minutes
                </div>
              </div>
              <X className="size-4" style={{ color: c.fg2 }} />
            </div>

            <div className="flex flex-1 flex-col gap-2.5 overflow-hidden px-3.5 py-3.5">
              <div className="max-w-[85%] self-start rounded-xl rounded-bl-sm px-3 py-2 leading-[18px]" style={{ background: c.bubble }}>
                {greeting.trim() || "Hi there. How can we help?"}
              </div>
              {requireEmail ? (
                <div className="mt-1 flex flex-col gap-2 rounded-xl p-3" style={{ border: `1px solid ${c.line}` }}>
                  <div className="text-[12px] font-medium">Where can we reach you?</div>
                  <div className="text-[11.5px]" style={{ color: c.fg2 }}>
                    We'll reply here, and by email if you leave.
                  </div>
                  <div className="flex h-8 items-center rounded-lg px-2.5 text-[12px]" style={{ border: `1px solid ${c.line}`, color: c.fg2 }}>
                    you@company.com
                  </div>
                  <div className="flex h-8 items-center justify-center rounded-lg text-[12px] font-medium" style={{ background: accent, color: onAccent }}>
                    Start chat
                  </div>
                </div>
              ) : (
                <>
                  <div className="max-w-[85%] self-end rounded-xl rounded-br-sm px-3 py-2 leading-[18px]" style={{ background: accent, color: onAccent }}>
                    Can I export a notebook as PDF?
                  </div>
                  <div className="max-w-[85%] self-start rounded-xl rounded-bl-sm px-3 py-2 leading-[18px]" style={{ background: c.bubble }}>
                    Yes. Open the notebook, then File, Export, PDF. Want me to send the guide?
                  </div>
                  <div className="flex items-center gap-1.5 self-start pl-1 text-[11px]" style={{ color: c.fg2 }}>
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="size-1 animate-pulse-soft rounded-full" style={{ background: c.fg2, animationDelay: `${i * 160}ms` }} />
                      ))}
                    </span>
                    Lea is typing
                  </div>
                </>
              )}
            </div>

            <div className="m-2.5 flex items-center gap-2 rounded-lg px-3 py-2" style={{ border: `1px solid ${c.line}` }}>
              <span className="flex-1" style={{ color: c.fg2 }}>
                Write a message
              </span>
              <Paperclip className="size-3.5" style={{ color: c.fg2 }} />
              <span className="flex size-6 items-center justify-center rounded-full" style={{ background: accent, color: onAccent }}>
                <ArrowUp className="size-3.5" />
              </span>
            </div>
            <div className="pb-2 text-center text-[10px]" style={{ color: c.fg2 }}>
              Powered by opendesk
            </div>
          </div>
          <div
            className={cn("absolute bottom-5 right-5 flex size-[48px] items-center justify-center rounded-full")}
            style={{ background: accent, color: onAccent, boxShadow: `0 6px 16px -4px rgb(0 0 0 / ${dark ? 0.6 : 0.3})` }}
          >
            <X className="size-5" />
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-md px-3 py-1.5 text-[12px]" style={{ background: c.panel, color: c.fg2, border: `1px solid ${c.line}` }}>
            The widget is off. Visitors don't see a launcher.
          </span>
        </div>
      )}
    </div>
  );
}
