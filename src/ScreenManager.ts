/**
 * ScreenManager - port of GameStateManagement ScreenManager/GameScreen.
 *
 * Screens form a stack. The topmost active screen receives input; screens
 * below it are covered. Each screen has transition on/off times and a
 * TransitionPosition (0 = fully on, 1 = fully off).
 */

export type ScreenKind =
    | "background"
    | "mainMenu"
    | "gameMode"
    | "options"
    | "highscore"
    | "credits"
    | "gallery"
    | "help"
    | "messageBox"
    | "game"
    | "celeritas";

import type { SQFont } from "./SQFont.ts";
import type { Camera, Scene } from "three";
import type { IconImage } from "./RotationGame.ts";
import type { UserConfig } from "./UserConfig.ts";
export interface ScreenContext {
    /** Total game time in seconds. */
    gameTime: number;
    /** Seconds since the last frame. */
    dt: number;
    /** Change the background animation colors (MenuBackGround, BackGround). */
    startBackgroundAnimation(color1: [number, number, number, number], color2: [number, number, number, number]): void;
    /** Icon category names, e.g. ["Flags", "Food", "Mix"]. */
    getCategories(): string[];
    /** Number of icons in a category. */
    getNumIcons(category: string): Promise<number>;
    /** Number of icons unlocked in a category. */
    getNumIconsUnlocked(categoryIndex: number): number;
    /** The player's persisted settings. */
    userConfig: UserConfig;
    /** Port of AudioManager.PlayCue. */
    playCue(cueName: string): void;
    /** Port of CreatePlayList + ToggleTrack + Activate. */
    setMusicPlaylist(trackIndices: number[]): void;
    /** Applies the given sfx/music volumes to the audio system immediately. */
    applyAudioVolumes(sfxVolume: number, musicVolume: number): void;
    /** Applies the current brightness setting immediately. */
    applyBrightness(brightness: number): void;
    /** Show a transient toast message. */
    showToast(message: string): void;
    /** The superquadric font used for all screen text. */
    font: SQFont;
    /** Letterboxed viewport in CSS pixels. */
    viewportWidth: number;
    viewportHeight: number;
    /** Renders a 3D scene into the given depth band (vpMain style). */
    renderScene(scene: Scene, camera: Camera, minDepth: number, maxDepth: number): void;
    /** Draws the 2D icon preview into the HUD corner. */
    drawIconPreview(current: IconImage, previous: IconImage | undefined, alphaCurrent: number, alphaPrevious: number): void;
    /** Draws one 64x64 stack icon (Challenge mode) in backbuffer coordinates. */
    drawStackIcon(image: IconImage, x: number, y: number, size: number, alpha: number): void;
    /** Draws the unlocked icon flash (128x128 at (199,815)). */
    drawUnlockIcon(image: IconImage, alpha: number): void;
    /** Clears and draws the gallery grid overlay. */
    clearGallery(): void;
    /** Draws a HUD hint texture (dpad/trigger) at backbuffer coordinates. */
    drawHudTexture(name: string, x: number, y: number, alpha: number): void;
    /** Draws one gallery grid icon at backbuffer scale (aspect preserved). */
    drawGalleryIcon(image: IconImage, x: number, y: number, height: number, alpha: number): void;
    /** Draws the locked-image placeholder at the same position. */
    drawLockedIcon(x: number, y: number, height: number, alpha: number): void;
    /** Loads every icon of a category (gallery grid). Images stream in via
     * onLoaded as soon as each one is ready; the promise resolves when all
     * have finished. */
    loadAllIcons(category: string, onLoaded?: (index: number, image: IconImage) => void): Promise<IconImage[]>;
    /** Display names of all icons of a category, in order. */
    getIconNames(category: string): string[];
    /** Starts a rotation game, replacing the current screens (LoadingScreen.Load). */
    startRotationGame(gameMode: "TimeAttack" | "Challenge" | "FreePlay", categoryIndex: number, categoryName: string): void;
}

export abstract class GameScreen {
    public isPopup = false;
    public transitionOnTime = 0;
    public transitionOffTime = 0;
    public transitionPosition = 1;
    public screenState: "transitionOn" | "active" | "transitionOff" | "hidden" = "transitionOn";
    public abstract readonly kind: ScreenKind;

    protected manager: ScreenManager | undefined;

    public get transitionAlpha(): number {
        return 1 - this.transitionPosition;
    }

