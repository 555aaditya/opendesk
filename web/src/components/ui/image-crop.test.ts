import { describe, expect, it } from "vitest";
import { checkFile, clampOffset, cropSource, outputSize, renderCrop, type CropView } from "./image-crop";

function fakeCanvas(types: string[]) {
  const calls: unknown[][] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      imageSmoothingQuality: "low" as ImageSmoothingQuality,
      fillStyle: "",
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      fillRect: () => {},
      drawImage: (...a: unknown[]) => void calls.push(a),
    }),
    toBlob: (cb: (b: Blob | null) => void, type?: string) => {
      const t = types.includes(type ?? "") ? type! : "image/png";
      cb(new Blob(["x"], { type: t }));
    },
  };
  return { canvas, calls };
}

const img = {} as CanvasImageSource;

describe("image crop", () => {
  it("renders a 512x512 WebP for an avatar", async () => {
    const { canvas, calls } = fakeCanvas(["image/webp", "image/jpeg"]);
    const v: CropView = { w: 1200, h: 800, crop: 240, zoom: 1, x: 0, y: 0 };
    const blob = await renderCrop(img, v, () => canvas);
    expect([canvas.width, canvas.height]).toEqual([512, 512]);
    expect(blob.type).toBe("image/webp");
    // Zoom 1 on a landscape photo: the full height, centred.
    expect(calls[0]).toEqual([img, 200, 0, 800, 800, 0, 0, 512, 512]);
  });

  it("falls back to JPEG when the browser cannot encode WebP", async () => {
    const { canvas } = fakeCanvas(["image/jpeg"]);
    const blob = await renderCrop(img, { w: 600, h: 600, crop: 240, zoom: 2, x: 0, y: 0 }, () => canvas);
    expect(blob.type).toBe("image/jpeg");
    expect([canvas.width, canvas.height]).toEqual([512, 512]);
  });

  it("keeps wide logos wide", async () => {
    const { canvas } = fakeCanvas(["image/webp"]);
    await renderCrop(img, { w: 2000, h: 500, crop: 240, zoom: 1, x: 0, y: 0, aspect: 4 }, () => canvas);
    expect([canvas.width, canvas.height]).toEqual([2048, 512]);
    expect(outputSize(0.5)).toEqual({ width: 512, height: 1024 });
  });

  it("clamps panning so the photo always covers the window", () => {
    const v: CropView = { w: 1200, h: 800, crop: 240, zoom: 1, x: 999, y: 50 };
    expect(clampOffset(v)).toEqual({ x: 60, y: 0 });
    const r = cropSource(v);
    expect(r.sx).toBe(0);
    expect(r.sw).toBe(800);
  });

  it("zooming in shows a smaller part of the source", () => {
    const r = cropSource({ w: 1000, h: 1000, crop: 250, zoom: 2, x: 0, y: 0 });
    expect(r).toEqual({ sx: 250, sy: 250, sw: 500, sh: 500 });
  });

  it("checks type and size", () => {
    expect(checkFile({ type: "image/svg+xml", size: 10 })).toBe("bad_type");
    expect(checkFile({ type: "image/png", size: 6 * 1024 * 1024 })).toBe("too_big");
    expect(checkFile({ type: "image/webp", size: 1000 })).toBeNull();
  });
});
