/**
 * All menu screens - ports of the XNA Screens folder.
 *
 * Each screen keeps the original layout math (positions, zDepth, colors) and
 * triggers the same background color animation on first activation.
 */
import { GameScreen } from "./ScreenManager.ts";
import type { ScreenContext } from "./ScreenManager.ts";
import { MenuScreen } from "./MenuScreen.ts";
import type { MenuEntryDef } from "./MenuScreen.ts";
import { SuperQuadric } from "./SuperQuadric.ts";
import { LoadingSpinner } from "./LoadingSpinner.ts";
import type { IconImage } from "./RotationGame.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

const GAME_NAME = "Superquadriddle";

/** Game modes from RotationGame.GameMode. */
export const GameMode = {
    TimeAttack: 0,
    Challenge: 1,
    FreePlay: 2,
} as const;
export type GameModeValue = (typeof GameMode)[keyof typeof GameMode];

const GAME_MODE_NAMES: Record<number, string> = {
    0: "TimeAttack",
    1: "Challenge",
    2: "FreePlay",
};

/** Shared ortho camera setup used by all screens' text. */
function setupFontCamera(font: SQFontLike, viewPosition: Vec3): void {
    const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
    const projMatrix = Mat4.createOrthographicOffCenter(-100, 100, -56.25, 56.25, 1, 550);
    font.applyCamera(viewPosition, viewMatrix, projMatrix);
}

/** Perspective camera setup used by screen titles (XNA CreatePerspectiveOffCenter). */
function setupFontCameraPerspective(font: SQFontLike, viewPosition: Vec3): void {
    const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
    const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);
    font.applyCamera(viewPosition, viewMatrix, projMatrix);
}

interface SQFontLike {
    addText(text: string, pos: Vec3, scale: number, diffuse: Vec4, emissive?: Vec4): void;
    addElement(diffuse: Vec4, emissive: Vec4, scale: number, pos: Vec3, sqParams: Vec4): void;
    getTextWidth(text: string): number;
    flush(alphaBlend?: boolean): void;
    applyCamera(viewPosition: Vec3, view: Mat4, proj: Mat4): void;
}

function setRotatingLight(transitionPosition: number): void {
    const theta = (1 - transitionPosition) * (Math.PI - Math.PI * 0.25);
    const phi = -0.5;
    SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
}
void setRotatingLight;

/** Port of MainMenuScreen. */
export class MainMenuScreen extends MenuScreen {
    public override readonly kind = "mainMenu" as const;
    private readonly onPlay: () => void;
    private readonly onExitRequest: () => void;
    private firstTimeStarted = true;
    private wasCoveredByOtherScreenLastFrame = false;

    public constructor(onPlay: () => void, onExitRequest: () => void) {
        super(GAME_NAME);
        this.onPlay = onPlay;
        this.onExitRequest = onExitRequest;
        this.menuEntries = [
            { text: "Play", selected: () => this.onPlay() },
            { text: "Gallery", selected: () => this.manager?.addScreen(new GalleryScreen()) },
            { text: "Options", selected: () => this.manager?.addScreen(new OptionsMenuScreen()) },
            { text: "Highscore", selected: () => this.manager?.addScreen(new HighscoreScreen()) },
            { text: "Credits", selected: () => this.manager?.addScreen(new CreditsScreen()) },
            { text: "Exit", selected: () => this.onExitRequest() },
        ];
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);

        // Port of MainMenuScreen.Update: re-trigger the orange background
        // animation whenever the menu becomes active again after being covered.
        if (this.wasCoveredByOtherScreenLastFrame && !coveredByOtherScreen) {
            this.manager?.context.startBackgroundAnimation([1, 0.7, 0.2, 1], [0.2, 0.2, 0.2, 1]);
        }
        this.wasCoveredByOtherScreenLastFrame = coveredByOtherScreen;

        if (otherScreenHasFocus) {
            this.firstTimeStarted = true;
        } else if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([1, 0.7, 0.2, 1], [0.2, 0.2, 0.2, 1]);
            // Port of screenManager_OnEnteringMainMenu: reactivate the menu
            // music when the main menu becomes active again.
            this.manager?.context.setMusicPlaylist([0]);
        }
    }
}

/** Port of RotationGameModeScreen. */
export class RotationGameModeScreen extends MenuScreen {
    public override readonly kind = "gameMode" as const;
    private categoryIndex = 0;
    private firstTimeStarted = true;
    private readonly onStartGame:
        | ((gameMode: "TimeAttack" | "Challenge", categoryIndex: number, categoryName: string) => void)
        | undefined;

    public constructor(
        onStartGame?: (gameMode: "TimeAttack" | "Challenge", categoryIndex: number, categoryName: string) => void,
    ) {
        super("Game Mode");
        this.onStartGame = onStartGame;
        this.menuEntries = [
            { text: "", selected: () => this.switchCategory() },
            { text: "Time Attack", selected: () => this.startGame(GameMode.TimeAttack) },
            { text: "Challenge", selected: () => this.startGame(GameMode.Challenge) },
            { text: "Free Play", selected: () => this.startGame(GameMode.FreePlay) },
            { text: "Back", selected: () => this.onBackRequest() },
        ];
        this.refreshCategoryEntry();
    }

