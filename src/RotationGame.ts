/**
 * RotationGame - port of SQR.RotationGame.cs (Time Attack mode).
 *
 * The player rotates a 3D icon built from superquadrics until it faces the
 * camera. Solving puzzles scores points and adds time; the game ends when the
 * time runs out.
 */
import { Animation } from "./Animation.ts";
import { Curve, loadCurve } from "./Curve.ts";
import { IconMap } from "./IconMap.ts";
import { Countdown, Praising, ScoreBoard, TimeBoard } from "./Hud.ts";
import { SQFont } from "./SQFont.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

import { IconUnlockDisplay } from "./IconUnlockDisplay.ts";
import { NUM_UNLOCKED_ICONS_BY_DEFAULT } from "./UserConfig.ts";

export const GAME_DURATION = 30;
const FOV = 1.3;
const PUZZLE_SOLVED_COMPLETE_ANIMATION_TIME = 1.5;
const ERROR_ANGLE = 0.0025;

export interface IconImage {
    width: number;
    height: number;
    /** RGBA pixel data. */
    data: Uint8ClampedArray;
}

export type GameMode = "TimeAttack" | "Challenge";

export interface RotationGameHost {
    /** The superquadric font used for HUD text. */
    font: SQFont;
    /** Loads an icon image by category and index (browser texture loading). */
    loadIcon(category: string, index: number): Promise<IconImage>;
    getNumIcons(category: string): Promise<number>;
    /** Display name of an icon (for the unlock display). */
    getIconName(category: string, index: number): string;
    /** Number of icons unlocked in a category (persisted). */
    getNumIconsUnlocked(categoryIndex: number): number;
    /** Unlocks the next icon in a category (persisted). */
    unlockIcon(categoryIndex: number): void;
    /** Draws the unlocked icon flash into the HUD. */
    drawUnlockIcon(image: IconImage, alpha: number): void;
    /**
     * Draws the 2D icon preview into the HUD corner (128x128 rect at
     * (199,115) in the 1280x720 backbuffer, point-clamped sampling). During
     * the icon transition current and previous are drawn crossfaded.
     */
    drawIconPreview(current: IconImage, previous: IconImage | undefined, alphaCurrent: number, alphaPrevious: number): void;
    /**
     * Draws one 64x64 stack icon (Challenge mode) in backbuffer coordinates.
     */
    drawStackIcon(image: IconImage, x: number, y: number, size: number, alpha: number): void;
    /** Starts the game background color animation on the global clock. */
    startBackgroundAnimation(color: Vec4): void;
    /** Port of the game playlist: rotgame tracks 2,3,4,5. */
    setMusicPlaylist(trackIndices: number[]): void;
    /** Port of AudioManager.PlayCue. */
    playCue(cueName: string): void;
    /** The player's Invert Y-Axis setting (port of userConfig.InvertYAxis). */
    invertYAxis: boolean;
}

export interface GameStatistics {
    score: number;
    numberOfPuzzlesSolved: number;
    numberOfIconsUnlocked: number;
    numberOfIconsUnlockable: number;
    timeSpendInThisGame: number;
    averagePuzzleSolvingSpeed: number;
}

/** Deterministic RNG (the original used System.Random). */
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function isColorGreyish(color: Vec4): boolean {
    const redGreenDelta = color.x - color.y;
    const greenBlueDelta = color.y - color.z;
    return redGreenDelta * redGreenDelta < 0.1 && greenBlueDelta * greenBlueDelta < 0.1;
}

export class RotationGame {
    private readonly categoryName: string;
    private readonly categoryIndex: number;
    private readonly host: RotationGameHost;
    private readonly gameMode: GameMode;

    private camPitch = 0;
    private camYaw = 0;
    private camRadius = 20;
    private camPosition = new Vec3(0, 0, 20);
    private viewMatrix = Mat4.identity();

    private readonly im = new IconMap();
    private readonly scoreBoard: ScoreBoard;
    private readonly timeBoard: TimeBoard;
    private readonly praising: Praising;
    private readonly countdown: Countdown;
    private readonly iconUnlockDisplay: IconUnlockDisplay;

    private randomIconIndex: number[] = [];
    private currentIconIndex = 0;
    private numIcons = 0;

    private iconImage: IconImage | undefined;
    private prevIconImage: IconImage | undefined;
    private readonly iconImageCache = new Map<number, IconImage>();

