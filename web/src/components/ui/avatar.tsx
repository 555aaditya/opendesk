import { useState } from "react";
import { cn } from "@/lib/cn";

const shades = [
  "bg-[#e9e9e9] text-[#3a3a3a] dark:bg-[#2a2a2a] dark:text-[#d4d4d4]",
  "bg-[#dcdcdc] text-[#262626] dark:bg-[#333333] dark:text-[#e4e4e4]",
  "bg-[#f0f0f0] text-[#525252] dark:bg-[#242424] dark:text-[#b4b4b4]",
  "bg-[#d2d2d2] text-[#171717] dark:bg-[#3b3b3b] dark:text-[#f4f4f4]",
  "bg-[#262626] text-[#f4f4f4] dark:bg-[#e4e4e4] dark:text-[#171717]",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const sizes = { xs: "size-4 text-[7.5px]", sm: "size-5 text-[8.5px]", md: "size-6 text-[9.5px]", lg: "size-8 text-[11px]", xl: "size-10 text-[13px]", "2xl": "size-14 text-[17px]" };

export function Avatar({
  name,
  src,
  size = "md",
  className,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  ring?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const shade = shades[hash(name || "?") % shades.length];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-[-0.02em]",
        sizes[size],
        !src || broken ? shade : "bg-hover",
        ring && "ring-2 ring-surface",
        className,
      )}
      title={name}
      aria-hidden
    >
      {src && !broken ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} referrerPolicy="no-referrer" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  size = "sm",
  max = 3,
  className,
}: {
  people: { id: string; name: string; avatar?: string | null; state?: "viewing" | "replying" | "idle" }[];
  size?: "xs" | "sm" | "md";
  max?: number;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={cn("flex items-center -space-x-1", className)}>
      {shown.map((p) => (
        <span key={p.id} className="relative">
          <Avatar name={p.name} src={p.avatar} size={size} ring />
          {p.state === "replying" && (
            <span className="absolute -bottom-px -right-px size-[7px] rounded-full bg-warn ring-[1.5px] ring-surface" />
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="relative inline-flex size-5 items-center justify-center rounded-full bg-hover text-[9px] font-medium text-fg-2 ring-2 ring-surface">
          +{extra}
        </span>
      )}
    </span>
  );
}