    /** Port of the constructor: category and selected entry come from the
     * UserConfig, and the selected game mode is written back on launch. */
    protected override onBound(): void {
        const config = this.manager?.context.userConfig;
        if (config === undefined) {
            return;
        }
        this.categoryIndex = config.category;
        this.selectedEntry = Math.min(Math.max(config.lastGameModeIndex, 1), 3);
        this.refreshCategoryEntry();
    }

    private refreshCategoryEntry(): void {
        const categories = this.manager?.context.getCategories() ?? [];
        if (categories.length === 0) {
            return;
        }
        // Port of UpdateMenuEntries: the index wraps modulo the count.
        this.categoryIndex = (this.categoryIndex + categories.length) % categories.length;
        const entry = this.menuEntries[0];
        if (entry !== undefined) {
            entry.text = `Category: ${categories[this.categoryIndex] ?? ""}`;
        }
        // Port of UpdateMenuEntries: MainUserConfig.Category is written back.
        const config = this.manager?.context.userConfig;
        if (config !== undefined) {
            config.category = this.categoryIndex;
        }
    }

    private switchCategory(): void {
        this.categoryIndex++;
        this.refreshCategoryEntry();
    }

    private startGame(gameMode: GameModeValue): void {
        if (gameMode === GameMode.TimeAttack || gameMode === GameMode.Challenge) {
            const categories = this.manager?.context.getCategories() ?? [];
            const categoryName = categories[this.categoryIndex] ?? "";
            const mode: "TimeAttack" | "Challenge" = gameMode === GameMode.Challenge ? "Challenge" : "TimeAttack";
            this.onStartGame?.(mode, this.categoryIndex, categoryName);
            return;
        }
        this.manager?.context.showToast(`${GAME_MODE_NAMES[gameMode]} is not ported yet.`);
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        if (otherScreenHasFocus) {
            this.firstTimeStarted = true;
        } else if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([0, 0.2, 0.4, 1], [0, 0.1, 0.3, 1]);
        }
    }

    public override draw(ctx: ScreenContext): void {
        super.draw(ctx);

        const font = this.getFont();
        if (font === undefined) {
            return;
        }

        // Unlockable icons info (RotationGameModeScreen.Draw).
        const categories = this.manager?.context.getCategories() ?? [];
        const category = categories[this.categoryIndex] ?? "";
        const numIcons = this.cachedNumIcons(category);
        const unlocked = this.manager?.context.getNumIconsUnlocked(this.categoryIndex) ?? 0;
        const numUnlockableIcons = Math.max(0, numIcons - unlocked);
        if (numUnlockableIcons > 0) {
            const fadeValue = 1 - this.transitionPosition;
            font.addText(
                `Unlockable Icons: ${numUnlockableIcons}`,
                new Vec3(0, -0.35 * 120, -1 * 120),
                0.9,
                new Vec4(1, 1, 1, fadeValue),
                new Vec4(0, 0, 0, fadeValue),
            );
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(fadeValue < 1);
        }
    }
}

/** Port of OptionsMenuScreen. */
export class OptionsMenuScreen extends MenuScreen {
    public override readonly kind = "options" as const;
    private firstTimeStarted = true;
    private invertYAxis = false;

    public constructor() {
        super("Options");
        const sfx: MenuEntryDef = {
            text: "SFX Volume",
            selected: () => this.toggleSlider(sfx),
            slider: { value: 0.45, enabled: true },
        };
        const music: MenuEntryDef = {
            text: "Music Volume",
            selected: () => this.toggleSlider(music),
            slider: { value: 0.4, enabled: true },
        };
        const brightness: MenuEntryDef = {
            text: "Brightness",
            selected: () => this.toggleSlider(brightness),
            slider: { value: 0.5, enabled: true },
        };
        const invert: MenuEntryDef = {
            text: "Invert Y-Axis: no",
            selected: () => {
                this.invertYAxis = !this.invertYAxis;
                invert.text = `Invert Y-Axis: ${this.invertYAxis ? "yes" : "no"}`;
            },
        };
        const reset: MenuEntryDef = {
            text: "Reset Settings",
            selected: () => {
                // Port of ResetSettings: restore the UserConfig defaults.
                for (const e of [sfx, music, brightness]) {
                    if (e.slider !== undefined) {
                        e.slider.value = 0.5;
                        e.slider.enabled = true;
                    }
                }
                this.invertYAxis = false;
                invert.text = "Invert Y-Axis: no";
            },
        };
        const back: MenuEntryDef = {
            text: "Back",
            // Port of OnCancelOptions: UpdateSettings().SaveToFile().
            selected: () => {
                this.applySettings(sfx, music, brightness);
                this.onBackRequest();
            },
        };
        this.menuEntries = [sfx, music, brightness, invert, reset, back];
        this.sfxEntry = sfx;
        this.musicEntry = music;
        this.brightnessEntry = brightness;
        this.invertEntry = invert;
    }

    private readonly sfxEntry: MenuEntryDef;
    private readonly musicEntry: MenuEntryDef;
    private readonly brightnessEntry: MenuEntryDef;
    private readonly invertEntry: MenuEntryDef;

    /** Port of LoadContent: read the current settings from UserConfig. */
    protected override onBound(): void {
        const config = this.manager?.context.userConfig;
        if (config === undefined) {
            return;
        }
        this.invertYAxis = config.invertYAxis;
        if (this.sfxEntry.slider !== undefined) {
            this.sfxEntry.slider.value = config.sfxVolume;
            this.sfxEntry.slider.enabled = config.sfxVolume > 0;
        }
        if (this.musicEntry.slider !== undefined) {
            this.musicEntry.slider.value = config.musicVolume;
            this.musicEntry.slider.enabled = config.musicVolume > 0;
        }
        if (this.brightnessEntry.slider !== undefined) {
            this.brightnessEntry.slider.value = config.brightness;
            this.brightnessEntry.slider.enabled = config.brightness !== 0.5;
        }
        this.invertEntry.text = `Invert Y-Axis: ${this.invertYAxis ? "yes" : "no"}`;
    }

