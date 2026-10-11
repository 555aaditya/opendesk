// Crop maths for ImageUpload, kept free of the DOM so it can be tested.
//
// The photo sits behind a crop window whose long side is `crop` px and whose
// shape is `aspect` (width / height, 1 for avatars, wider for logos). At zoom 1
// it just covers the window; `x`/`y` move its centre away from the window's centre.

export const OUTPUT_SIZE = 512;
export const MAX_BYTES = 5 * 1024 * 1024;
export const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export type CropView = { w: number; h: number; crop: number; zoom: number; x: number; y: number; aspect?: number };

/** The crop window in screen px: long side `crop`, shaped by `aspect`. */
export function windowSize(v: Pick<CropView, "crop" | "aspect">): { cw: number; ch: number } {
  const a = v.aspect ?? 1;
  return a >= 1 ? { cw: v.crop, ch: v.crop / a } : { cw: v.crop * a, ch: v.crop };
}

/** Output pixels: the short side is `size`, so a wide logo keeps its detail. */
export function outputSize(aspect = 1, size = OUTPUT_SIZE): { width: number; height: number } {
  return aspect >= 1 ? { width: Math.round(size * aspect), height: size } : { width: size, height: Math.round(size / aspect) };
}

/** On-screen scale of the photo: cover the window, times zoom. */
export function scaleFor(v: Pick<CropView, "w" | "h" | "crop" | "zoom" | "aspect">) {
  const { cw, ch } = windowSize(v);
  return Math.max(cw / v.w, ch / v.h) * v.zoom;
}

/** Keep the photo covering the window: clamp the offset for the current zoom. */
export function clampOffset(v: CropView): { x: number; y: number } {
  const s = scaleFor(v);
  const { cw, ch } = windowSize(v);
  const mx = Math.max(0, (v.w * s - cw) / 2);
  const my = Math.max(0, (v.h * s - ch) / 2);
  return { x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

/** The part of the source image (natural pixels) that the window shows. */
export function cropSource(v: CropView): { sx: number; sy: number; sw: number; sh: number } {
  const { x, y } = clampOffset(v);
  const s = scaleFor(v);
  const { cw, ch } = windowSize(v);
  const sw = Math.min(cw / s, v.w);
  const sh = Math.min(ch / s, v.h);
  const cx = v.w / 2 - x / s;
  const cy = v.h / 2 - y / s;
  const sx = Math.min(v.w - sw, Math.max(0, cx - sw / 2));
  const sy = Math.min(v.h - sh, Math.max(0, cy - sh / 2));
  return { sx, sy, sw, sh };
}

/** Validate a picked file; returns an error key or null. */
export function checkFile(f: { type: string; size: number }): "bad_type" | "too_big" | null {
  if (!(ACCEPTED as readonly string[]).includes(f.type)) return "bad_type";
  if (f.size > MAX_BYTES) return "too_big";
  return null;
}

type CanvasLike = {
  width: number;
  height: number;
  getContext(id: "2d"): Pick<CanvasRenderingContext2D, "drawImage" | "imageSmoothingQuality" | "fillStyle" | "fillRect" | "globalCompositeOperation"> | null;
  toBlob(cb: (b: Blob | null) => void, type?: string, quality?: number): void;
};

const toBlob = (c: CanvasLike, type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, 0.9));

/**
 * Draws the crop at OUTPUT_SIZE on its short side and encodes it: WebP where the
 * browser can, JPEG otherwise (Safari answers a WebP request with PNG).
 */
export async function renderCrop(
  img: CanvasImageSource,
  v: CropView,
  createCanvas: () => CanvasLike = () => document.createElement("canvas"),
  size = OUTPUT_SIZE,
): Promise<Blob> {
  const c = createCanvas();
  const out = outputSize(v.aspect, size);
  c.width = out.width;
  c.height = out.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  const r = cropSource(v);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, out.width, out.height);
  const webp = await toBlob(c, "image/webp");
  if (webp && webp.type === "image/webp") return webp;
  // JPEG has no alpha: put transparent areas on white rather than black.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  const jpeg = await toBlob(c, "image/jpeg");
  if (!jpeg) throw new Error("encode failed");
  return jpeg;
}
