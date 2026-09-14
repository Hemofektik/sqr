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
import { SuperQuadric } from "./SuperQuadric.ts";
import { RotationGameStatisticsScreen, HighscoreScreen } from "./Screens.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

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
            // 2D icon preview (port of the spriteBatch block).
            const preview = game.getIconPreview();
            if (preview !== undefined) {
                ctx.drawIconPreview(
                    preview.current,
                    preview.previous,
                    preview.alphaCurrent * hudVisibility,
                    preview.alphaPrevious * hudVisibility,
                );
            }

            game.getScoreBoard().draw(hudVisibility);
            game.getTimeBoard().draw(hudVisibility);
            game.getPraising().draw(hudVisibility);
            game.getCountdown().draw(hudVisibility);
        }

        // Port of the game-over text block in RotationGame.Render.
        if (game.isGameOverAnimationRunning()) {
            const font = ctx.font;
            const textAlpha = Math.min(1, game.getGameOverProgress() * 2);
            const fontColor = new Vec4(1, 0, 0, textAlpha);
            const gameOverText = "Time up!";
            const targetX = -0.7;

            const viewPosition = new Vec3(0, 0, 1);
            {
                const theta = 0.5;
                const phi = 2.5;
                SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
            }

            // bounceInValue = 1 - timeUpCurve.Evaluate(progress * 3);
            // bounceOutValue = pow((max(2, progress*3) - 2) * 2, 3).
            const p = game.getGameOverProgress() * 3;
            const bounceInValue = game.getTimeUpBounce(game.getGameOverProgress());
            const bounceOutValue = Math.pow((Math.max(2, p) - 2) * 2, 3);

            const zDepth = 8 + gameOverText.length * 1.5;
            font.addText(
                gameOverText,
                new Vec3(targetX + bounceInValue * 3 - bounceOutValue * 3, -0.3, -1).multiplyScalar(zDepth),
                1,
                fontColor,
            );
            const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
            const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);
            font.applyCamera(viewPosition, viewMatrix, projMatrix);
            font.flush(textAlpha < 1);
        }
    }
}