    private readonly camFuzzingAnimation = new Animation(1);
    private camFuzzingPitch = 0;
    private camFuzzingYaw = 0;

    private puzzleSolved = false;
    private puzzleSolvedCompleteHenceDisableLogic = false;
    private puzzleSolvedCompleteTime = -20;
    private puzzleStartedTime = 0;
    private puzzleGameStartTime = -1;
    private puzzleSolvedCompletionDurationAccumulated = 0;

    private readonly timeUpCurve = loadCurve("bouncein");
    private readonly gameOverAnimation = new Animation(3);
    private gameOver = false;

    private readonly colorRandomizer = makeRandom(1234567);
    private readonly rnd = makeRandom(Date.now() & 0x7fffffff);

    private statistics: GameStatistics = {
        score: 0,
        numberOfPuzzlesSolved: 0,
        numberOfIconsUnlocked: 0,
        numberOfIconsUnlockable: 0,
        timeSpendInThisGame: -1,
        averagePuzzleSolvingSpeed: -1,
    };

    public constructor(host: RotationGameHost, gameMode: GameMode, categoryIndex: number, categoryName: string) {
        this.host = host;
        this.gameMode = gameMode;
        this.categoryName = categoryName;
        this.categoryIndex = categoryIndex;

        this.scoreBoard = new ScoreBoard(host.font);
        this.timeBoard = new TimeBoard(host.font);
        this.praising = new Praising(host.font);
        this.countdown = new Countdown(host.font, 3.5);
        this.iconUnlockDisplay = new IconUnlockDisplay(host.font, host);

        // Port of the RotationGame constructor playlist.
        host.setMusicPlaylist([2, 3, 4, 5]);

        // Port of camFuzzingRotationCurve (0,0 -> 0.2,0 -> 1,1 smooth).
        const camFuzzingRotationCurve = new Curve();
        camFuzzingRotationCurve.addKey(0, 0, 0, 0);
        camFuzzingRotationCurve.addKey(0.2, 0, 0, 0);
        camFuzzingRotationCurve.addKey(1, 1, 0, 0);
        this.camFuzzingAnimation.timeCurve = camFuzzingRotationCurve;

        void host.getNumIcons(categoryName).then((numIcons) => {
            this.numIcons = numIcons;
            this.createRandomIconList();
        });
    }

    public getScore(): number {
        return this.scoreBoard.getScore();
    }

    public getStatistics(): GameStatistics {
        return this.statistics;
    }

    public isGameOver(): boolean {
        return this.gameOver && !this.gameOverAnimation.isRunning;
    }

    public isGameOverAnimationRunning(): boolean {
        return this.gameOverAnimation.isRunning;
    }

    public getGameOverProgress(): number {
        return this.gameOverAnimation.progress;
    }

    private get timeIsStoppedInternally(): boolean {
        return this.countdown.TimeLeft > 0 || this.camFuzzingAnimation.isRunning;
    }

    /** Port of CreateRandomIconList: Challenge caps the list at 30 icons. */
    private createRandomIconList(): void {
        let numRandomIcons = this.numIcons;
        if (this.gameMode === "Challenge") {
            numRandomIcons = Math.min(numRandomIcons, 30);
        }
        const copy: number[] = [];
        for (let n = 0; n < numRandomIcons; n++) {
            copy.push(n);
        }
        this.randomIconIndex = [];
        for (let n = 0; n < numRandomIcons; n++) {
            const index = Math.floor(this.rnd() * copy.length);
            const picked = copy.splice(index, 1)[0];
            if (picked !== undefined) {
                this.randomIconIndex.push(picked);
            }
        }
    }

