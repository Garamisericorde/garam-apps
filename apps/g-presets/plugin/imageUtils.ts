/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Turns whatever image the user throws at us into something Discord will accept,
 * so nobody ever has to crop or resize anything by hand.
 */

export type ImageKind = "avatar" | "banner";

/** Discord rejects uploads over 10 MiB; stay comfortably under it. */
const MAX_BYTES = 8 * 1024 * 1024;

const TARGET: Record<ImageKind, { w: number; h: number; }> = {
    // square, Discord downscales as needed
    avatar: { w: 1024, h: 1024 },
    // profile banners render at 5:2
    banner: { w: 1200, h: 480 }
};

function readAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as ArrayBuffer);
        fr.onerror = () => reject(fr.error);
        fr.readAsArrayBuffer(blob);
    });
}

function readAsDataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}

/** GIF is animated if it carries more than one Graphic Control Extension block. */
function isAnimatedGif(buf: ArrayBuffer): boolean {
    const b = new Uint8Array(buf);
    let count = 0;
    for (let i = 0; i < b.length - 3; i++) {
        if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 0x04) {
            if (++count > 1) return true;
        }
    }
    return false;
}

/** Animated WebP files contain an "ANMF" chunk. */
function isAnimatedWebp(buf: ArrayBuffer): boolean {
    const b = new Uint8Array(buf.slice(0, 4096));
    for (let i = 0; i < b.length - 3; i++) {
        if (b[i] === 0x41 && b[i + 1] === 0x4E && b[i + 2] === 0x4D && b[i + 3] === 0x46) return true;
    }
    return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Görsel kodlanamadı"))), type, quality));
}

/** Scales and centre-crops the source so it exactly fills the target box. */
async function renderCover(source: Blob, kind: ImageKind): Promise<Blob> {
    const bitmap = await createImageBitmap(source);
    const { w, h } = TARGET[kind];

    // never upscale a small source beyond its own resolution
    const scaleCap = Math.min(1, Math.max(bitmap.width / w, bitmap.height / h));
    const outW = Math.max(1, Math.round(w * (scaleCap || 1)));
    const outH = Math.max(1, Math.round(h * (scaleCap || 1)));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";

    const scale = Math.max(outW / bitmap.width, outH / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    ctx.drawImage(bitmap, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
    bitmap.close();

    let blob = await canvasToBlob(canvas, "image/png");
    if (blob.size <= MAX_BYTES) return blob;

    // PNG too heavy (large photo) -> fall back to JPEG, dropping quality until it fits
    for (const q of [0.92, 0.85, 0.75, 0.6]) {
        blob = await canvasToBlob(canvas, "image/jpeg", q);
        if (blob.size <= MAX_BYTES) return blob;
    }
    return blob;
}

/**
 * Normalises an image into a data URI ready for `PATCH /users/@me`.
 * Animated GIF/WebP are passed through untouched so the animation survives.
 */
export async function normalizeImage(file: Blob, kind: ImageKind): Promise<string> {
    const buf = await readAsArrayBuffer(file);
    const animated =
        (file.type === "image/gif" && isAnimatedGif(buf)) ||
        (file.type === "image/webp" && isAnimatedWebp(buf));

    if (animated) {
        if (file.size > MAX_BYTES) {
            throw new Error(
                `Animasyonlu görsel ${(file.size / 1048576).toFixed(1)} MB — 8 MB sınırını aşıyor. ` +
                "Animasyonu bozmamak için yeniden boyutlandırmıyoruz; daha küçük bir dosya seç."
            );
        }
        return readAsDataUri(file);
    }

    const out = await renderCover(file, kind);
    if (out.size > MAX_BYTES) throw new Error("Görsel sıkıştırıldıktan sonra bile 8 MB'ı aşıyor.");
    return readAsDataUri(out);
}

/** Downloads an image already on Discord's CDN and re-encodes it as a data URI. */
export async function urlToDataUri(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Görsel indirilemedi (HTTP ${res.status})`);
    return readAsDataUri(await res.blob());
}

/** Rough decoded size of a data URI, for showing "≈ 2.4 MB" in the UI. */
export function dataUriBytes(uri: string): number {
    const i = uri.indexOf(",");
    if (i === -1) return 0;
    return Math.floor((uri.length - i - 1) * 3 / 4);
}

export function isAnimatedDataUri(uri: string): boolean {
    return uri.startsWith("data:image/gif") || uri.startsWith("data:image/webp");
}
