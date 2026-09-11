/**
 * IconProvider - loads icon PNGs in the browser and extracts pixel data.
 *
 * The icon collections are served from /assets/icons (copied into public/).
 */
import type { IconImage } from "./RotationGame.ts";

const imageCache = new Map<string, Promise<IconImage>>();

export function loadIconImage(url: string): Promise<IconImage> {
    const cached = imageCache.get(url);
    if (cached !== undefined) {
        return cached;
    }

    const promise = new Promise<IconImage>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (ctx === null) {
                reject(new Error(`No 2D context for ${url}`));
                return;
            }
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height).data;
            resolve({ width: img.width, height: img.height, data });
        };
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
    imageCache.set(url, promise);
    return promise;
}