    /** Port of LoadNewIcon: prevIconTex = iconTex before loading the new one. */
    private async loadNewIcon(totalGameTime: number): Promise<void> {
        this.prevIconImage = this.iconImage;
        const index = this.randomIconIndex[this.currentIconIndex];
        if (index === undefined) {
            return;
        }
        this.iconImage = await this.host.loadIcon(this.categoryName, index);
        this.iconImageCache.set(index, this.iconImage);

        const mainColor = this.im.init(
            this.iconImage.width,
            this.iconImage.height,
            this.iconImage.data,
            totalGameTime,
        );

        // Set the background to a contrasting color for best icon contrast.
        const bgColor = new Vec4(1 - mainColor.x, 1 - mainColor.y, 1 - mainColor.z, 1);
        if (isColorGreyish(mainColor)) {
            bgColor.x = this.colorRandomizer();
            bgColor.y = 1 - bgColor.x;
            bgColor.z = this.colorRandomizer();
        }
        // Animated on the global clock (bgr.StartAnimation in the original).
        this.host.startBackgroundAnimation(bgColor);

        this.currentIconIndex++;
        if (this.gameMode === "Challenge") {
            // Port of LoadNewIcon: the Challenge ends when the stack is empty.
            if (this.currentIconIndex > this.randomIconIndex.length) {
                this.beginGameOver(totalGameTime);
            }
        } else {
            if (this.currentIconIndex >= this.randomIconIndex.length) {
                this.currentIconIndex = 0;
                this.createRandomIconList();
            }
        }
    }

    /** Port of StartNewIconRiddle. */
    private startNewIconRiddle(totalGameTime: number): void {
        this.puzzleSolved = false;
        this.puzzleSolvedCompleteHenceDisableLogic = false;

        this.camFuzzingYaw = this.rnd() * Math.PI * 2 - Math.PI;
        this.camFuzzingPitch = this.rnd() * Math.PI - Math.PI * 0.5;

        // Minimum distance to origin should be safe.
        this.camFuzzingYaw += Math.sign(this.camFuzzingYaw) * 0.5;
        this.camFuzzingPitch += Math.sign(this.camFuzzingPitch) * 0.8;

        this.camFuzzingAnimation.start(totalGameTime);
        void this.loadNewIcon(totalGameTime);
    }

    private isPuzzleCompleteAnimPlaying(totalGameTime: number): boolean {
        return totalGameTime - this.puzzleSolvedCompleteTime <= PUZZLE_SOLVED_COMPLETE_ANIMATION_TIME;
    }

