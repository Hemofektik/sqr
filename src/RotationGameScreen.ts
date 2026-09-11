/**
 * RotationGameScreen - port of GameStateManagement RotationGameScreen.
 *
 * Renders the rotation game (3D icon + HUD) and handles its input.
 */
import { Camera, Scene } from "three";
import { GameScreen } from "./ScreenManager.ts";
import type { ScreenContext } from "./ScreenManager.ts";
import { RotationGame } from "./RotationGame.ts";
import type { RotationGameHost } from "./RotationGame.ts";
import { SuperQuadricBatch, applyXnaCamera } from "./SuperQuadric.ts";
import { RotationGameStatisticsScreen, HighscoreScreen } from "./Screens.ts";
import { Mat4 } from "./XnaMath.ts";

export class RotationGameScreen extends GameScreen {
    public readonly kind = "game" as const;
    private rotGame: RotationGame | undefined;
    private readonly batch: SuperQuadricBatch;
    private readonly scene = new Scene();
    private readonly camera = new Camera();

    public constructor(
        gameMode: "TimeAttack",
        categoryIndex: number,
        categoryName: string,
        host: RotationGameHost,
    ) {
        super();
        void gameMode;
        this.categoryIndex = categoryIndex;
        this.categoryName = categoryName;
        this.batch = new SuperQuadricBatch(16, 4096, false);
        this.scene.add(this.batch.mesh);
        this.rotGame = new RotationGame(host, categoryIndex, categoryName);
    }

    private totalGameTime = 0;
    private statisticsWhereShown = false;
    private highscoreWhereShown = false;
    private readonly gameModeName = "TimeAttack";
    private readonly categoryIndex: number;
    private readonly categoryName: string;

    public getCategoryName(): string {
        return this.categoryName;
    }

    public addRotationInput(yawDelta: number, pitchDelta: number, dt: number): void {
        this.rotGame?.addRotationInput(yawDelta, pitchDelta, dt);
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);
        if (this.screenState === "active" || this.rotGame?.isGameOver()) {
            this.totalGameTime += dt;
            this.rotGame?.update(dt, this.totalGameTime);
        }

        // Port of RotationGameScreen.Update game-over flow: show statistics,
        // then the highscore screen with the new score.
        const game = this.rotGame;
        if (game === undefined || !game.isGameOver()) {
            return;
        }
        if (!this.statisticsWhereShown) {
            this.statisticsWhereShown = true;
            const stats = game.getStatistics();
            this.manager?.addScreen(new RotationGameStatisticsScreen(
                this.gameModeName,
                this.categoryIndex,
                {
                    score: stats.score,
                    numberOfPuzzlesSolved: stats.numberOfPuzzlesSolved,
                    numberOfIconsUnlocked: 0,
                    numberOfIconsUnlockable: 0,
                    averagePuzzleSolvingSpeed: stats.averagePuzzleSolvingSpeed,
                    timeSpendInThisGame: stats.timeSpendInThisGame,
                },
            ));
        } else if (!this.highscoreWhereShown && this.manager !== undefined) {
            this.highscoreWhereShown = true;
            // Port of ShowHighscoreIngame: replace remaining screens with the
            // highscore screen and add the new entry.
            for (const screen of this.manager.getScreens()) {
                if (screen !== this) {
                    screen.exitScreen();
                }
            }
            this.exitScreen();
            const highscore = new HighscoreScreen(true);
            highscore.addNewEntry(game.getScore(), "Anonymous");
            this.manager.addScreen(highscore);
        }
    }

    public override draw(ctx: ScreenContext): void {
        const game = this.rotGame;
        if (game === undefined) {
            return;
        }

        // 3D icon (vpMain): perspective FOV camera, own depth band.
        const iconMap = game.getIconMap();
        const sqs = iconMap.getSortedSQs();
        const camPos = game.getCamPosition();
        const viewMatrix = game.getViewMatrix();
        const aspect = ctx.viewportWidth / ctx.viewportHeight;
        const projMatrix = Mat4.createPerspectiveFieldOfView(game.getFov(), aspect, 0.1, 300);
        applyXnaCamera(this.camera, viewMatrix, projMatrix);
        // Port of IconMap.Draw: rotating light during the solve flash. Set
        // right before rendering so the HUD cannot overwrite it first.
        iconMap.draw();
        this.batch.setInstances(sqs);
        this.batch.setGlobals(camPos);
        ctx.renderScene(this.scene, this.camera, 0.2, 0.9);

        // HUD (vpForeGround) is drawn by the individual boards via the font.
        const hudVisibility = game.getHudVisibility();
        if (hudVisibility > 0.001) {
            game.getScoreBoard().draw(hudVisibility);
            game.getTimeBoard().draw(hudVisibility);
            game.getPraising().draw(hudVisibility);
            game.getCountdown().draw(hudVisibility);
        }
    }
}