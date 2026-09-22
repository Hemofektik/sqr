import {
    Color,
    WebGLRenderer,
} from "three";
import { BackgroundScreen } from "./Background.ts";
import { SQFont } from "./SQFont.ts";
import { ScreenManager } from "./ScreenManager.ts";
import type { ScreenContext, GameScreen } from "./ScreenManager.ts";
import { MenuScreen } from "./MenuScreen.ts";
import { loadIconImage } from "./IconProvider.ts";
import { RotationGameScreen } from "./RotationGameScreen.ts";
import type { GameMode, IconImage, RotationGameHost } from "./RotationGame.ts";
import { UserConfig } from "./UserConfig.ts";
import { AudioManager } from "./AudioManager.ts";
import {
    MainMenuScreen,
    MessageBoxScreen,
    RotationGameModeScreen,
    GalleryScreen,
    HighscoreScreen,
} from "./Screens.ts";
import { Vec4 } from "./XnaMath.ts";

interface FontJson {
    letterHeight: number;
    letterSpace: number;
    glyphs: Record<string, { w: number; q: number[] }>;
}

import fontJsonRaw from "./fonts/astronaut.json";
const FONT_JSON = fontJsonRaw as FontJson;

const GAME_NAME = "Superquadriddle";

const ICON_CATEGORIES = ["Common Flags", "Uncommon Flags", "Food", "Mix"];

interface IconManifestEntry {
    name: string;
    file: string;
}

export class Game {
    public readonly canvas: HTMLCanvasElement;
    public readonly renderer: WebGLRenderer;
    public readonly background: BackgroundScreen;
    public readonly font: SQFont;
    public readonly screenManager: ScreenManager;
    public readonly userConfig: UserConfig;
    public readonly audio: AudioManager;
    private context: ScreenContext | undefined;
    public gameTime = 0;
    private lastFrameMs = performance.now();
    private cssWidth = 0;
    private cssHeight = 0;
    private viewportX = 0;
    private viewportY = 0;
    private viewportW = 0;
    private viewportH = 0;
    private heldKeys = { left: false, right: false };

