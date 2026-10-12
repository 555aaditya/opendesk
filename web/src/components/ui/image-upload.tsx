// A picture control for people, companies, the workspace logo and branding
// slots: the current picture, click or drop an image onto it, crop it in a
// dialog (square, or `aspect` for wide logos), and watch it upload on the
// picture itself. Callers own the request: `onChange` gets a WebP (or JPEG)
// Blob, 512 px on its short side; send it as the multipart `file`.

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { Camera, ImageUp, Minus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { ease, springs } from "@/lib/motion";
import { Avatar } from "./avatar";
import { Button } from "./button";
import { useConfirm } from "./confirm";
import { Dialog } from "./dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu";
import { toast } from "./toast";
import { ACCEPTED, checkFile, clampOffset, MAX_ZOOM, MIN_ZOOM, renderCrop, scaleFor, windowSize, type CropView } from "./image-crop";

const SIZES = {
  /** Favicon slots. */
  sm: { px: 32, avatar: "lg", radius: 5, extra: "" },
  md: { px: 40, avatar: "xl", radius: 7, extra: "" },
  lg: { px: 56, avatar: "2xl", radius: 8, extra: "" },
  xl: { px: 80, avatar: "2xl", radius: 8, extra: "size-20 text-[22px]" },
} as const;

/** Where an automatic picture came from (contracts/api.md, Profile pictures and logos). */
export type AvatarSource = "upload" | "oauth" | "gravatar" | "domain" | "widget";

type Phase = "idle" | "uploading" | "done";

/** Friendly copy for the upload errors the API answers (413 too_large, 422 unsupported_image / image_too_large). */
function uploadError(e: unknown): "too_big" | "bad_type" | "too_large_px" | "failed" {
  const code = (e as { code?: string } | null)?.code;
  if (code === "too_large") return "too_big";
  if (code === "unsupported_image") return "bad_type";
  if (code === "image_too_large") return "too_large_px";
  return "failed";
}

export function ImageUpload({
  value,
  name,
  shape,
  onChange,
  onRemove,
  onRefresh,
  source,
  size = "lg",
  aspect = 1,
  progress,
  disabled,
  className,
  hint = true,
  compact,
  placeholder,
}: {
  value?: string | null;
  /** Whose picture: initials, the identity hue and the copy use it. */
  name: string;
  /** People are round; companies, workspaces and branding slots square. */
  shape: "round" | "square";
  /** Gets the cropped image (512 px on its short side, WebP or JPEG). Throw the API error to show its copy. */
  onChange: (file: Blob) => Promise<void>;
  onRemove?: () => Promise<void>;
  /** Look the automatic sources up again (contacts and companies). */
  onRefresh?: () => Promise<void>;
  /** `avatar_source`: a non-upload source shows where the picture came from. */
  source?: AvatarSource | null;
  size?: keyof typeof SIZES;
  /** Width / height of the crop, for wide logos. 1 (square) by default. */
  aspect?: number;
  /** Upload progress 0..1 when the caller can report it; otherwise the ring travels. */
  progress?: number;
  disabled?: boolean;
  className?: string;
  /** Show the file-type hint under the buttons. */
  hint?: boolean;
  /** Only the picture (drawer headers): a click opens a small menu, errors arrive as toasts. */
  compact?: boolean;
  /** Shown instead of initials while there is no picture (e.g. the Ollie mark for the agent). */
  placeholder?: ReactNode;
}) {
  const { t } = useTranslation("setup");
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const live = useId();
  const z = SIZES[size];
  const wide = aspect !== 1;
  const square = shape === "square" || wide;
  const busy = phase === "uploading";
  const h = z.px;
  const w = wide ? Math.round(Math.min(4, Math.max(0.25, aspect)) * h) : h;
  const radius = square ? z.radius : h / 2;

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    const bad = checkFile(f);
    if (bad) return setError(t(`upload.${bad}`));
    setError(null);
    setFile(f);
  };

  const save = async (blob: Blob) => {
    setFile(null);
    setPreview(URL.createObjectURL(blob));
    setPhase("uploading");
    setError(null);
    try {
      await onChange(blob);
      setPhase("done");
      setTimeout(() => {
        setPhase("idle");
        setPreview(null);
      }, 1300);
    } catch (e) {
      setPhase("idle");
      setPreview(null);
      setError(t(`upload.${uploadError(e)}`));
    }
  };

  const remove = () =>
    onRemove &&
    confirm.show(t("upload.remove_body", { name }), onRemove, { title: t("upload.remove_title"), confirmLabel: t("upload.remove_confirm"), danger: true });

  const refresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } catch {
      setError(t("upload.failed"));
    } finally {
      setRefreshing(false);
    }
  };

  const open = () => !disabled && !busy && input.current?.click();
  useEffect(() => {
    if (compact && error) {
      toast.error(error);
      setError(null);
    }
  }, [compact, error]);
  const canRefresh = !!onRefresh && source !== "upload";
  const canRemove = !!onRemove && !!value;
  const withMenu = compact && (canRefresh || canRemove);
  const src = preview ?? value ?? null;
  const fromLabel = source && source !== "upload" ? t(`upload.source_${source}`) : null;
  const rounded = { borderRadius: radius };

  return (
    <div className={cn("flex items-center gap-4", compact && "contents", className)}>
      <MenuIf on={!!withMenu} items={
        <>
          <MenuItem icon={<ImageUp />} onSelect={open}>
            {value ? t("upload.change") : t("upload.upload")}
          </MenuItem>
          {canRefresh && (
            <MenuItem icon={<RefreshCw />} onSelect={() => void refresh()}>
              {t("upload.refresh")}
            </MenuItem>
          )}
          {canRemove && (
            <MenuItem icon={<Trash2 />} danger onSelect={remove}>
              {t("upload.remove")}
            </MenuItem>
          )}
          {fromLabel && value && <p className="px-2 pb-1 pt-1.5 text-[11.5px] text-fg-4">{fromLabel}</p>}
        </>
      }>
      <button
        type="button"
        onClick={withMenu ? undefined : open}
        disabled={disabled}
        aria-label={value ? t("upload.change") : t("upload.upload")}
        aria-describedby={live}
        aria-busy={busy || undefined}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files") || disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files") || disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled && !busy) pick(e.dataTransfer.files[0]);
        }}
        style={{ width: w, height: h, ...rounded }}
        className={cn(
          "group relative shrink-0 outline-none transition-transform duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
          "focus-visible:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--focus)]",
          over && "scale-[1.04] shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--focus)]",
        )}
      >
        {wide ? (
          // Logos: fitted, not cropped to initials.
          <span style={rounded} className="flex size-full items-center justify-center overflow-hidden border border-line bg-sunken">
            {src ? <img src={src} alt="" className="size-full object-contain p-1.5" /> : <ImageUp className="size-4 text-fg-4" />}
          </span>
        ) : !src && placeholder ? (
          <span style={rounded} className="flex size-full items-center justify-center overflow-hidden border border-line bg-sunken">
            {placeholder}
          </span>
        ) : (
          <Avatar name={name} src={src} size={z.avatar} square={square} className={cn(z.extra, size === "sm" && "rounded-md")} />
        )}
        {/* Hover and drop: a quiet camera veil. */}
        <span
          aria-hidden
          style={rounded}
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150",
            !busy && phase !== "done" && "group-hover:opacity-100 group-focus-visible:opacity-100",
            over && "opacity-100",
          )}
        >
          {over ? <ImageUp className={size === "sm" ? "size-3.5" : "size-5"} /> : <Camera className={size === "sm" || size === "md" ? "size-3.5" : "size-5"} />}
        </span>
        <Ring w={w} h={h} radius={radius} phase={phase} progress={progress} />
        <AnimatePresence>
          {phase === "done" && (
            <motion.span
              key="done"
              aria-hidden
              style={rounded}
              className="absolute inset-0 flex items-center justify-center bg-tone-green-solid/85 text-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
              transition={{ duration: 0.15 }}
            >
              <DrawnCheck className={size === "sm" || size === "md" ? "size-4" : "size-6"} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      </MenuIf>

      {compact ? (
        <span id={live} className="sr-only" aria-live="polite">
          {busy ? t("upload.uploading") : phase === "done" ? t("upload.uploaded") : refreshing ? t("upload.refreshing") : ""}
        </span>
      ) : (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={open} disabled={disabled || busy}>
            {value ? t("upload.change") : t("upload.upload")}
          </Button>
          {canRefresh && (
            <Button size="sm" variant="ghost" onClick={refresh} loading={refreshing} disabled={disabled || busy}>
              {t("upload.refresh")}
            </Button>
          )}
          {canRemove && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={disabled || busy}>
              {t("upload.remove")}
            </Button>
          )}
        </div>
        {error ? (
          <p role="alert" className="text-[12px] leading-4 text-danger-fg">
            {error}
          </p>
        ) : over ? (
          <p className="text-[12px] leading-4 text-fg-3">{t("upload.drop")}</p>
        ) : fromLabel && value ? (
          <p className="text-[12px] leading-4 text-fg-3">{fromLabel}</p>
        ) : (
          hint && <p className="text-[12px] leading-4 text-fg-3">{wide ? t("upload.hint_logo") : t("upload.hint")}</p>
        )}
        <span id={live} className="sr-only" aria-live="polite">
          {busy ? t("upload.uploading") : phase === "done" ? t("upload.uploaded") : refreshing ? t("upload.refreshing") : ""}
        </span>
      </div>
      )}

      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        tabIndex={-1}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file && (
        <CropDialog
          file={file}
          shape={shape}
          aspect={wide ? aspect : 1}
          onCancel={() => setFile(null)}
          onSave={save}
          onUnreadable={() => (setFile(null), setError(t("upload.unreadable")))}
        />
      )}
    </div>
  );
}

