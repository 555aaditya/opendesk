import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { tone, toneFor } from "@/lib/tones";

export function initials(name: string) {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// People are round; organisations (companies, workspaces) are rounded squares,
// echoing the square modules of the mark.
const sizes = {
  xs: "size-4 text-[7.5px]",
  sm: "size-5 text-[8.5px]",
  md: "size-6 text-[9.5px]",
  lg: "size-8 text-[11px]",
  xl: "size-10 text-[13px]",
  "2xl": "size-14 text-[17px]",
};
const squares = { xs: "rounded-xs", sm: "rounded-sm", md: "rounded-sm", lg: "rounded-md", xl: "rounded-lg", "2xl": "rounded-xl" };

export function Avatar({
  name,
  src,
  size = "md",
  className,
  ring,
  square,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
  ring?: boolean;
  /** A company or workspace: rounded square instead of a circle. */
  square?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [src]);
  const showImg = !!src && !broken;
  const shade = tone[toneFor(name)].chip;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden font-semibold tracking-[-0.02em]",
        sizes[size],
        square ? squares[size] : "rounded-full",
        shade,
        ring && "ring-2 ring-surface",
        className,
      )}
      title={name}
      aria-hidden
    >
      {/* Initials hold the place; the photo fades in over them once it has loaded. */}
      <span className={cn("transition-opacity duration-200", showImg && loaded && "opacity-0")}>{initials(name)}</span>
      {showImg && (
        <img
          key={src}
          src={src}
          alt=""
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-200 ease-out", loaded ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          referrerPolicy="no-referrer"
        />
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