    /** Port of OptionsMenuScreen.UpdateSettings + SaveToFile. */
    private applySettings(
        sfx: MenuEntryDef,
        music: MenuEntryDef,
        brightness: MenuEntryDef,
    ): void {
        const config = this.manager?.context.userConfig;
        if (config === undefined) {
            return;
        }
        config.invertYAxis = this.invertYAxis;
        config.sfxVolume = sfx.slider?.enabled ? (sfx.slider?.value ?? 0) : 0;
        config.musicVolume = music.slider?.enabled ? (music.slider?.value ?? 0) : 0;
        config.brightness = brightness.slider?.enabled ? (brightness.slider?.value ?? 0) : 0.5;
        config.save();
        // Apply the new volumes live (the original's audio events do this).
        this.manager?.context.applyAudioVolumes();
    }

    private toggleSlider(entry: MenuEntryDef): void {
        if (entry.slider !== undefined) {
            entry.slider.enabled = !entry.slider.enabled;
        }
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);

        // Slider adjustment with left/right (OptionsMenuScreen.HandleInput).
        const entry = this.menuEntries[this.selectedEntry];
        if (entry?.slider !== undefined) {
            if (this.heldKeys.left) {
                entry.slider.value = Math.max(0, entry.slider.value - dt);
                // Port of SliderMenuEntry.DecValue: adjusting enables the slider.
                entry.slider.enabled = true;
            }
            if (this.heldKeys.right) {
                entry.slider.value = Math.min(1, entry.slider.value + dt);
                // Port of SliderMenuEntry.IncValue.
                entry.slider.enabled = true;
            }
        }

        // Port of OnCancel: save settings when the screen exits (the original
        // saves in OnCancelOptions and the OnCancel override, covering both
        // the Back entry and the cancel button).
        if (this.screenState === "transitionOff" && !this.settingsSaved) {
            this.settingsSaved = true;
            this.applySettingsWithEntries();
        }

        if (otherScreenHasFocus) {
            this.firstTimeStarted = true;
        } else if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([0.6, 0.6, 0, 1], [0.3, 0.5, 0, 1]);
        }
    }

    private settingsSaved = false;

    private applySettingsWithEntries(): void {
        const [sfx, music, brightness] = this.menuEntries;
        if (sfx !== undefined && music !== undefined && brightness !== undefined) {
            this.applySettings(sfx, music, brightness);
        }
    }
}

/** Port of CreditsScreen. */
export class CreditsScreen extends GameScreen {
    public readonly kind = "credits" as const;
    private firstTimeStarted = true;
    private gameTimeIndex = 0;

    private readonly credits: {
        text: string;
        timeOffset: number;
        pos: Vec3;
        size: number;
        color: Vec4;
    }[] = [];