/** Wraps the picture in a menu trigger when it has more than one action. */
function MenuIf({ on, items, children }: { on: boolean; items: ReactNode; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent align="start">{items}</MenuContent>
    </Menu>
  );
}

/** Progress around the picture: a determinate arc, or a travelling one. */
function Ring({ w, h, radius, phase, progress }: { w: number; h: number; radius: number; phase: Phase; progress?: number }) {
  const reduce = useReducedMotion();
  const shown = phase !== "idle";
  const p = phase === "done" ? 1 : progress;
  const pad = 5;
  const W = w + pad * 2;
  const H = h + pad * 2;
  const shape = <rect x="1.25" y="1.25" width={W - 2.5} height={H - 2.5} rx={Math.min(radius + pad - 1.25, H / 2 - 1.25)} pathLength={1} />;
  return (
    <AnimatePresence>
      {shown && (
        <motion.svg
          key="ring"
          aria-hidden
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="pointer-events-none absolute -left-[5px] -top-[5px] overflow-visible"
          fill="none"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
          transition={springs.snap}
        >
          <g className="stroke-line" strokeWidth={2}>
            {shape}
          </g>
          {p === undefined ? (
            <motion.g
              className="stroke-fg"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="0.22 0.78"
              animate={reduce ? undefined : { strokeDashoffset: [0, -1] }}
              transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
            >
              {shape}
            </motion.g>
          ) : (
            <motion.g
              className={phase === "done" ? "stroke-tone-green-solid" : "stroke-fg"}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="1 1"
              initial={false}
              animate={{ strokeDashoffset: 1 - Math.min(1, Math.max(0, p)) }}
              transition={reduce ? { duration: 0 } : { duration: 0.25, ease: ease.out }}
            >
              {shape}
            </motion.g>
          )}
        </motion.svg>
      )}
    </AnimatePresence>
  );
}

