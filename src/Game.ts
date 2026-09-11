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
import type { RotationGameHost } from "./RotationGame.ts";
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

export class Game {
    public readonly canvas: HTMLCanvasElement;
    public readonly renderer: WebGLRenderer;
    public readonly background: BackgroundScreen;
    public readonly font: SQFont;
    public readonly screenManager: ScreenManager;
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

        const context: ScreenContext = {
            gameTime: 0,
            dt: 0,
            startBackgroundAnimation: (c1, c2) => {
                this.background.startAnimation(this.gameTime, new Vec4(...c1), new Vec4(...c2));
            },
            getCategories: () => ICON_CATEGORIES,
            getNumIcons: (category) => this.numIconsFor(category),
            getNumIconsUnlocked: () => 0,
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
        };
        this.context = context;
        this.screenManager = new ScreenManager(context);

        this.screenManager.addScreen(new MainMenuScreen(
            () => this.screenManager.addScreen(new RotationGameModeScreen((categoryIndex, categoryName) => {
                this.startRotationGame(categoryIndex, categoryName);
            })),
            () => this.screenManager.addScreen(new MessageBoxScreen(
                `Are you sure you want to exit ${GAME_NAME}?`,
                () => this.showToast("Close the browser tab to exit."),
            )),
        ));

        this.background.startAnimation(0, new Vec4(1, 0.7, 0.2, 1), new Vec4(0.2, 0.2, 0.2, 1));

        this.resize();
        window.addEventListener("resize", () => this.resize());
        window.addEventListener("keydown", (e) => this.handleKey(e, true));
        window.addEventListener("keyup", (e) => this.handleKey(e, false));
        window.addEventListener("pointermove", (e) => this.handlePointer(e, false));
        window.addEventListener("pointerdown", (e) => this.handlePointer(e, true));
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

        // Game screen: drag rotates the icon.
        if (top instanceof RotationGameScreen) {
            if (clicked) {
                this.dragging = !this.dragging;
                this.lastDragX = event.clientX;
                this.lastDragY = event.clientY;
            } else if (this.dragging) {
                const dx = event.clientX - (this.lastDragX ?? event.clientX);
                const dy = event.clientY - (this.lastDragY ?? event.clientY);
                this.lastDragX = event.clientX;
                this.lastDragY = event.clientY;
                top.addRotationInput(-dx * 0.02, -dy * 0.02, 0.016);
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

    private dragging = false;
    private lastDragX: number | undefined;
    private lastDragY: number | undefined;

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

    /** Icon file list cache per category (from /icons/manifest.json). */
    private iconListCache = new Map<string, Promise<string[]>>();

    private loadIconList(category: string): Promise<string[]> {
        const cached = this.iconListCache.get(category);
        if (cached !== undefined) {
            return cached;
        }
        const promise = (async () => {
            const response = await fetch("/icons/manifest.json");
            const manifest = (await response.json()) as Record<string, string[]>;
            return manifest[category] ?? [];
        })();
        this.iconListCache.set(category, promise);
        return promise;
    }

    private startRotationGame(categoryIndex: number, categoryName: string): void {
        // Port of LoadingScreen.Load: the game replaces all current screens
        // (background + menus transition off).
        for (const screen of this.screenManager.getScreens()) {
            screen.exitScreen();
        }
        const host: RotationGameHost = {
            font: this.font,
            loadIcon: async (category: string, index: number) => {
                const files = await this.loadIconList(category);
                // Manifest entries already include the subfolder (e.g.
                // "flags/hn.png" or "cake.png"), so use them as-is.
                const file = files[index] ?? "";
                return loadIconImage(`/assets/icons/${file}`);
            },
            getNumIcons: (category: string) => this.numIconsFor(category),
            drawIconPreview: () => {
                // The 2D icon preview overlay is not ported yet.
            },
            startBackgroundAnimation: (color) => {
                // Only the grid background is visible during the game.
                this.background.startAnimation(this.gameTime, new Vec4(1, 1, 1, 1), color);
            },
        };
        this.screenManager.addScreen(new RotationGameScreen(
            "TimeAttack",
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
                    this.screenManager.popScreen();
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
        // Screen text draws into the foreground depth band (XNA: MinDepth 0,
        // MaxDepth 0.4), so it always wins the depth test against the swarm.
        gl.depthRange(0, 0.4);
        this.screenManager.draw();
        gl.depthRange(0, 1);
    }
}