    public constructor() {
        super();
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;

        const textDepth = -1;
        const mainTitlePos = new Vec3(-2.5, 0, textDepth);
        const titlePos = new Vec3(-1.9, 0, textDepth);
        const namePos = new Vec3(-1.4, 0, textDepth);
        const musicTrackPos = new Vec3(-1.2, 0, textDepth);

        const timeOffsetTitle = 1.5;
        const timeOffsetName = 0.3;
        const timeOffsetMusicTrack = 0.25;

        const titleSize = 1;
        const nameSize = 1;
        const musicTrackSize = 0.8;

        const titleColor = new Vec4(0.5, 0.5, 0.5, 1);
        const nameColor = new Vec4(0.8, 0.6, 0.2, 1);
        const musicTrackColor = new Vec4(0.6, 0.4, 0.1, 1);

        const entry = (text: string, timeOffset: number, pos: Vec3, size: number, color: Vec4): void => {
            this.credits.push({ text, timeOffset, pos, size, color });
        };

        entry(GAME_NAME, 3, mainTitlePos, 2, new Vec4(1, 0.8, 0.4, 1));
        entry("Programmer", timeOffsetTitle + 0.5, titlePos, titleSize, titleColor);
        entry("Richard Schubert", timeOffsetName, namePos, nameSize, nameColor);
        entry("Creative Influences", timeOffsetTitle, titlePos, titleSize, titleColor);
        entry("Ulrike Rauer", timeOffsetName, namePos, nameSize, nameColor);
        entry("Stephan Ziep", timeOffsetName, namePos, nameSize, nameColor);
        entry("Paul Arnst", timeOffsetName, namePos, nameSize, nameColor);
        entry("Johannes Kristmann", timeOffsetName, namePos, nameSize, nameColor);
        entry("Nico Franze", timeOffsetName, namePos, nameSize, nameColor);
        entry("Icons", timeOffsetTitle, titlePos, titleSize, titleColor);
        entry("???famfamfam???", timeOffsetName, namePos, nameSize, nameColor);
        entry("Visual Studio 2008 Icon Packkkkkkk", timeOffsetName, namePos, nameSize, nameColor);
        entry("Music", timeOffsetTitle, titlePos, titleSize, titleColor);
        entry("KeeX", timeOffsetName, namePos, nameSize, nameColor);
        entry("PaL iNc. B0nd", timeOffsetMusicTrack, musicTrackPos, musicTrackSize, musicTrackColor);
        entry("longway", timeOffsetName, namePos, nameSize, nameColor);
        entry("Drunken Logic Bass_remix", timeOffsetMusicTrack, musicTrackPos, musicTrackSize, musicTrackColor);
        entry("shagrugge", timeOffsetName, namePos, nameSize, nameColor);
        entry("Hooked on Bossaphonics (metamorphosis mix)", timeOffsetMusicTrack, musicTrackPos, musicTrackSize, musicTrackColor);
        entry("Sax, Flute, n Glass", timeOffsetMusicTrack, musicTrackPos, musicTrackSize, musicTrackColor);
        entry("Andrew Meredith", timeOffsetName, namePos, nameSize, nameColor);
        entry("I Don't Know What It's Called", timeOffsetMusicTrack, musicTrackPos, musicTrackSize, musicTrackColor);
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        this.gameTimeIndex += dt;
        if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([0, 0, 0, 1], [0, 0, 0, 1]);
            // Port of CreditsScreen.LoadContent: track 5.
            this.manager?.context.setMusicPlaylist([5]);
        }
    }

    public override draw(_ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }

        const theta = (1 - this.transitionPosition) * (Math.PI - Math.PI * 0.25);
        const phi = -0.5;
        SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());

        const fontEmissiveColor = new Vec4(0, 0, 0, 1 - this.transitionPosition);
        const zDepth = 30;

        let timeIndex = 0;
        const timeDistance = 4;
        const timeDistanceInv = 1 / timeDistance;
        for (const ce of this.credits) {
            timeIndex += ce.timeOffset;
            if (timeIndex < this.gameTimeIndex - timeDistance || timeIndex > this.gameTimeIndex + 3.5) {
                continue;
            }
            const progress = this.gameTimeIndex - timeIndex;
            const progressSign = Math.sign(progress);
            const progressNormalized = Math.abs(progress) * timeDistanceInv;
            const side = 2.5 - Math.pow(progressNormalized, 0.2) * progressSign * 3;

            const fontColor = new Vec4(ce.color.x, ce.color.y, ce.color.z, ce.color.w - this.transitionPosition);
            font.addText(
                ce.text,
                new Vec3((ce.pos.x + side) * zDepth, (ce.pos.y + progress) * zDepth, ce.pos.z * zDepth),
                ce.size,
                fontColor,
                fontEmissiveColor,
            );
        }

        setupFontCameraPerspective(font, new Vec3(0, -0.7, 1));
        font.flush(true);
    }
}

/** Port of HighscoreScreen. */
export class HighscoreScreen extends GameScreen {
    public readonly kind = "highscore" as const;
    private firstTimeStarted = true;
    private gameMode: GameModeValue = GameMode.TimeAttack;
    private categoryIndex = 0;
    private isToggable = true;
    private entries: { place: number; score: number; gamerTag: string }[] = [];
    private lastEntryIndex = -1;

    private static readonly NUM_GAME_MODES = 2; // excludes FreePlay

    private static readonly ENTRIES = [
        { place: 1, score: 1000000, gamerTag: "Rotkaeppchen" },
        { place: 2, score: 800000, gamerTag: "Rike" },
        { place: 3, score: 500000, gamerTag: "Kuchen" },
        { place: 4, score: 300000, gamerTag: "Dude" },
        { place: 5, score: 150000, gamerTag: "pal" },
        { place: 6, score: 80000, gamerTag: "Cookie" },
        { place: 7, score: 40000, gamerTag: "superquadric" },
        { place: 8, score: 20000, gamerTag: "guy" },
        { place: 9, score: 10000, gamerTag: "cube" },
        { place: 10, score: 5000, gamerTag: "polygon" },
    ];

    public constructor(isInGame = false) {
        super();
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;
        this.isInGame = isInGame;
        this.entries = HighscoreScreen.ENTRIES.map((entry) => ({ ...entry }));
    }

    private isInGame: boolean;

    /** Port of HighscoreScreen.HandleInput exit: in-game returns to the main
     * menu (LoadingScreen.Load with BackgroundScreen + MainMenuScreen);
     * otherwise it just exits back to the caller. */
    public handleExit(): void {
        if (this.isInGame) {
            const manager = this.manager;
            if (manager === undefined) {
                return;
            }
            for (const screen of manager.getScreens()) {
                screen.exitScreen();
            }
            manager.addScreen(new MainMenuScreen(
                () => manager.addScreen(new RotationGameModeScreen()),
                () => manager.addScreen(new MessageBoxScreen(
                    `Are you sure you want to exit ${GAME_NAME}?`,
                )),
            ));
        } else {
            this.exitScreen();
        }
    }