    public get isActive(): boolean {
        return (
            this.screenState === "transitionOn" ||
            this.screenState === "active" ||
            (this.screenState === "transitionOff" && !this.isCoveredByOtherScreen)
        );
    }

    private isCoveredByOtherScreen = false;

    public bind(manager: ScreenManager): void {
        this.manager = manager;
        // Port of LoadContent timing: screens read manager-owned state (e.g.
        // UserConfig) after being registered, not in their constructor.
        this.onBound();
    }

    /** Called once the screen is registered with the manager. */
    protected onBound(): void { }

    public exitScreen(): void {
        this.screenState = "transitionOff";
        this.transitionOffTime = Math.max(this.transitionOffTime, 0.001);
    }

    public update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        this.isCoveredByOtherScreen = coveredByOtherScreen;
        void gameTime;

        // Port of XNA GameScreen.Update transition logic.
        otherScreenHasFocus = otherScreenHasFocus || coveredByOtherScreen;

        if (this.screenState === "transitionOn") {
            // transitionPosition runs 1 -> 0 while coming in.
            this.transitionPosition = Math.max(0, this.transitionPosition - dt / Math.max(this.transitionOnTime, 0.001));
            if (this.transitionPosition <= 0) {
                this.screenState = "active";
            }
        } else if (this.screenState === "transitionOff") {
            // Once the transition finishes, remove the screen.
            this.transitionPosition = Math.min(1, this.transitionPosition + dt / Math.max(this.transitionOffTime, 0.001));
            if (this.transitionPosition >= 1) {
                this.manager?.removeScreen(this);
            }
        } else if (coveredByOtherScreen && !this.isPopup) {
            // Covered by another screen: transition off, then go hidden.
            this.transitionPosition = Math.min(1, this.transitionPosition + dt / Math.max(this.transitionOffTime, 0.001));
            if (this.transitionPosition >= 1) {
                this.screenState = "hidden";
            }
        } else if (this.screenState === "hidden") {
            // Screen is uncovered again: transition back in.
            this.screenState = "transitionOn";
        }
    }

    public abstract draw(ctx: ScreenContext): void;

    /** Synchronously returns a previously loaded icon count (0 if not yet loaded). */
    protected cachedNumIcons(category: string): number {
        return this.manager?.getCachedNumIcons(category) ?? 0;
    }
}

export class ScreenManager {
    private readonly screens: GameScreen[] = [];
    private screensToUpdate: GameScreen[] = [];

    public constructor(context: ScreenContext) {
        this.context = context;
    }

    public readonly context: ScreenContext;

    public addScreen(screen: GameScreen): void {
        screen.bind(this);
        this.screens.push(screen);
    }

    public removeScreen(screen: GameScreen): void {
        const index = this.screens.indexOf(screen);
        if (index >= 0) {
            this.screens.splice(index, 1);
        }
    }

    /** Removes the topmost screen (Back). */
    public popScreen(): void {
        const top = this.screens[this.screens.length - 1];
        if (top !== undefined) {
            top.exitScreen();
        }
    }

    /** Returns the last resolved icon count for a category (0 if pending). */
    public getCachedNumIcons(category: string): number {
        return this.numIconsCache.get(category) ?? 0;
    }

    /** Stores a resolved icon count for synchronous access by screens. */
    public cacheNumIcons(category: string, count: number): void {
        this.numIconsCache.set(category, count);
    }

    private readonly numIconsCache = new Map<string, number>();

    public managesScreen(kind: ScreenKind): boolean {
        return this.screens.some((s) => s.kind === kind);
    }

    public getScreen(kind: ScreenKind): GameScreen | undefined {
        return this.screens.find((s) => s.kind === kind);
    }

    public getScreens(): GameScreen[] {
        return this.screens.slice();
    }

    public update(dt: number, gameTime: number): void {
        this.screensToUpdate = this.screens.slice();

        let otherScreenHasFocus = false;
        let coveredByOtherScreen = false;

        for (let i = this.screensToUpdate.length - 1; i >= 0; i--) {
            const screen = this.screensToUpdate[i];
            if (screen === undefined) {
                continue;
            }
            screen.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
            if (screen.screenState !== "hidden") {
                otherScreenHasFocus = true;
                if (!screen.isPopup) {
                    coveredByOtherScreen = true;
                }
            }
        }

        this.context.gameTime = gameTime;
        this.context.dt = dt;
    }

    public draw(): void {
        for (const screen of this.screens) {
            if (screen.screenState === "hidden") {
                continue;
            }
            screen.draw(this.context);
        }
    }
}