    /** Port of RotationGame.Update. */
    public update(dt: number, totalGameTime: number): void {
        if (this.countdown.TimeLeft > 0) {
            this.puzzleGameStartTime = totalGameTime;
            this.timeBoard.TimeStart = totalGameTime;
            this.timeBoard.Time = GAME_DURATION;
        }

        if (this.iconImage === undefined) {
            this.startNewIconRiddle(totalGameTime);
        }

        if (this.camFuzzingAnimation.isRunning && dt > 0) {
            this.camFuzzingAnimation.update(totalGameTime);
            this.camPitch += (this.camFuzzingPitch - this.camPitch) * this.camFuzzingAnimation.progress;
            this.camYaw += (this.camFuzzingYaw - this.camYaw) * this.camFuzzingAnimation.progress;
        }

        if (this.gameOver) {
            this.camPitch += Math.sign(this.camFuzzingPitch) * dt * 0.2;
            this.camYaw += Math.sign(this.camFuzzingYaw) * dt * 0.2;
        }

        if (this.puzzleSolvedCompleteHenceDisableLogic && !this.isPuzzleCompleteAnimPlaying(totalGameTime)) {
            this.startNewIconRiddle(totalGameTime);
        }

        const allowInput = !this.puzzleSolvedCompleteHenceDisableLogic && !this.gameOver && !this.timeIsStoppedInternally;
        if (allowInput) {
            const camYawAbs = Math.abs(this.camYaw);
            const camPitchAbs = Math.abs(this.camPitch);
            const distanceSQR = camYawAbs * camYawAbs + camPitchAbs * camPitchAbs;

            if (this.camYaw === 0 && this.camPitch === 0) {
                this.im.startPuzzleCompleteAnimation(totalGameTime);
                this.puzzleSolvedCompleteHenceDisableLogic = true;
                this.puzzleSolvedCompleteTime = totalGameTime;
                const duration = totalGameTime - this.puzzleStartedTime;
                this.puzzleSolvedCompletionDurationAccumulated += duration;
                // The original cast to ulong, truncating the mantissa.
                this.scoreBoard.setScoreToAdd(1000 + Math.floor(Math.max(0, 9 - duration)) * 1000);
                this.timeBoard.addTimeBonus(Math.max(0, 5 - duration));
                this.praising.startPraising(totalGameTime, duration);
                // Port of AudioManager.PlayCue("validate").
                this.host.playCue("validate");
                this.statistics.numberOfPuzzlesSolved++;
            }

            if (!this.puzzleSolvedCompleteHenceDisableLogic && distanceSQR < ERROR_ANGLE) {
                this.puzzleSolved = true;
            }

            // Puzzle solved: smoothly align the camera to the front.
            if (this.puzzleSolved) {
                const smoothAlignSpeed = Math.min(1, 30 * dt);
                this.camYaw -= this.camYaw * smoothAlignSpeed;
                this.camPitch -= this.camPitch * smoothAlignSpeed;
                if (camYawAbs < 0.00005 && camPitchAbs < 0.00005) {
                    this.camYaw = 0;
                    this.camPitch = 0;
                }
            }
        }

        this.camRadius += ((this.iconImage?.width ?? 16) * 1.25 - this.camRadius) * dt * 10;

        const camRotation = Mat4.createFromYawPitchRoll(this.camYaw, this.camPitch, 0);
        this.camPosition = Vec3.scale(camRotation.backward(), this.camRadius);
        this.viewMatrix = Mat4.createLookAt(
            this.camPosition,
            Vec3.add(this.camPosition, camRotation.forward()),
            camRotation.up(),
        );

        if (this.timeIsStoppedInternally || this.isPuzzleCompleteAnimPlaying(totalGameTime)) {
            this.timeBoard.Time += dt;
        }

        // The background is updated by Game with the global clock; the game
        // only triggers its color animation via the host.
        this.im.update(totalGameTime, this.camPosition, this.viewMatrix);
        this.praising.update(totalGameTime);
        if (this.countdown.update(dt)) {
            this.puzzleStartedTime = totalGameTime;
        }

        const isPuzzleCompleteAnimPlaying = this.isPuzzleCompleteAnimPlaying(totalGameTime);
        if (isPuzzleCompleteAnimPlaying || this.camFuzzingAnimation.isRunning) {
            this.puzzleStartedTime = totalGameTime;
        }

        this.timeBoard.update(totalGameTime, dt, !isPuzzleCompleteAnimPlaying);
        this.scoreBoard.update(dt, !isPuzzleCompleteAnimPlaying);

        // Port of the Challenge gainable-score display.
        if (this.gameMode === "Challenge" && allowInput && !this.puzzleSolvedCompleteHenceDisableLogic) {
            const duration = totalGameTime - this.puzzleStartedTime;
            this.scoreBoard.setScoreToAdd(1000 + Math.floor(Math.max(0, 9 - duration)) * 1000);
        }

        if (this.gameOverAnimation.isRunning) {
            this.gameOverAnimation.update(totalGameTime);
        }

        if (this.gameMode === "TimeAttack" && this.timeBoard.TimeLeft <= 0 && !this.gameOver) {
            this.beginGameOver(totalGameTime);
        }

        this.conditionalUnlockIcon(totalGameTime);
    }

    /**
     * Port of ConditionalUnlockIcon: unlocks a new icon each 10000 score
     * points reached (starting at 30000). The unlock count persists via
     * UserConfig (localStorage).
     */
    private conditionalUnlockIcon(totalGameTime: number): void {
        const numIconsUnlocked = this.host.getNumIconsUnlocked(this.categoryIndex);
        if (numIconsUnlocked + 1 > this.numIcons) {
            // No icons left to unlock.
            this.iconUnlockDisplay.setUnlockDistance(Number.MAX_SAFE_INTEGER);
            return;
        }

        const scorePerUnlockedIcon = 10000;
        const minimumScoreToStartUnlock = 30000;
        const scoreNextUnlock =
            (numIconsUnlocked - NUM_UNLOCKED_ICONS_BY_DEFAULT) * scorePerUnlockedIcon + minimumScoreToStartUnlock;
        this.iconUnlockDisplay.setUnlockDistance(scoreNextUnlock - this.scoreBoard.getScoreShown());
        if (this.scoreBoard.getScore() > scoreNextUnlock) {
            if (this.gameMode !== "Challenge") {
                // Set the next icon to the new unlocked one.
                this.randomIconIndex[this.currentIconIndex] = numIconsUnlocked;
            }
            // Persist the unlock (userConfig.SetNumIconsUnlocked).
            this.host.unlockIcon(this.categoryIndex);
            const name = this.host.getIconName(this.categoryName, this.currentIconIndex);
            this.iconUnlockDisplay.unlockIcon(totalGameTime, name, this.iconImage);
            this.statistics.numberOfIconsUnlocked++;
        }
    }