    /** Port of HighscoreScreen.AddNewEntry: inserts and ranks the new score. */
    public addNewEntry(score: number, gamerTag: string): void {
        this.entries.push({ place: -1, score, gamerTag });
        this.entries.sort((a, b) => b.score - a.score);
        this.entries = this.entries.slice(0, 10);
        this.entries.forEach((entry, index) => {
            entry.place = index + 1;
        });
        this.lastEntryIndex = this.entries.findIndex((entry) => entry.score === score && entry.gamerTag === gamerTag);
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([0.2, 0.2, 0.2, 1], [0, 0.05, 0.1, 1]);
            // Port of the HighscoreScreen music (track 1).
            this.manager?.context.setMusicPlaylist([1]);
        }
    }

    public handleToggle(action: "up" | "down" | "left" | "right"): void {
        if (!this.isToggable) {
            return;
        }
        const categories = this.manager?.context.getCategories() ?? [];
        const numCategories = categories.length;
        if (action === "left") {
            this.categoryIndex = (this.categoryIndex + numCategories - 1) % numCategories;
        } else if (action === "right") {
            this.categoryIndex = (this.categoryIndex + 1) % numCategories;
        } else if (action === "up") {
            this.gameMode = ((this.gameMode + HighscoreScreen.NUM_GAME_MODES - 1) % HighscoreScreen.NUM_GAME_MODES) as GameModeValue;
        } else if (action === "down") {
            this.gameMode = ((this.gameMode + 1) % HighscoreScreen.NUM_GAME_MODES) as GameModeValue;
        }
    }

    public override draw(ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }

        const theta = (1 - this.transitionPosition) * (Math.PI - Math.PI * 0.25);
        const phi = -0.5;
        SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());

        const fontEmissiveColor = new Vec4(0, 0, 0, 1 - this.transitionPosition);

        // Title.
        {
            const fontColor = new Vec4(1, 0.8, 0.4, 1 - this.transitionPosition);
            const viewPosition = new Vec3(0, 0, 1);
            const zDepth = 30 - this.transitionPosition * 45;
            const zDepthScale = 30 / zDepth;
            font.addText(
                "Highscore",
                new Vec3(-0.7 * zDepthScale, 0.5 * zDepthScale, -1).multiplyScalar(zDepth),
                1,
                fontColor,
                fontEmissiveColor,
            );
            setupFontCameraPerspective(font, viewPosition);
            font.flush(true);
        }

        // Scores.
        {
            const fontColor = new Vec4(1, 1, 1, 1 - this.transitionPosition);
            const viewPosition = new Vec3(0, 0, 1);
            const zDepth = 80 - this.transitionPosition * 120;

            for (let n = 0; n < this.entries.length; n++) {
                const e = this.entries[n];
                if (e === undefined) {
                    continue;
                }
                const placeStr = String(e.place);
                const scoreStr = String(e.score);
                const zDepthScale = 60 / zDepth;
                const fontWidthScale = 0.015 * zDepthScale;
                const fontHeightScale = 0.14 * zDepthScale;
                const placeWidth = font.getTextWidth(placeStr) * fontWidthScale;
                const scoreWidth = font.getTextWidth(scoreStr) * fontWidthScale;

                // The new entry pulses (HighscoreScreen.Draw).
                let entryColor = fontColor;
                if (this.lastEntryIndex === n) {
                    const pulse = Math.sin(ctx.gameTime * 4) * 0.5 + 0.5;
                    entryColor = Vec4.lerp(new Vec4(1, 0.8, 0.4, fontColor.w), fontColor, pulse);
                }

                font.addText(
                    placeStr,
                    new Vec3(-0.85 * zDepthScale - placeWidth, 0.3 - fontHeightScale * n, -1).multiplyScalar(zDepth),
                    1,
                    entryColor,
                    fontEmissiveColor,
                );
                font.addText(
                    scoreStr,
                    new Vec3(-0.25 * zDepthScale - scoreWidth, 0.3 - fontHeightScale * n, -1).multiplyScalar(zDepth),
                    1,
                    entryColor,
                    fontEmissiveColor,
                );
                font.addText(
                    ` - ${e.gamerTag}`,
                    new Vec3(-0.146, 0.3 - fontHeightScale * n, -1).multiplyScalar(zDepth),
                    1,
                    entryColor,
                    fontEmissiveColor,
                );
            }
            setupFontCameraPerspective(font, viewPosition);
            font.flush(true);
        }

        // Game mode / category label.
        {
            const fadeValue = 1 - this.transitionPosition;
            const fontColor = new Vec4(1, 1, 1, fadeValue);
            const emissive = new Vec4(0, 0, 0, fadeValue);
            const categories = this.manager?.context.getCategories() ?? [];
            const category = categories[this.categoryIndex] ?? "";
            const zDepth = 60;
            font.addText(GAME_MODE_NAMES[this.gameMode] ?? "", new Vec3(-0.35, -1.2, -1).multiplyScalar(zDepth), 0.9, fontColor, emissive);
            font.addText(category, new Vec3(-0.35, -1.3, -1).multiplyScalar(zDepth), 0.9, fontColor, emissive);
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(fadeValue < 1);
        }
    }
}

/** Port of GalleryScreen (icon grid simplified to category summary). */
export class GalleryScreen extends GameScreen {
    public readonly kind = "gallery" as const;
    private firstTimeStarted = true;
    private categoryIndex = 0;
    private selectedImageIndex = 0;

    // Port of numFilesOnScreenX/Y: the grid is 17 columns x 7 rows.
    private static readonly NUM_FILES_ON_SCREEN_X = 17;
    private static readonly NUM_FILES_ON_SCREEN_Y = 7;

    private floatingRowIndex = 0;
    private firstRowIndex = 0;
    private iconName = "";
    private images: IconImage[] = [];
    private readonly spinner = new LoadingSpinner();

