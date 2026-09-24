/**
 * IconProvider - loads icon PNGs in the browser and extracts pixel data.
 *
 * The icon collections are served from /assets/icons (copied into public/).
 */
import type { IconImage } from "./RotationGame.ts";

const imageCache = new Map<string, Promise<IconImage>>();
const bitmapCache = new Map<string, Promise<HTMLImageElement>>();

/** Fetches (and caches) the raw PNG - decoding happens off the main thread,
 * so this can run fully in parallel for hundreds of icons. */
export function fetchIconBitmap(url: string): Promise<HTMLImageElement> {
    const cached = bitmapCache.get(url);
    if (cached !== undefined) {
        return cached;
    }
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load ${url}`));
        img.src = url;
    });
    bitmapCache.set(url, promise);
    return promise;
}

/** The synchronous main-thread work: canvas draw + getImageData. */
function extractIconImage(url: string, bitmap: HTMLImageElement): IconImage {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error(`No 2D context for ${url}`);
    }
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, data };
}

export function loadIconImage(url: string): Promise<IconImage> {
    const cached = imageCache.get(url);
    if (cached !== undefined) {
        return cached;
    }

    const promise = fetchIconBitmap(url).then((bitmap) => extractIconImage(url, bitmap));
    imageCache.set(url, promise);
    return promise;
}

/**
 * Loads many icons with two phases:
 * 1. All fetches run in parallel - network and decode don't block the main
 *    thread, which is what makes large categories load fast.
 * 2. The synchronous canvas work runs in ~4ms time slices with a macrotask
 *    yield in between, so the browser always gets to render a frame and the
 *    gallery does not stutter while filling in.
 */
export async function loadIconImages(
    urls: string[],
    onLoaded?: (index: number, image: IconImage) => void,
): Promise<IconImage[]> {
    const bitmaps = await Promise.all(urls.map(fetchIconBitmap));
    const images: IconImage[] = new Array(urls.length);
    let next = 0;
    while (next < urls.length) {
        const sliceStart = performance.now();
        while (next < urls.length && performance.now() - sliceStart < 4) {
            const index = next;
            next++;
            const url = urls[index];
            const bitmap = bitmaps[index];
            if (url === undefined || bitmap === undefined) {
                continue;
            }
            const cached = imageCache.get(url);
            let image: IconImage;
            if (cached !== undefined) {
                image = await cached;
            } else {
                image = extractIconImage(url, bitmap);
                imageCache.set(url, Promise.resolve(image));
            }
            images[index] = image;
            onLoaded?.(index, image);
        }
        if (next < urls.length) {
            // Macrotask yield so the browser can render before the next
            // slice (microtask-only yields would not give it a frame).
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
            });
        }
    }
    return images;
}