    public getIconUnlockDisplay(): IconUnlockDisplay {
        return this.iconUnlockDisplay;
    }

    private beginGameOver(totalGameTime: number): void {
        this.gameOver = true;
        this.gameOverAnimation.start(totalGameTime);
        this.statistics.score = this.scoreBoard.getScore();
        this.statistics.timeSpendInThisGame = totalGameTime - this.puzzleGameStartTime;
        this.statistics.averagePuzzleSolvingSpeed =
            this.puzzleSolvedCompletionDurationAccumulated / Math.max(1, this.statistics.numberOfPuzzlesSolved);
    }

    /** Rotation input (port of the stick handling with deadzone + falloff). */
    public addRotationInput(yawDelta: number, pitchDelta: number, dt: number): void {
        if (this.puzzleSolved) {
            return;
        }
        // Port of RotationGame.HandleInput: invertYAxis flips the pitch.
        const invertYAxis = this.host.invertYAxis ? -1 : 1;
        const rotationSpeed = 5 * dt;
        const camYawAbs = Math.abs(this.camYaw);
        const camPitchAbs = Math.abs(this.camPitch);
        const distanceSQR = camYawAbs * camYawAbs + camPitchAbs * camPitchAbs;
        const factor = Math.pow(Math.min(1, distanceSQR + 0.1), 0.8);

        this.camYaw += yawDelta * rotationSpeed * factor;
        this.camPitch += pitchDelta * rotationSpeed * factor * invertYAxis;

        if (this.camYaw > Math.PI) this.camYaw -= Math.PI * 2;
        if (this.camYaw < -Math.PI) this.camYaw += Math.PI * 2;
        if (this.camPitch > Math.PI) this.camPitch -= Math.PI * 2;
        if (this.camPitch < -Math.PI) this.camPitch += Math.PI * 2;
    }

    // --- rendering accessors -------------------------------------------------

    public getCamPosition(): Vec3 {
        return this.camPosition;
    }

    public getViewMatrix(): Mat4 {
        return this.viewMatrix;
    }

    public getIconMap(): IconMap {
        return this.im;
    }

    public getIconImage(): IconImage | undefined {
        return this.iconImage;
    }

    public getCamFuzzingProgress(): number {
        return this.camFuzzingAnimation.progress;
    }

    public isCamFuzzing(): boolean {
        return this.camFuzzingAnimation.isRunning;
    }

    public getHudVisibility(): number {
        return Math.max(0, 1 - this.gameOverAnimation.progress * 3);
    }

    public getCountdown(): Countdown {
        return this.countdown;
    }

    public getScoreBoard(): ScoreBoard {
        return this.scoreBoard;
    }

    public getTimeBoard(): TimeBoard {
        return this.timeBoard;
    }

    public getPraising(): Praising {
        return this.praising;
    }

    public getTimeUpBounce(progress: number): number {
        return 1 - this.timeUpCurve.evaluate(progress * 3);
    }

    public getGameMode(): GameMode {
        return this.gameMode;
    }

    /** Resolves the icon image at a random-list position (for the HUD stack). */
    public getIconImageAt(position: number): IconImage | undefined {
        return this.iconImageCache.get(this.randomIconIndex[position] ?? -1);
    }

    public getRandomListLength(): number {
        return this.randomIconIndex.length;
    }

    public getCurrentIconIndex(): number {
        return this.currentIconIndex;
    }

    /** Icon preview crossfade state (port of the HUD spriteBatch block). */
    public getIconPreview(): { current: IconImage; previous: IconImage | undefined; alphaCurrent: number; alphaPrevious: number } | undefined {
        const current = this.iconImage;
        if (current === undefined) {
            return undefined;
        }
        if (this.camFuzzingAnimation.isRunning) {
            // Gamma-corrected crossfade (pow(x, 1/2.2)) between the icons.
            const alphaIconTex = Math.pow(this.camFuzzingAnimation.progress, 1 / 2.2);
            const alphaPrevIconTex = Math.pow(1 - this.camFuzzingAnimation.progress, 1 / 2.2);
            return { current, previous: this.prevIconImage, alphaCurrent: alphaIconTex, alphaPrevious: alphaPrevIconTex };
        }
        return { current, previous: undefined, alphaCurrent: 1, alphaPrevious: 0 };
    }

    public getFov(): number {
        return FOV;
    }
}