/** A check that draws itself in once. */
export function DrawnCheck({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.25, delay: 0.05, ease: ease.out }}
      />
    </svg>
  );
}

// ─── Crop dialog ────────────────────────────────────────────────────────────

const CROP = 240;
const FRAME = 300;

function CropDialog({
  file,
  shape,
  aspect,
  onCancel,
  onSave,
  onUnreadable,
}: {
  file: File;
  shape: "round" | "square";
  aspect: number;
  onCancel: () => void;
  onSave: (b: Blob) => void;
  onUnreadable: () => void;
}) {
  const { t } = useTranslation("setup");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [busy, setBusy] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    // The URL lives with the effect so a re-run (StrictMode) never loads a revoked one.
    const u = URL.createObjectURL(file);
    let live = true;
    const i = new Image();
    i.onload = () => {
      if (!live) return;
      setUrl(u);
      setImg(i);
    };
    i.onerror = () => {
      if (live) onUnreadable();
    };
    i.src = u;
    return () => {
      live = false;
      URL.revokeObjectURL(u);
    };
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = useCallback(
    (z = zoom, ox = x.get(), oy = y.get()): CropView => ({ w: img?.naturalWidth || 1, h: img?.naturalHeight || 1, crop: CROP, zoom: z, x: ox, y: oy, aspect }),
    [img, zoom, x, y, aspect],
  );

  const move = (ox: number, oy: number, z = zoom, smooth = false) => {
    const c = clampOffset(view(z, ox, oy));
    if (smooth && !reduce) {
      animate(x, c.x, { duration: 0.15, ease: ease.out });
      animate(y, c.y, { duration: 0.15, ease: ease.out });
    } else {
      x.set(c.x);
      y.set(c.y);
    }
  };

  const setZ = (z: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));
    setZoom(nz);
    move(x.get(), y.get(), nz);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: x.get(), y: y.get() };
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) move(d.x + e.clientX - d.px, d.y + e.clientY - d.py);
  };
  const onPointerUp = () => (drag.current = null);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const k: Record<string, () => void> = {
      ArrowLeft: () => move(x.get() - step, y.get(), zoom, true),
      ArrowRight: () => move(x.get() + step, y.get(), zoom, true),
      ArrowUp: () => move(x.get(), y.get() - step, zoom, true),
      ArrowDown: () => move(x.get(), y.get() + step, zoom, true),
      "+": () => setZ(zoom + 0.1),
      "=": () => setZ(zoom + 0.1),
      "-": () => setZ(zoom - 0.1),
    };
    const f = k[e.key];
    if (f) {
      e.preventDefault();
      f();
    }
  };

  const submit = async () => {
    if (!img) return;
    setBusy(true);
    try {
      onSave(await renderCrop(img, view()));
    } catch {
      onUnreadable();
    } finally {
      setBusy(false);
    }
  };

  const s = img ? scaleFor(view()) : 1;
  const win = windowSize({ crop: CROP, aspect });
  const pct = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onCancel()}
      title={t("upload.crop_title")}
      description={t("upload.crop_description")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("upload.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!img}>
            {t("upload.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 py-1">
        <div
          role="group"
          tabIndex={0}
          aria-label={t("upload.crop_area")}
          onKeyDown={onKey}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={(e) => setZ(zoom - e.deltaY * 0.002)}
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-lg bg-sunken outline-none active:cursor-grabbing focus-visible:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--focus)]"
          style={{ width: FRAME, height: FRAME }}
        >
          {img && url ? (
            <motion.img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
              style={{ width: img.naturalWidth * s, height: img.naturalHeight * s, x, y, translateX: "-50%", translateY: "-50%" }}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            />
          ) : (
            <div className="skeleton absolute inset-0" />
          )}
          {/* The mask: everything outside the crop is dimmed; the window matches the final shape. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-1 ring-white/70",
              shape === "round" && aspect === 1 ? "rounded-full" : aspect === 1 ? "rounded-2xl" : "rounded-lg",
            )}
            style={{ width: win.cw, height: win.ch }}
          />
        </div>

        <div className="flex w-full max-w-[300px] items-center gap-2" dir="ltr">
          <ZoomButton label={t("upload.zoom_out")} onClick={() => setZ(zoom - 0.25)} disabled={zoom <= MIN_ZOOM}>
            <Minus />
          </ZoomButton>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            aria-label={t("upload.zoom")}
            aria-valuetext={`${Math.round(zoom * 100)}%`}
            onChange={(e) => setZ(Number(e.target.value))}
            style={{ background: `linear-gradient(to right, var(--fg) ${pct}%, var(--line) ${pct}%)` }}
            className={cn(
              "h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none",
              "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-line-strong [&::-webkit-slider-thumb]:bg-raised [&::-webkit-slider-thumb]:shadow-xs [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110",
              "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-line-strong [&::-moz-range-thumb]:bg-raised",
              "focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_3px_var(--focus)]",
            )}
          />
          <ZoomButton label={t("upload.zoom_in")} onClick={() => setZ(zoom + 0.25)} disabled={zoom >= MAX_ZOOM}>
            <Plus />
          </ZoomButton>
        </div>
      </div>
    </Dialog>
  );
}

function ZoomButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button variant="ghost" size="xs" square aria-label={label} onClick={onClick} disabled={disabled} className="[&_svg]:size-3.5">
      {children}
    </Button>
  );
}