    public constructor() {
        super();
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        if (this.firstTimeStarted) {
            this.firstTimeStarted = false;
            this.manager?.context.startBackgroundAnimation([0.2, 0.6, 0.8, 1], [0.1, 0.3, 0.7, 1]);
            // Port of GalleryScreen.LoadContent: track 5.
            this.manager?.context.setMusicPlaylist([5]);
            void this.loadCategory();
        }
    }

    private async loadCategory(): Promise<void> {
        const categories = this.manager?.context.getCategories() ?? [];
        const category = categories[this.categoryIndex] ?? "";
        this.images = await this.manager?.context.loadAllIcons(category) ?? [];
    }

    /** Port of the category-switch input (PageUp/PageDown). */
    public handleCategory(delta: number): void {
        const categories = this.manager?.context.getCategories() ?? [];
        if (categories.length === 0) {
            return;
        }
        this.categoryIndex = (this.categoryIndex + categories.length + delta) % categories.length;
        this.selectedImageIndex = 0;
        // Drop the old icons immediately so the loading spinner shows.
        this.images = [];
        this.floatingRowIndex = 0;
        this.firstRowIndex = 0;
        void this.loadCategory();
    }

    /** Port of the image-selection input (arrows move within the grid). */
    public handleSelect(deltaX: number, deltaY: number): void {
        const categories = this.manager?.context.getCategories() ?? [];
        const category = categories[this.categoryIndex] ?? "";
        // The loaded image count is authoritative (0 until the category loads).
        const numIcons = Math.min(this.images.length, this.cachedNumIcons(category)) || this.images.length;
        if (numIcons <= 0) {
            return;
        }
        const numUnlockedIcons = this.manager?.context.getNumIconsUnlocked(this.categoryIndex) ?? 0;

        this.selectedImageIndex += deltaX * GalleryScreen.NUM_FILES_ON_SCREEN_Y + deltaY;
        this.selectedImageIndex = (this.selectedImageIndex + numIcons) % numIcons;

        if (this.selectedImageIndex >= numUnlockedIcons) {
            if (deltaX > 0) {
                this.selectedImageIndex -= GalleryScreen.NUM_FILES_ON_SCREEN_Y - 1;
            } else if (deltaX < 0 || deltaY < 0) {
                this.selectedImageIndex = numUnlockedIcons - 1;
            }
            if (this.selectedImageIndex >= numUnlockedIcons) {
                this.selectedImageIndex = 0;
            }
        }
    }

    public getSelectedIconName(): string {
        return this.iconName;
    }

    public override draw(ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }
        const categories = this.manager?.context.getCategories() ?? [];
        const category = categories[this.categoryIndex] ?? "";
        // The loaded image count is authoritative (0 until the category loads).
        const numIcons = Math.min(this.images.length, this.cachedNumIcons(category)) || this.images.length;
        const numUnlockedIcons = this.manager?.context.getNumIconsUnlocked(this.categoryIndex) ?? 0;

        // Port of GalleryScreen.Draw: rotate the light while transitioning.
        {
            const theta = (1 - this.transitionPosition) * (Math.PI - Math.PI * 0.25);
            const phi = -0.5;
            SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
        }

        // Title (perspective projection with zDepth fade).
        const fontEmissive = new Vec4(0, 0, 0, 1 - this.transitionPosition);
        {
            const zDepth = 30 - this.transitionPosition * 45;
            const zDepthScale = 30 / zDepth;
            font.addText(
                "Gallery",
                new Vec3(-0.7 * zDepthScale, 0.5 * zDepthScale, -1).multiplyScalar(zDepth),
                1,
                new Vec4(1, 0.8, 0.4, 1 - this.transitionPosition),
                fontEmissive,
            );
            setupFontCameraPerspective(font, new Vec3(0, 0, 1));
            font.flush(true);
        }

        // Grid of icons (drawn on the 2D overlay in backbuffer coordinates).
        ctx.clearGallery();
        const alpha = 1 - this.transitionPosition;

        // While the icons load, animate a superquadric ring as a loading
        // indicator.
        if (this.images.length === 0) {
            this.spinner.update(ctx.gameTime);
            ctx.renderScene(this.spinner.scene, this.spinner.camera, 0.2, 0.9);
            const loadFontColor = new Vec4(1, 1, 1, alpha);
            // Centered inside the orbiting ring.
            font.addText(
                "Loading...",
                new Vec3(-1.1, -1.5, -1).multiplyScalar(30),
                1,
                loadFontColor,
                new Vec4(0, 0, 0, alpha),
            );
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(true);
            return;
        }

