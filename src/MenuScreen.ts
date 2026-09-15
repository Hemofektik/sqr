/**
 * MenuScreen - port of GameStateManagement MenuScreen/MenuEntry/SliderMenuEntry.
 *
 * Menu text is drawn with the superquadric font in the ortho space
 * (-100..100, -56.25..56.25) exactly like the XNA screens did.
 */
import { GameScreen } from "./ScreenManager.ts";
import type { ScreenContext } from "./ScreenManager.ts";
import { SQFont } from "./SQFont.ts";
import { SuperQuadric } from "./SuperQuadric.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

export const Z_DEPTH = 50;

export interface MenuEntryDef {
    text: string;
    selected: (entry: MenuEntryDef) => void;
    /** Slider support (SliderMenuEntry). */
    slider?: {
        value: number;
        enabled: boolean;
    };
}

export class MenuScreen extends GameScreen {
    public readonly kind: "mainMenu" | "gameMode" | "options" = "mainMenu";
    public menuTitle: string;
    public menuEntries: MenuEntryDef[] = [];
    public selectedEntry = 0;
    /** Set by the host each frame for slider adjustment. */
    public heldKeys: { left: boolean; right: boolean } = { left: false, right: false };

    public constructor(menuTitle: string) {
        super();
        this.menuTitle = menuTitle;
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;
    }

    protected getFont(): SQFont | undefined {
        return this.manager?.context.font;
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        this.updateSelectionFades(dt);
    }

    private selectionFades: number[] = [];

    private updateSelectionFades(dt: number): void {
        const fadeSpeed = dt * 4;
        while (this.selectionFades.length < this.menuEntries.length) {
            this.selectionFades.push(0);
        }
        for (let i = 0; i < this.menuEntries.length; i++) {
            const isSelected = this.isActive && i === this.selectedEntry;
            const current = this.selectionFades[i] ?? 0;
            this.selectionFades[i] = isSelected
                ? Math.min(current + fadeSpeed, 1)
                : Math.max(current - fadeSpeed, 0);
        }
    }

    public getSelectionFade(index: number): number {
        return this.selectionFades[index] ?? 0;
    }

    /** Port of MenuScreen.HandleInput. */
    public handleMenuInput(action: "up" | "down" | "select" | "cancel" | "left" | "right"): void {
        if (action === "up") {
            this.selectedEntry = (this.selectedEntry + this.menuEntries.length - 1) % this.menuEntries.length;
        } else if (action === "down") {
            this.selectedEntry = (this.selectedEntry + 1) % this.menuEntries.length;
        } else if (action === "select") {
            this.menuEntries[this.selectedEntry]?.selected(this.menuEntries[this.selectedEntry] as MenuEntryDef);
        } else if (action === "cancel") {
            this.onBackRequest();
        } else if (action === "left" || action === "right") {
            // Port of MenuScreen.HandleInput: MenuLeft/MenuRight trigger the
            // selected entry only for non-slider entries (the original's
            // OptionsMenuScreen checks `sme == null`). Sliders are adjusted
            // continuously via heldKeys in OptionsMenuScreen.Update.
            const entry = this.menuEntries[this.selectedEntry];
            if (entry !== undefined && entry.slider === undefined) {
                entry.selected(entry);
            }
        }
    }

    protected onBack(): void {
        this.manager?.popScreen();
    }

    protected onBackRequest(): void {
        this.onBack();
    }

    /** Port of MenuScreen.Draw: title + entries. */
    public override draw(ctx: ScreenContext): void {
        const font = this.getFont();
        if (font === undefined) {
            return;
        }
        const fadeValue = 1 - this.transitionPosition;
        const fontColor = new Vec4(1, 1, 1, fadeValue);

        // Port of MenuScreen.Draw: rotate the light around the superquadrics
        // while transitioning and set the ortho camera for this screen.
        {
            const theta = (1 - fadeValue) * (Math.PI * 0.5);
            const phi = fadeValue * 3 - 1;
            SuperQuadric.setLightDir(
                Mat4.createFromYawPitchRoll(phi, theta, 0).forward(),
            );
        }

        // Title (MenuScreen.Draw).
        const titleY = 2.5 - Math.pow(fadeValue, 0.2) * 1.8;
        font.addText(
            this.menuTitle,
            new Vec3(-1.25 * Z_DEPTH, titleY * Z_DEPTH, -1 * Z_DEPTH),
            1.3,
            fontColor,
        );

        // Entries.
        let entryY = 0.2;
        const entryXBase = -0.2;
        for (let i = 0; i < this.menuEntries.length; i++) {
            const entry = this.menuEntries[i];
            if (entry === undefined) {
                continue;
            }
            const selectionFade = this.getSelectionFade(i);
            const pulsate = Math.sin(ctx.gameTime * 6) + 1;
            const colorScale = 1 - pulsate * 0.5 * selectionFade;
            // Vector3.Lerp(Color.OrangeRed, Color.White, colorScale);
            // XNA OrangeRed = (255, 69, 0).
            const r = 1 + (1 - 1) * colorScale;
            const g = 0.2706 + (1 - 0.2706) * colorScale;
            const b = 0 + (1 - 0) * colorScale;
            const entryColor = new Vec4(r, g, b, fadeValue);

            const xPos = Math.pow(fadeValue, 0.2) * 1.8 + entryXBase - 0.1 * selectionFade - 2.5;
            font.addText(
                entry.text,
                new Vec3(xPos * Z_DEPTH, entryY * Z_DEPTH, -1 * Z_DEPTH),
                1,
                entryColor,
            );

            if (entry.slider !== undefined) {
                this.drawSlider(font, entry, xPos, entryY, fadeValue);
            }

            entryY -= 0.2;
        }

        // MenuScreen.Draw uses the ortho projection for title and entries.
        const viewPosition = new Vec3(0, 0, 1);
        const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
        const projMatrix = Mat4.createOrthographicOffCenter(-100, 100, -56.25, 56.25, 1, 550);
        font.applyCamera(viewPosition, viewMatrix, projMatrix);
        font.flush();
    }

