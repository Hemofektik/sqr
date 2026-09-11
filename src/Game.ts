import {
    Color,
    WebGLRenderer,
} from "three";
import { BackgroundScreen } from "./Background.ts";
import { SQFont } from "./SQFont.ts";
import { ScreenManager } from "./ScreenManager.ts";
import type { ScreenContext, GameScreen } from "./ScreenManager.ts";
import { MenuScreen } from "./MenuScreen.ts";
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
const ICON_COUNTS: Record<string, number> = {
    "Common Flags": 120,
    "Uncommon Flags": 120,
    Food: 29,
    Mix: 51,
};

export class Game {
    public readonly canvas: HTMLCanvasElement;
    public readonly renderer: WebGLRenderer;
    public readonly background: BackgroundScreen;
    public readonly font: SQFont;
    public readonly screenManager: ScreenManager;
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
            getNumIcons: (category) => ICON_COUNTS[category] ?? 0,
            getNumIconsUnlocked: () => 0,
            showToast: (message) => this.showToast(message),
            font: this.font,
        };
        this.screenManager = new ScreenManager(context);

        this.screenManager.addScreen(new MainMenuScreen(
            () => this.screenManager.addScreen(new RotationGameModeScreen()),
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
    }

    private handleKey(event: KeyboardEvent, down: boolean): void {
        const top = this.topScreen();
        if (top === undefined) {
            return;
        }

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
                if (event.key === "Escape" || event.key === "Enter") {
                    this.screenManager.popScreen();
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
        this.background.update(this.gameTime);
        this.screenManager.update(dt, this.gameTime);
        this.draw();
    }

    public draw(): void {
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.cssWidth, this.cssHeight);
        this.renderer.clear(true, true, true);

        this.renderer.setViewport(this.viewportX, this.viewportY, this.viewportW, this.viewportH);
        const gl = this.renderer.getContext();
        gl.depthRange(0.9, 1);
        this.renderer.render(this.background.gridScene, this.background.gridCamera);
        gl.depthRange(0.5, 0.9);
        this.renderer.render(this.background.menuScene, this.background.menuCamera);
        // Screen text draws into the foreground depth band (XNA: MinDepth 0,
        // MaxDepth 0.4), so it always wins the depth test against the swarm.
        gl.depthRange(0, 0.4);
        this.screenManager.draw();
        gl.depthRange(0, 1);
    }
}