        if (alpha > 0.001) {
            // Smooth scroll: keep the selected row visible, scrolling only
            // when it leaves the window (the grid shows 7 rows). The grid is
            // column-major (x = n / 7, y = n % 7), so scrolling by a row means
            // offsetting the row index inside each column - skipping items
            // contiguously would hide whole columns.
            const targetRowIndex = this.selectedImageIndex % GalleryScreen.NUM_FILES_ON_SCREEN_Y;
            const numColumns = Math.ceil(numIcons / GalleryScreen.NUM_FILES_ON_SCREEN_Y);
            const maxFirstRow = Math.max(0, GalleryScreen.NUM_FILES_ON_SCREEN_Y - Math.min(GalleryScreen.NUM_FILES_ON_SCREEN_Y, numIcons - (numColumns - 1) * GalleryScreen.NUM_FILES_ON_SCREEN_Y));
            const targetFirstRow = Math.max(0, Math.min(maxFirstRow, targetRowIndex));
            this.floatingRowIndex += (targetFirstRow - this.floatingRowIndex) * Math.min(1, ctx.dt * 5);
            this.firstRowIndex = Math.round(this.floatingRowIndex);

            const names = this.manager?.context.getIconNames(category) ?? [];
            this.iconName = names[this.selectedImageIndex] ?? "";

            // Iterate the visible window column by column, offsetting the row
            // index within each column by firstRowIndex.
            const numVisibleColumns = Math.min(
                GalleryScreen.NUM_FILES_ON_SCREEN_X,
                numColumns - 0,
            );
            for (let col = 0; col < numVisibleColumns; col++) {
                const columnStart = col * GalleryScreen.NUM_FILES_ON_SCREEN_Y;
                const columnSize = Math.min(
                    GalleryScreen.NUM_FILES_ON_SCREEN_Y,
                    numIcons - columnStart,
                );
                for (let row = this.firstRowIndex; row < columnSize; row++) {
                    const n = columnStart + row;
                    if (n >= numIcons || n < 0) {
                        continue;
                    }
                    const image = this.images[n];
                    if (image === undefined) {
                        continue;
                    }
                    const isSelected = this.selectedImageIndex === n;
                    const isLocked = n >= numUnlockedIcons;

                    // Grid position: the row is drawn relative to the scroll
                    // offset so items slide up as the window moves.
                    const drawRow = row - this.firstRowIndex;

                    let a = alpha;
                    let height = 64;
                    let offsetX = col * 80 + 230;
                    let offsetY = drawRow * 80 + 270;

                    if (isSelected) {
                        const pulseValue = Math.sin(ctx.gameTime * 3) * 5;
                        offsetX -= pulseValue;
                        offsetY -= pulseValue;
                        height += pulseValue * 2;
                    }

                    if (isLocked) {
                        ctx.drawLockedIcon(offsetX, offsetY, height, a);
                    } else {
                        ctx.drawGalleryIcon(image, offsetX, offsetY, height, a);
                    }
                }
            }
        }

        // Selected icon name (ortho, like the icon-name text in the original).
        const fadeValue = 1 - this.transitionPosition;
        if (this.iconName !== "") {
            font.addText(
                this.iconName,
                new Vec3(-1.2, -0.75, -1).multiplyScalar(60),
                0.9,
                new Vec4(1, 1, 1, fadeValue),
                new Vec4(0, 0, 0, fadeValue),
            );
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(true);
        }

        // Category name (footer, rotated-up ortho camera like the original).
        {
            const zDepth = 60;
            font.addText(
                category,
                new Vec3(-0.35, -1.3, -1).multiplyScalar(zDepth),
                0.9,
                new Vec4(1, 1, 1, fadeValue),
                new Vec4(0, 0, 0, fadeValue),
            );
            const viewPosition = new Vec3(0, 0, 1);
            const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), new Vec3(1, 0, 0));
            const projMatrix = Mat4.createOrthographicOffCenter(-100, 100, -56.25, 56.25, 1, 550);
            font.applyCamera(viewPosition, viewMatrix, projMatrix);
            font.flush(fadeValue < 1);
        }
    }
}

/** Port of HelpScreen. */
export class HelpScreen extends GameScreen {
    public readonly kind = "help" as const;

    public constructor() {
        super();
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;
    }

    public override draw(_ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }
        const fontEmissiveColor = new Vec4(0, 0, 0, 1 - this.transitionPosition);

        // Title.
        {
            const fontColor = new Vec4(1, 0.8, 0.4, 1 - this.transitionPosition);
            const viewPosition = new Vec3(0, 0, 1);
            const zDepth = 30;
            const zDepthScale = 30 / zDepth;
            font.addText(
                "How to play",
                new Vec3(-0.8 * zDepthScale - this.transitionPosition * 2, 0.3 * zDepthScale, -1).multiplyScalar(zDepth),
                1,
                fontColor,
                fontEmissiveColor,
            );
            setupFontCameraPerspective(font, viewPosition);
            font.flush(true);
        }

        // How to play text.
        {
            const fontColor = new Vec4(1, 1, 1, 1 - this.transitionPosition);
            const zDepth = 80;
            font.addText(
                "Rotate the image until it matches the icon\n" +
                "shown in the top left corner of the screen.\n\n" +
                "Upside down images don't count.",
                new Vec3(-1.2 - this.transitionPosition * 2, 0, -1).multiplyScalar(zDepth),
                1,
                fontColor,
                fontEmissiveColor,
            );
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(true);
        }
    }
}

/** Port of MessageBoxScreen. */
export class MessageBoxScreen extends GameScreen {
    public readonly kind = "messageBox" as const;
    public override isPopup = true;
    private readonly message: string;
    private onAccepted: (() => void) | undefined;

    public constructor(message: string, onAccepted?: () => void) {
        super();
        this.message = message;
        this.onAccepted = onAccepted;
        this.transitionOnTime = 0.2;
        this.transitionOffTime = 0.2;
    }

    public accept(): void {
        this.onAccepted?.();
        this.exitScreen();
    }

    public override draw(_ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }
        const fadeValue = 1 - this.transitionPosition;

        // Port of MessageBoxScreen.Draw: animate light dir for specular.
        {
            const fadeValueLight = Math.max(fadeValue * 2 - 1, 0);
            const theta = (1 - fadeValueLight) * (Math.PI * 2 - Math.PI * 0.5);
            const phi = fadeValueLight * 3;
            SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
        }