    /** Port of SliderMenuEntry.Draw. */
    private drawSlider(font: SQFont, entry: MenuEntryDef, xPos: number, entryY: number, fadeValue: number): void {
        const slider = entry.slider;
        if (slider === undefined) {
            return;
        }
        const numSliderElements = 40;
        // isSelected ? Color.OrangeRed : Color.White (OrangeRed = 255,69,0).
        const color = this.selectedEntry === this.menuEntries.indexOf(entry) ? [1, 0.2706, 0] : [1, 1, 1];
        const fontColor = new Vec4(color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, fadeValue);
        const emissiveColor = new Vec4(0, 0, 0, fadeValue);

        const sliderWidth = numSliderElements / Z_DEPTH;
        const sliderStartX = xPos + 1.2;

        font.addText("(", new Vec3(sliderStartX * Z_DEPTH, entryY * Z_DEPTH, -1 * Z_DEPTH), 1, fontColor, emissiveColor);
        // Original: new Vector3(xPos + 1.21f + sliderWidth, ...) - relative to
        // xPos, not to sliderStartX.
        font.addText(")", new Vec3((xPos + 1.21 + sliderWidth) * Z_DEPTH, entryY * Z_DEPTH, -1 * Z_DEPTH), 1, fontColor, emissiveColor);

        const green = new Vec4(0, 0.502, 0, fadeValue); // XNA Color.Green = (0,128,0)
        const yellow = new Vec4(1, 1, 0, fadeValue);
        const red = new Vec4(1, 0, 0, fadeValue);

        const numElementsX = Math.floor(numSliderElements * slider.value);
        for (let y = 1; y < 4; y++) {
            for (let x = 0; x < numElementsX; x++) {
                const lerp = x / (numSliderElements - 1);
                let sliderColor: Vec4;
                if (lerp < 0.5) {
                    sliderColor = Vec4.lerp(green, yellow, lerp * 2);
                } else {
                    sliderColor = Vec4.lerp(yellow, red, lerp * 2 - 1);
                }
                const ox = sliderStartX * Z_DEPTH + 1.5 + 1.01 * x;
                const oy = entryY * Z_DEPTH + 1.5 + 1.01 * y;
                font.addElement(sliderColor, emissiveColor, 1, new Vec3(ox, oy, -1 * Z_DEPTH), new Vec4(0.1, 0.1, -10, 1));
            }
        }
    }

    /**
     * Entry rects in the font's ortho space for mouse hit testing.
     * Entry i is drawn at (xPos * Z_DEPTH, entryY * Z_DEPTH) with glyph
     * scale 1, so one glyph pixel is one ortho unit (letterHeight = 5).
     */
    public getEntryRects(font: SQFont): { x: number; y: number; w: number; h: number }[] {
        const rects: { x: number; y: number; w: number; h: number }[] = [];
        const fadeValue = 1 - this.transitionPosition;
        let entryY = 0.2;
        const entryXBase = -0.2;
        for (let i = 0; i < this.menuEntries.length; i++) {
            const entry = this.menuEntries[i];
            if (entry === undefined) {
                continue;
            }
            const xPos = Math.pow(fadeValue, 0.2) * 1.8 + entryXBase - 2.5;
            const width = font.getTextWidth(entry.text);
            rects.push({
                x: xPos * Z_DEPTH,
                y: entryY * Z_DEPTH,
                w: Math.max(6, width),
                h: 6,
            });
            entryY -= 0.2;
        }
        return rects;
    }

    /** Selects the entry whose rect contains the ortho point, if any. */
    public hitTest(orthoX: number, orthoY: number, font: SQFont): boolean {
        const rects = this.getEntryRects(font);
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            if (rect === undefined) {
                continue;
            }
            if (orthoX >= rect.x && orthoX <= rect.x + rect.w && orthoY >= rect.y && orthoY <= rect.y + rect.h) {
                this.selectedEntry = i;
                return true;
            }
        }
        return false;
    }

    public activateSelected(): void {
        const entry = this.menuEntries[this.selectedEntry];
        if (entry !== undefined) {
            entry.selected(entry);
        }
    }
}