    public constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.renderer = new WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false,
        });
        this.renderer.setClearColor(new Color(0, 0, 0), 1);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.autoClear = false;

        this.background = new BackgroundScreen();
        this.font = new SQFont(FONT_JSON, 8192);
        this.font.setRenderCallback((scene, camera) => {
            this.renderer.render(scene, camera);
        });

        this.userConfig = new UserConfig(ICON_CATEGORIES.length);

        // Port of InitAudio: the track order matches AddTrack.
        this.audio = new AudioManager(
            [
                "menu.ogg", // 0: menu
                "highscore.ogg", // 1: highscore
                "rotgame1.ogg", // 2: rotgame1
                "rotgame2.ogg", // 3: rotgame2
                "quadtris1.ogg", // 4: quadtris1
                "credits.ogg", // 5: credits
                "racemusic01.ogg", // 6: racemusic01
            ],
            this.userConfig.sfxVolume,
            this.userConfig.musicVolume,
        );
        const unlockAudio = (): void => {
            this.audio.unlock();
            // Port of screenManager_OnEnteringMainMenu: the default playlist
            // has only the menu track enabled. If a screen already requested
            // another playlist (e.g. the game), that one is queued and wins.
            this.audio.enableAllTracks(false);
            this.audio.toggleTrack(0);
            void this.audio.play();
            void this.audio.preloadSfx(["accept", "cancel", "validate"]);
            window.removeEventListener("pointerdown", unlockAudio);
            window.removeEventListener("keydown", unlockAudio);
        };
        window.addEventListener("pointerdown", unlockAudio);
        window.addEventListener("keydown", unlockAudio);

        const context: ScreenContext = {
            gameTime: 0,
            dt: 0,
            startBackgroundAnimation: (c1, c2) => {
                this.background.startAnimation(this.gameTime, new Vec4(...c1), new Vec4(...c2));
            },
            getCategories: () => ICON_CATEGORIES,
            getNumIcons: (category) => this.numIconsFor(category),
            getNumIconsUnlocked: (categoryIndex) => this.userConfig.getNumIconsUnlocked(categoryIndex),
            startRotationGame: (gameMode, categoryIndex, categoryName) => {
                this.startRotationGame(gameMode, categoryIndex, categoryName);
            },
            userConfig: this.userConfig,
            playCue: (cueName) => {
                void this.audio.playCue(cueName);
            },
            setMusicPlaylist: (trackIndices: number[]) => {
                // Port of CreatePlayList/EnableAllTracks/ToggleTrack/Activate.
                this.audio.enableAllTracks(false);
                for (const index of trackIndices) {
                    this.audio.toggleTrack(index);
                }
                void this.audio.activate();
            },
            applyAudioVolumes: (sfxVolume, musicVolume) => {
                this.audio.setSfxVolume(sfxVolume);
                this.audio.setMusicVolume(musicVolume);
            },
            applyBrightness: (brightness) => {
                this.applyBrightness(brightness);
            },
            showToast: (message) => this.showToast(message),
            font: this.font,
            viewportWidth: 0,
            viewportHeight: 0,
            renderScene: (scene, camera, minDepth, maxDepth) => {
                const gl = this.renderer.getContext();
                gl.depthRange(minDepth, maxDepth);
                this.renderer.render(scene, camera);
                gl.depthRange(0, 0.4);
            },
            drawIconPreview: (current, previous, alphaCurrent, alphaPrevious) => {
                this.drawIconPreview(current, previous, alphaCurrent, alphaPrevious);
            },
            drawStackIcon: (image, x, y, size, alpha) => {
                this.drawStackIcon(image, x, y, size, alpha);
            },
            drawUnlockIcon: (image, alpha) => {
                this.drawUnlockIcon(image, alpha);
            },
            drawGalleryIcon: (image, x, y, height, alpha) => {
                this.drawGalleryIcon(image, x, y, height, alpha);
            },
            drawLockedIcon: (x, y, height, alpha) => {
                this.drawLockedIcon(x, y, height, alpha);
            },
            clearGallery: () => {
                this.clearGallery();
            },
            drawHudTexture: (name, x, y, alpha) => {
                this.drawHudTexture(name, x, y, alpha);
            },
            loadAllIcons: async (category: string) => {
                const entries = await this.loadIconList(category);
                const images: IconImage[] = [];
                for (let n = 0; n < entries.length; n++) {
                    const entry = entries[n];
                    if (entry === undefined) {
                        continue;
                    }
                    const image = await loadIconImage(`/assets/icons/${entry.file}`);
                    await this.getPreviewBitmap(image);
                    this.iconNameCache.set(`${category}:${n}`, entry.name);
                    images.push(image);
                }
                return images;
            },
            getIconNames: (category: string) => {
                return this.iconNamesCache.get(category) ?? [];
            },
        };
        this.context = context;
        this.screenManager = new ScreenManager(context);

        this.screenManager.addScreen(new MainMenuScreen(
            () => this.screenManager.addScreen(new RotationGameModeScreen((gameMode, categoryIndex, categoryName) => {
                this.startRotationGame(gameMode, categoryIndex, categoryName);
            })),
            () => this.screenManager.addScreen(new MessageBoxScreen(
                `Are you sure you want to exit ${GAME_NAME}?`,
                () => this.showToast("Close the browser tab to exit."),
            )),
        ));

        this.background.startAnimation(0, new Vec4(1, 0.7, 0.2, 1), new Vec4(0.2, 0.2, 0.2, 1));

        this.initIconPreviewCanvas();
        this.initUnlockCanvas();
        this.initGalleryCanvas();
        this.resize();
        window.addEventListener("resize", () => this.resize());
        window.addEventListener("keydown", (e) => this.handleKey(e, true));
        window.addEventListener("keyup", (e) => this.handleKey(e, false));
        window.addEventListener("pointermove", (e) => this.handlePointer(e, false));
        window.addEventListener("pointerdown", (e) => this.handlePointer(e, true));
        window.addEventListener("pointerup", (e) => this.handlePointerUp(e));
        window.addEventListener("pointercancel", (e) => this.handlePointerUp(e));
    }

    /** Maps window (CSS) pixels into the font's ortho space. */
    private screenToOrtho(clientX: number, clientY: number): { x: number; y: number } {
        const nx = (clientX - this.viewportX) / this.viewportW;
        const ny = (clientY - this.viewportY) / this.viewportH;
        return {
            x: nx * 200 - 100,
            // Screen Y grows downwards, ortho Y grows upwards.
            y: 56.25 - ny * 112.5,
        };
    }

    private handlePointer(event: PointerEvent, clicked: boolean): void {
        const top = this.topScreen();
        if (top === undefined) {
            return;
        }

        // Game screen: drag & drop rotates the icon. One finger/drag turns
        // yaw+pitch, two fingers rotating around their midpoint control roll.
        if (top instanceof RotationGameScreen) {
            if (clicked) {
                // Track every active pointer by id (mouse is one pointer,
                // touch has one id per finger).
                this.dragPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (this.dragPointers.size === 2) {
                    // Second pointer down: capture the initial angle/center
                    // for the roll gesture.
                    const [a, b] = this.dragPointers.values();
                    if (a !== undefined && b !== undefined) {
                        this.dragRollAnchor = this.pointerPairState(a, b);
                    }
                }
            } else {
                const p = this.dragPointers.get(event.pointerId);
                if (p === undefined) {
                    return;
                }
                // Delta from the previous position of THIS pointer.
                const dx = event.clientX - p.x;
                const dy = event.clientY - p.y;
                p.x = event.clientX;
                p.y = event.clientY;

                if (this.dragPointers.size === 2) {
                    // Two-pointer gesture: rotating the pair around its
                    // midpoint controls roll (the angle between the two
                    // touch points), midpoint motion rotates yaw/pitch
                    // with the same signs as a single-pointer drag.
                    const anchor = this.dragRollAnchor;
                    if (anchor !== undefined) {
                        const [a, b] = this.dragPointers.values();
                        if (a !== undefined && b !== undefined) {
                            const current = this.pointerPairState(a, b);
                            // Angle delta (normalized to -pi..pi). The pair
                            // rotation maps 1:1 to screen roll.
                            let dAngle = current.angle - anchor.angle;
                            while (dAngle > Math.PI) dAngle -= Math.PI * 2;
                            while (dAngle < -Math.PI) dAngle += Math.PI * 2;
                            // Screen Y grows downwards, so a visual clockwise
                            // finger rotation yields a positive angle - negate
                            // to match the on-screen roll direction.
                            top.addRollInput(-dAngle, 0.016);

                            const dcx = current.cx - anchor.cx;
                            const dcy = current.cy - anchor.cy;
                            top.addRotationInput(-dcx * 0.04, -dcy * 0.04, 0.016);
                            this.dragRollAnchor = current;
                        }
                    }
                } else {
                    // Single pointer (mouse or one finger): standard drag.
                    top.addRotationInput(-dx * 0.04, -dy * 0.04, 0.016);
                }
            }
            return;
        }

        // Touch navigation: track pointer-downs on the highscore and gallery
        // so handlePointerUp can classify tap vs swipe (arrows/PageUp keys
        // have no touch equivalent on these screens).
        if (top instanceof HighscoreScreen || top instanceof GalleryScreen) {
            if (clicked) {
                this.swipeStart = {
                    id: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    time: performance.now(),
                };
            }
            return;
        }

        // Only the topmost non-popup menu receives pointer input.
        if (!(top instanceof MenuScreen) || top.isPopup) {
            return;
        }
        if (top.transitionPosition > 0.5) {
            return;
        }

        const ortho = this.screenToOrtho(event.clientX, event.clientY);
        if (top.hitTest(ortho.x, ortho.y, this.font) && clicked) {
            top.activateSelected();
        }
    }

    private handlePointerUp(event: PointerEvent): void {
        // Tap vs swipe classification for the highscore/gallery screens.
        const swipe = this.swipeStart;
        if (swipe !== undefined && swipe.id === event.pointerId) {
            this.swipeStart = undefined;
            // pointercancel (e.g. the browser took over) never counts.
            if (event.type === "pointerup") {
                const dx = event.clientX - swipe.x;
                const dy = event.clientY - swipe.y;
                const elapsed = performance.now() - swipe.time;
                const moved = Math.max(Math.abs(dx), Math.abs(dy));
                const isSwipe = elapsed <= 800 && moved >= 40;
                const top = this.topScreen();
                // Ignore input while the screen is still sliding in or out.
                if (top !== undefined && top.transitionPosition <= 0.5) {
                    if (top instanceof HighscoreScreen) {
                        if (!isSwipe) {
                            // Tap = back (port of MenuSelect/MenuCancel).
                            top.handleExit();
                        } else if (Math.abs(dx) > Math.abs(dy)) {
                            // Finger direction maps to the arrow keys: left
                            // = previous category, right = next.
                            top.handleToggle(dx < 0 ? "left" : "right");
                        } else {
                            // Swipe up = next mode, down = previous.
                            top.handleToggle(dy < 0 ? "up" : "down");
                        }
                    } else if (top instanceof GalleryScreen) {
                        if (!isSwipe) {
                            this.screenManager.popScreen();
                        } else if (Math.abs(dx) > Math.abs(dy)) {
                            // Horizontal swipe switches the category (the
                            // touch equivalent of the trigger arrows).
                            top.handleCategory(dx < 0 ? -1 : 1);
                        }
                    }
                }
            }
        }

        this.dragPointers.delete(event.pointerId);
        if (this.dragPointers.size < 2) {
            this.dragRollAnchor = undefined;
        }
        // Falling back from two fingers to one: the remaining pointer's
        // stored position is already its last known position (updated on
        // every move), so the single-pointer drag continues without a jump.
        // Deliberately NOT re-anchoring to the released pointer's position.
    }

    /** Angle (radians) and center of a two-pointer pair, for the roll gesture. */
    private pointerPairState(a: { x: number; y: number }, b: { x: number; y: number }): { angle: number; cx: number; cy: number } {
        return {
            angle: Math.atan2(b.y - a.y, b.x - a.x),
            cx: (a.x + b.x) / 2,
            cy: (a.y + b.y) / 2,
        };
    }

    /** Active drag pointers by pointerId (mouse or touch). */
    private readonly dragPointers = new Map<number, { x: number; y: number }>();
    private dragRollAnchor: { angle: number; cx: number; cy: number } | undefined;
    /** Swipe tracking start for the highscore/gallery touch navigation. */
    private swipeStart: { id: number; x: number; y: number; time: number } | undefined;

    public showToast(message: string): void {
        const toast = document.getElementById("toast");
        if (toast === null) {
            return;
        }
        toast.textContent = message;
        toast.classList.remove("hidden");
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2200);
    }

    private toastTimer = 0;

    /**
     * 2D icon preview overlay: the original drew the icon texture into a
     * 128x128 rect at (199,115) of the 1280x720 backbuffer with point-clamp
     * sampling. We replicate it with a 2D canvas layered above the WebGL one,
     * scaled with the letterbox viewport.
     */
    private previewCanvas: HTMLCanvasElement | undefined;
    private previewCtx: CanvasRenderingContext2D | undefined;
    private readonly previewSize = 128;
    private readonly previewBackbufferX = 199;
    private readonly previewBackbufferY = 115;
    private readonly previewBackbufferWidth = 1920;
    private readonly previewBackbufferHeight = 1080;

    private initIconPreviewCanvas(): void {
        const canvas = document.createElement("canvas");
        canvas.id = "icon-preview";
        // The canvas covers only the 128x128 preview rect itself.
        canvas.width = this.previewSize;
        canvas.height = this.previewSize;
        canvas.style.position = "absolute";
        canvas.style.pointerEvents = "none";
        canvas.style.imageRendering = "pixelated";
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("No 2D context for icon preview");
        }
        this.previewCanvas = canvas;
        this.previewCtx = ctx;
        this.updatePreviewLayout();
    }

    private updatePreviewLayout(): void {
        const canvas = this.previewCanvas;
        if (canvas === undefined) {
            return;
        }
        // Map the backbuffer rect into letterboxed window pixels.
        const scale = this.viewportW / this.previewBackbufferWidth;
        canvas.style.left = `${this.viewportX + this.previewBackbufferX * scale}px`;
        canvas.style.top = `${this.viewportY + this.previewBackbufferY * scale}px`;
        canvas.style.width = `${this.previewSize * scale}px`;
        canvas.style.height = `${this.previewSize * scale}px`;
    }

    /** Hides the icon preview (drawn only while a game is on screen). */
    private clearIconPreview(): void {
        this.previewCtx?.clearRect(0, 0, this.previewSize, this.previewSize);
    }

    /** Canvas for the unlock-icon flash at (199,815) 128x128. */
    private unlockCanvas: HTMLCanvasElement | undefined;
    private unlockCtx: CanvasRenderingContext2D | undefined;
    private readonly unlockBackbufferY = 815;

    private initUnlockCanvas(): void {
        const canvas = document.createElement("canvas");
        canvas.id = "icon-unlock";
        canvas.width = this.previewSize;
        canvas.height = this.previewSize;
        canvas.style.position = "absolute";
        canvas.style.pointerEvents = "none";
        canvas.style.imageRendering = "pixelated";
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("No 2D context for unlock display");
        }
        this.unlockCanvas = canvas;
        this.unlockCtx = ctx;
        this.updateUnlockLayout();
    }

    private updateUnlockLayout(): void {
        const canvas = this.unlockCanvas;
        if (canvas === undefined) {
            return;
        }
        const scale = this.viewportW / this.previewBackbufferWidth;
        canvas.style.left = `${this.viewportX + this.previewBackbufferX * scale}px`;
        canvas.style.top = `${this.viewportY + this.unlockBackbufferY * scale}px`;
        canvas.style.width = `${this.previewSize * scale}px`;
        canvas.style.height = `${this.previewSize * scale}px`;
    }

    private drawUnlockIcon(image: IconImage, alpha: number): void {
        const ctx = this.unlockCtx;
        if (ctx === undefined) {
            return;
        }
        ctx.clearRect(0, 0, this.previewSize, this.previewSize);
        const bitmap = this.previewBitmapCache.get(image);
        if (bitmap === undefined) {
            void this.getPreviewBitmap(image);
            return;
        }
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, 0, 0, this.previewSize, this.previewSize);
        ctx.globalAlpha = 1;
    }

    /**
     * Gallery canvas: covers the full 1920x1080 backbuffer (the original's
     * HUD coordinate space) so the grid can draw at its original coordinates.
     */
    private galleryCanvas: HTMLCanvasElement | undefined;
    private galleryCtx: CanvasRenderingContext2D | undefined;
    private lockedImageCanvas: HTMLCanvasElement | undefined;

    private initGalleryCanvas(): void {
        const canvas = document.createElement("canvas");
        canvas.id = "gallery";
        canvas.width = this.previewBackbufferWidth;
        canvas.height = this.previewBackbufferHeight;
        canvas.style.position = "absolute";
        canvas.style.pointerEvents = "none";
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("No 2D context for gallery");
        }
        this.galleryCanvas = canvas;
        this.galleryCtx = ctx;
        this.updateGalleryLayout();

        // The locked-image placeholder (a gray square with a padlock-ish X).
        const locked = document.createElement("canvas");
        locked.width = 64;
        locked.height = 64;
        const lctx = locked.getContext("2d");
        if (lctx !== null) {
            lctx.fillStyle = "#3a3a3a";
            lctx.fillRect(0, 0, 64, 64);
            lctx.strokeStyle = "#6a6a6a";
            lctx.lineWidth = 4;
            lctx.strokeRect(4, 4, 56, 56);
            lctx.beginPath();
            lctx.moveTo(10, 10);
            lctx.lineTo(54, 54);
            lctx.moveTo(54, 10);
            lctx.lineTo(10, 54);
            lctx.stroke();
        }
        this.lockedImageCanvas = locked;
    }

    private updateGalleryLayout(): void {
        const canvas = this.galleryCanvas;
        if (canvas === undefined) {
            return;
        }
        const scale = this.viewportW / this.previewBackbufferWidth;
        canvas.style.left = `${this.viewportX}px`;
        canvas.style.top = `${this.viewportY}px`;
        canvas.style.width = `${this.viewportW}px`;
        canvas.style.height = `${this.viewportH}px`;
        void scale;
    }

    private clearGallery(): void {
        this.galleryCtx?.clearRect(0, 0, this.previewBackbufferWidth, this.previewBackbufferHeight);
    }

    private readonly hudTextureCache = new Map<string, HTMLImageElement>();
    private readonly hudTextureRetryAt = new Map<string, number>();

    private loadHudTexture(name: string, cacheBust: number): HTMLImageElement {
        this.hudTextureRetryAt.set(name, performance.now());
        const image = new Image();
        // Cache-bust retries so a stale cached 404 (from before the textures
        // were served) cannot poison the cache forever.
        image.src = cacheBust > 0 ? `/textures/${name}.png?r=${cacheBust}` : `/textures/${name}.png`;
        return image;
    }

    /**
     * Draws a HUD hint texture (dpad/trigger input hints) at backbuffer
     * coordinates onto the 2D overlay. Textures load on demand; failed
     * loads retry at most every 2 seconds.
     */
    private drawHudTexture(name: string, x: number, y: number, alpha: number): void {
        const ctx = this.galleryCtx;
        if (ctx === undefined || alpha <= 0.001) {
            return;
        }
        let image = this.hudTextureCache.get(name);
        if (image === undefined) {
            image = this.loadHudTexture(name, 0);
            this.hudTextureCache.set(name, image);
        } else if (image.complete && image.naturalWidth === 0) {
            // Broken (e.g. a cached 404): retry with a cache-busted URL.
            const lastTry = this.hudTextureRetryAt.get(name) ?? 0;
            if (performance.now() - lastTry > 2000) {
                image = this.loadHudTexture(name, Math.round(performance.now()));
                this.hudTextureCache.set(name, image);
            }
        }
        if (!image.complete || image.naturalWidth === 0) {
            return; // Not loaded yet - draws from the next frame on.
        }
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, x, y);
        ctx.globalAlpha = 1;
    }

    /** Gallery grid icon: height in backbuffer pixels, aspect preserved. */
    private drawGalleryIcon(image: IconImage, x: number, y: number, height: number, alpha: number): void {
        const ctx = this.galleryCtx;
        if (ctx === undefined) {
            return;
        }
        const bitmap = this.previewBitmapCache.get(image);
        if (bitmap === undefined) {
            void this.getPreviewBitmap(image);
            return;
        }
        const scale = height / image.height;
        const width = image.width * scale;
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, x, y, width, height);
        ctx.globalAlpha = 1;
    }

    private drawLockedIcon(x: number, y: number, height: number, alpha: number): void {
        const ctx = this.galleryCtx;
        if (ctx === undefined || this.lockedImageCanvas === null || this.lockedImageCanvas === undefined) {
            return;
        }
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.lockedImageCanvas, x, y, height, height);
        ctx.globalAlpha = 1;
    }

    /** Draws a Challenge stack icon in backbuffer coordinates. */
    private drawStackIcon(image: IconImage, x: number, y: number, size: number, alpha: number): void {
        const ctx = this.previewCtx;
        if (ctx === undefined) {
            return;
        }
        const bitmap = this.previewBitmapCache.get(image);
        if (bitmap === undefined) {
            void this.getPreviewBitmap(image);
            return;
        }
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, x, y, size, size);
        ctx.globalAlpha = 1;
    }

    /** Port of the HUD spriteBatch icon-preview block. */
    private drawIconPreview(
        current: IconImage,
        previous: IconImage | undefined,
        alphaCurrent: number,
        alphaPrevious: number,
    ): void {
        const ctx = this.previewCtx;
        if (ctx === undefined) {
            return;
        }
        ctx.clearRect(0, 0, this.previewSize, this.previewSize);
        if (previous !== undefined && alphaPrevious > 0.001) {
            this.drawIconToPreview(ctx, previous, alphaPrevious);
        }
        if (alphaCurrent > 0.001) {
            this.drawIconToPreview(ctx, current, alphaCurrent);
        }
    }

    private previewBitmapCache = new Map<IconImage, ImageBitmap | HTMLCanvasElement>();

    private async getPreviewBitmap(image: IconImage): Promise<ImageBitmap | HTMLCanvasElement> {
        const cached = this.previewBitmapCache.get(image);
        if (cached !== undefined) {
            return cached;
        }
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
            throw new Error("No 2D context for icon bitmap");
        }
        ctx.putImageData(new ImageData(image.data.slice(), image.width, image.height), 0, 0);
        this.previewBitmapCache.set(image, canvas);
        return canvas;
    }

    private drawIconToPreview(
        ctx: CanvasRenderingContext2D,
        image: IconImage,
        alpha: number,
    ): void {
        const bitmap = this.previewBitmapCache.get(image);
        // Only draw from the synchronous cache; bitmaps are prepared on load.
        if (bitmap === undefined) {
            void this.getPreviewBitmap(image);
            return;
        }
        ctx.globalAlpha = alpha;
        // PointClamp: disable smoothing for the pixelated upscale.
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bitmap, 0, 0, this.previewSize, this.previewSize);
        ctx.globalAlpha = 1;
    }

    /** Icon file list cache per category (from /icons/manifest.json). */
    private iconListCache = new Map<string, Promise<IconManifestEntry[]>>();
    private iconNameCache = new Map<string, string>();
    private iconNamesCache = new Map<string, string[]>();

    private loadIconList(category: string): Promise<IconManifestEntry[]> {
        const cached = this.iconListCache.get(category);
        if (cached !== undefined) {
            return cached;
        }
        const promise = (async () => {
            const response = await fetch("/icons/manifest.json");
            const manifest = (await response.json()) as Record<string, IconManifestEntry[]>;
            const entries = manifest[category] ?? [];
            this.iconNamesCache.set(category, entries.map((entry) => entry.name));
            return entries;
        })();
        this.iconListCache.set(category, promise);
        return promise;
    }

    private startRotationGame(gameMode: GameMode, categoryIndex: number, categoryName: string): void {
        // Port of LoadingScreen.Load: the game replaces all current screens
        // (background + menus transition off).
        for (const screen of this.screenManager.getScreens()) {
            screen.exitScreen();
        }
        const host: RotationGameHost = {
            font: this.font,
            loadIcon: async (category: string, index: number) => {
                const entries = await this.loadIconList(category);
                // Manifest entries already include the subfolder (e.g.
                // "flags/hn.png" or "cake.png"), so use them as-is.
                const entry = entries[index];
                const image = await loadIconImage(`/assets/icons/${entry?.file ?? ""}`);
                // Prepare the preview bitmap synchronously after load so the
                // HUD can draw it the same frame.
                await this.getPreviewBitmap(image);
                if (entry !== undefined) {
                    this.iconNameCache.set(`${category}:${index}`, entry.name);
                }
                return image;
            },
            getIconName: (category: string, index: number) => {
                // Resolve from the manifest list (synchronously available
                // once the list was fetched; the game fetches it on start).
                const names = this.iconNamesCache.get(category);
                const name = names?.[index];
                if (name !== undefined) {
                    return name;
                }
                // List not fetched yet: fall back to the per-icon cache.
                return this.iconNameCache.get(`${category}:${index}`) ?? "?";
            },
            getNumIconsUnlocked: (categoryIndex: number) => this.userConfig.getNumIconsUnlocked(categoryIndex),
            unlockIcon: (categoryIndex: number) => {
                this.userConfig.unlockIcon(categoryIndex);
            },
            getNumIcons: (category: string) => this.numIconsFor(category),
            drawIconPreview: (current, previous, alphaCurrent, alphaPrevious) => {
                this.drawIconPreview(current, previous, alphaCurrent, alphaPrevious);
            },
            drawStackIcon: (image, x, y, size, alpha) => {
                this.drawStackIcon(image, x, y, size, alpha);
            },
            drawUnlockIcon: (image, alpha) => {
                this.drawUnlockIcon(image, alpha);
            },
            startBackgroundAnimation: (color) => {
                // Only the grid background is visible during the game.
                this.background.startAnimation(this.gameTime, new Vec4(1, 1, 1, 1), color);
            },
            setMusicPlaylist: (trackIndices) => {
                this.audio.enableAllTracks(false);
                for (const index of trackIndices) {
                    this.audio.toggleTrack(index);
                }
                void this.audio.activate();
            },
            playCue: (cueName) => {
                void this.audio.playCue(cueName);
            },
            invertYAxis: this.userConfig.invertYAxis,
        };
        this.screenManager.addScreen(new RotationGameScreen(
            gameMode,
            categoryIndex,
            categoryName,
            host,
        ));
    }

    /** Icon counts come from the manifest - the single source of truth. */
    private numIconsFor(category: string): Promise<number> {
        const cached = this.iconCounts.get(category);
        if (cached !== undefined) {
            return cached;
        }
        const promise = this.loadIconList(category).then((files) => {
            this.screenManager.cacheNumIcons(category, files.length);
            return files.length;
        });
        this.iconCounts.set(category, promise);
        return promise;
    }

    private iconCounts = new Map<string, Promise<number>>();

    public resize(): void {
        this.cssWidth = window.innerWidth;
        this.cssHeight = window.innerHeight;
        this.renderer.setSize(this.cssWidth, this.cssHeight, false);
        this.updateLayout();
    }

    /**
     * Port of the brightness setting (SQRGame.cs): it drove the gamma power
     * of the bloom-combine pass, pow(color, gamma) with gamma in 0.4545..2.2.
     * The port applies the same curve as an SVG gamma filter on the canvases.
     */
    private readonly brightnessGammaMin = 0.4545454545;
    private readonly brightnessGammaMax = 2.2;

    private applyBrightness(brightness: number): void {
        // Port of the original's gamma power formula.
        const power = brightness < 0.5
            ? (0.5 - brightness) * 2 * (this.brightnessGammaMax - 1) + 1
            : (1 - brightness) * 2 * (1 - this.brightnessGammaMin) + this.brightnessGammaMin;

        const feFuncs = document.querySelectorAll("#brightness-gamma feFuncR, #brightness-gamma feFuncG, #brightness-gamma feFuncB");
        feFuncs.forEach((feFunc) => {
            feFunc.setAttribute("exponent", String(power));
        });

        // Apply to every rendered canvas. Note the SVG filter works in sRGB,
        // matching the shader's pow() on the final color.
        const filter = `url(#brightness-gamma)`;
        this.canvas.style.filter = filter;
        for (const id of ["icon-preview", "icon-unlock", "gallery"]) {
            const el = document.getElementById(id);
            if (el !== null) {
                el.style.filter = filter;
            }
        }
    }

    private updateLayout(): void {
        // The original always rendered into a fixed 16:9 backbuffer (1280x720)
        // with the frustum (-1.6..1.6, -0.9..0.9). Letterbox that frustum into
        // the window so the field of view and proportions stay exactly as in XNA
        // regardless of the browser window shape.
        const targetAspect = 16 / 9;
        let viewWidth = this.cssWidth;
        let viewHeight = viewWidth / targetAspect;
        if (viewHeight > this.cssHeight) {
            viewHeight = this.cssHeight;
            viewWidth = viewHeight * targetAspect;
        }
        this.viewportX = (this.cssWidth - viewWidth) / 2;
        this.viewportY = (this.cssHeight - viewHeight) / 2;
        this.viewportW = viewWidth;
        this.viewportH = viewHeight;
        if (this.context !== undefined) {
            this.context.viewportWidth = this.viewportW;
            this.context.viewportHeight = this.viewportH;
        }
        this.updatePreviewLayout();
        this.updateUnlockLayout();
        this.updateGalleryLayout();
        this.applyBrightness(this.userConfig.brightness);
    }

    private handleKey(event: KeyboardEvent, down: boolean): void {
        if (down) {
            this.keysDown.add(event.key);
        } else {
            this.keysDown.delete(event.key);
            this.keysDown.delete(event.key.toLowerCase());
        }

        const top = this.topScreen();

        if (top instanceof MenuScreen) {
            if (down) {
                if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
                    top.handleMenuInput("up");
                } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
                    top.handleMenuInput("down");
                } else if (event.key === "Enter" || event.key === " ") {
                    top.handleMenuInput("select");
                } else if (event.key === "Escape" || event.key === "Backspace") {
                    top.handleMenuInput("cancel");
                } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
                    top.handleMenuInput("left");
                    this.heldKeys.left = true;
                } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
                    top.handleMenuInput("right");
                    this.heldKeys.right = true;
                }
            } else {
                if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
                    this.heldKeys.left = false;
                }
                if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
                    this.heldKeys.right = false;
                }
            }
            top.heldKeys = this.heldKeys;
            return;
        }

        if (top instanceof GalleryScreen) {
            if (down) {
                if (event.key === "Escape" || event.key === "Enter") {
                    this.screenManager.popScreen();
                } else if (event.key === "PageUp") {
                    top.handleCategory(-1);
                } else if (event.key === "PageDown") {
                    top.handleCategory(1);
                } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
                    top.handleSelect(-1, 0);
                } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
                    top.handleSelect(1, 0);
                } else if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
                    top.handleSelect(0, -1);
                } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
                    top.handleSelect(0, 1);
                }
            }
            return;
        }

        if (top instanceof HighscoreScreen) {
            if (down) {
                if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
                    top.handleExit();
                } else if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
                    top.handleToggle("up");
                } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
                    top.handleToggle("down");
                } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
                    top.handleToggle("left");
                } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
                    top.handleToggle("right");
                }
            }
            return;
        }

        if (top instanceof RotationGameScreen) {
            if (down) {
                if (event.key === "Escape") {
                    // Port of PauseMenuScreen quit flow (simplified): leave the
                    // game and load a fresh background + main menu, like
                    // LoadingScreen.Load(..., new BackgroundScreen(),
                    // new MainMenuScreen()).
                    for (const screen of this.screenManager.getScreens()) {
                        screen.exitScreen();
                    }
                    this.screenManager.addScreen(new MainMenuScreen(
                        () => this.screenManager.addScreen(new RotationGameModeScreen((gameMode, categoryIndex, categoryName) => {
                            this.startRotationGame(gameMode, categoryIndex, categoryName);
                        })),
                        () => this.screenManager.addScreen(new MessageBoxScreen(
                            `Are you sure you want to exit ${GAME_NAME}?`,
                            () => this.showToast("Close the browser tab to exit."),
                        )),
                    ));
                }
            }
            return;
        }

        // Non-menu screens (credits, help, message box): any key exits.
        if (down && (event.key === "Enter" || event.key === "Escape" || event.key === " ")) {
            this.screenManager.popScreen();
        }
    }

    private topScreen(): GameScreen | undefined {
        const screens = this.screenManager.getScreens();
        return screens[screens.length - 1];
    }

    public update(): void {
        const now = performance.now();
        const dt = Math.min(0.05, (now - this.lastFrameMs) * 0.001);
        this.lastFrameMs = now;
        this.gameTime += dt;

        // Continuous rotation input for the game screen (arrow keys).
        const top = this.topScreen();
        if (top instanceof RotationGameScreen) {
            const speed = 0.5;
            let yaw = 0;
            let pitch = 0;
            if (this.isKeyDown("ArrowLeft") || this.isKeyDown("a")) yaw += speed;
            if (this.isKeyDown("ArrowRight") || this.isKeyDown("d")) yaw -= speed;
            if (this.isKeyDown("ArrowUp") || this.isKeyDown("w")) pitch += speed;
            if (this.isKeyDown("ArrowDown") || this.isKeyDown("s")) pitch -= speed;
            if (yaw !== 0 || pitch !== 0) {
                top.addRotationInput(yaw, pitch, dt);
            }
        }

        this.background.update(this.gameTime);
        this.screenManager.update(dt, this.gameTime);
        this.draw();
    }

    private keysDown = new Set<string>();

    private isKeyDown(key: string): boolean {
        return this.keysDown.has(key) || this.keysDown.has(key.toLowerCase());
    }

    public draw(): void {
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.cssWidth, this.cssHeight);
        this.renderer.clear(true, true, true);

        this.renderer.setViewport(this.viewportX, this.viewportY, this.viewportW, this.viewportH);
        const gl = this.renderer.getContext();
        // The game screen draws its own grid background (vpBackGround in XNA);
        // the menu swarm is only drawn while no game is running.
        const gameActive = this.screenManager.managesScreen("game");
        gl.depthRange(0.9, 1);
        this.renderer.render(this.background.gridScene, this.background.gridCamera);
        if (!gameActive) {
            gl.depthRange(0.5, 0.9);
            this.renderer.render(this.background.menuScene, this.background.menuCamera);
        }
        // The 2D overlay (gallery grid + HUD hint textures) is cleared once
        // per frame before the screens draw into it.
        this.clearGallery();

        // Screen text draws into the foreground depth band (XNA: MinDepth 0,
        // MaxDepth 0.4), so it always wins the depth test against the swarm.
        gl.depthRange(0, 0.4);
        this.screenManager.draw();
        gl.depthRange(0, 1);

        // Hide the icon preview when no game is on screen.
        if (!gameActive) {
            this.clearIconPreview();
            this.unlockCtx?.clearRect(0, 0, this.previewSize, this.previewSize);
        }
    }
}