        const fontColor = new Vec4(1, 1, 1, 1);
        const acceptColor = new Vec4(0, 0.5, 0, 1);
        const cancelColor = new Vec4(0.5, 0, 0, 1);

        const zDepth = 60;
        const yPos = -1.6 + Math.pow(fadeValue, 0.2);
        font.addText(
            this.message,
            new Vec3(-1.25, yPos, -1).multiplyScalar(zDepth),
            0.8,
            fontColor,
        );
        font.addText(
            "Yes",
            new Vec3(-1.13, yPos - 0.12, -1).multiplyScalar(zDepth),
            0.8,
            acceptColor,
        );
        font.addText(
            "No",
            new Vec3(-0.3, yPos - 0.12, -1).multiplyScalar(zDepth),
            0.8,
            cancelColor,
        );
        setupFontCamera(font, new Vec3(0, 0, 1));
        font.flush(true);
    }
}

/** Port of RotationGameStatisticsScreen. */
export class RotationGameStatisticsScreen extends GameScreen {
    public readonly kind = "messageBox" as const;
    private readonly gameModeName: string;
    private readonly categoryIndex: number;
    private readonly stats: {
        score: number;
        numberOfPuzzlesSolved: number;
        numberOfIconsUnlocked: number;
        numberOfIconsUnlockable: number;
        averagePuzzleSolvingSpeed: number;
        timeSpendInThisGame: number;
    };

    public constructor(
        gameModeName: string,
        categoryIndex: number,
        stats: {
            score: number;
            numberOfPuzzlesSolved: number;
            numberOfIconsUnlocked: number;
            numberOfIconsUnlockable: number;
            averagePuzzleSolvingSpeed: number;
            timeSpendInThisGame: number;
        },
    ) {
        super();
        this.gameModeName = gameModeName;
        this.categoryIndex = categoryIndex;
        this.stats = stats;
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0.5;
    }

    public override draw(_ctx: ScreenContext): void {
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }

        const theta = (1 - this.transitionPosition) * (Math.PI - Math.PI * 0.25);
        const phi = -0.5;
        SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());

        const fontEmissiveColor = new Vec4(0, 0, 0, 1 - this.transitionPosition);

        // Title.
        {
            const fontColor = new Vec4(1, 0.8, 0.4, 1 - this.transitionPosition);
            const viewPosition = new Vec3(0, 0, 1);
            const zDepth = 30 - this.transitionPosition * 45;
            const zDepthScale = 30 / zDepth;
            font.addText(
                "Your Performance",
                new Vec3(-1.2 * zDepthScale, 0.5 * zDepthScale, -1).multiplyScalar(zDepth),
                1,
                fontColor,
                fontEmissiveColor,
            );
            setupFontCameraPerspective(font, viewPosition);
            font.flush(true);
        }

        // Statistics.
        {
            const fontColor = new Vec4(1, 1, 1, 1 - this.transitionPosition);
            const viewPosition = new Vec3(0, 0, 1);
            const zDepth = 70 - this.transitionPosition * 120;

            const showIU = this.stats.numberOfIconsUnlockable > 0;
            const datumName = [
                "Score",
                "Puzzles Solved",
                showIU ? "Icons Unlocked" : "",
                "Average Puzzle Time",
                "Game Duration",
            ];
            const datumEntry = [
                String(this.stats.score),
                String(this.stats.numberOfPuzzlesSolved),
                `${this.stats.numberOfIconsUnlocked}/${this.stats.numberOfIconsUnlockable}`,
                this.stats.averagePuzzleSolvingSpeed.toFixed(2).padStart(5, "0"),
                this.stats.timeSpendInThisGame.toFixed(2).padStart(5, "0"),
            ];

            for (let n = 0; n < datumName.length; n++) {
                const name = datumName[n];
                const entry = datumEntry[n];
                if (name === undefined || name === "" || entry === undefined) {
                    continue;
                }
                const zDepthScale = 60 / zDepth;
                const fontWidthScale = 0.015 * zDepthScale;
                const fontHeightScale = 0.18 * zDepthScale;
                const datumNameWidth = font.getTextWidth(name) * fontWidthScale;
                font.addText(
                    name,
                    new Vec3(0.05 * zDepthScale - datumNameWidth, 0.3 - fontHeightScale * n, -1).multiplyScalar(zDepth),
                    1,
                    fontColor,
                    fontEmissiveColor,
                );
                font.addText(
                    ` : ${entry}`,
                    new Vec3(0.2, 0.3 - fontHeightScale * n, -1).multiplyScalar(zDepth),
                    1,
                    fontColor,
                    fontEmissiveColor,
                );
            }
            setupFontCameraPerspective(font, viewPosition);
            font.flush(true);
        }

        // Game mode / category label.
        {
            const fadeValue = 1 - this.transitionPosition;
            const fontColor = new Vec4(1, 1, 1, fadeValue);
            const emissive = new Vec4(0, 0, 0, fadeValue);
            const categories = this.manager?.context.getCategories() ?? [];
            const category = categories[this.categoryIndex] ?? "";
            const zDepth = 60;
            font.addText(this.gameModeName, new Vec3(-0.35, -1.2, -1).multiplyScalar(zDepth), 0.9, fontColor, emissive);
            font.addText(category, new Vec3(-0.35, -1.3, -1).multiplyScalar(zDepth), 0.9, fontColor, emissive);
            setupFontCamera(font, new Vec3(0, 0, 1));
            font.flush(fadeValue < 1);
        }
    }
}