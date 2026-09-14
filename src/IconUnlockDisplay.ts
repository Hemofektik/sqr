/**
 * IconUnlockDisplay - port of SQR.IconUnlockDisplay.cs.
 *
 * Shows "Unlocked <name>" with the unlocked icon image, and a persistent
 * "Next Unlock <score>" distance readout. Both fade with a bell-curved
 * blend animation.
 */
import { Animation } from "./Animation.ts";
import { loadCurve } from "./Curve.ts";
import { SuperQuadric } from "./SuperQuadric.ts";
import { SQFont } from "./SQFont.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";
import type { IconImage } from "./RotationGame.ts";

export interface IconUnlockHost {
    /** Draws the unlocked icon into the HUD (backbuffer coordinates). */
    drawUnlockIcon(image: IconImage, alpha: number): void;
}

export class IconUnlockDisplay {
    private readonly font: SQFont;
    private readonly praiseAnimation = new Animation(1);
    private readonly blendAnimation = new Animation(5); // initial help text shows longer
    private unlockedName = "";
    private unlockedIcon: IconImage | undefined;
    private blendAnimationEndedOnce = false;
    private unlockDistance = Number.MAX_SAFE_INTEGER;
    private readonly host: IconUnlockHost;

    public constructor(font: SQFont, host: IconUnlockHost) {
        this.font = font;
        this.host = host;
        this.blendAnimation.timeCurve = loadCurve("bell");
    }

    public getUnlockDistance(): number {
        return this.unlockDistance;
    }

    public setUnlockDistance(value: number): void {
        this.unlockDistance = value;
    }

    public update(totalGameTime: number, dt: number): void {
        // Port of IconUnlockDisplay.Update: the initial blend restarts while
        // the first five seconds are still running.
        if (totalGameTime < 5) {
            this.blendAnimation.start(totalGameTime);
        }

        this.praiseAnimation.update(totalGameTime);
        this.blendAnimation.update(totalGameTime);

        if (!this.blendAnimation.isRunning) {
            this.blendAnimationEndedOnce = true;
        }
        void dt;
    }

    /** Port of IconUnlockDisplay.UnlockIcon (visuals only; the caller
     * persists the unlock count). */
    public unlockIcon(totalGameTime: number, iconName: string, image: IconImage | undefined): void {
        this.blendAnimation.duration = 2;
        this.blendAnimation.start(totalGameTime);
        this.praiseAnimation.start(totalGameTime);

        this.unlockedName = iconName;
        this.unlockedIcon = image;
    }

    public draw(alpha: number): void {
        const font = this.font;
        const viewPosition = new Vec3(70, 50, -30);
        const fontPos = new Vec3(viewPosition.x, viewPosition.y, viewPosition.z - 1);
        const viewMatrix = Mat4.createLookAt(viewPosition, fontPos, Vec3.up);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);

        alpha *= this.blendAnimation.progress;

        // Unlocked text (fades with the blend animation).
        if (alpha > 0.001 && this.unlockedName !== "") {
            const fontDiffuseColor = new Vec4(1, 0.4, 0.1, alpha);
            const fontEmissiveColor = new Vec4(1, 0.4, 0.1, alpha);
            const zDepth = 100;
            font.addText(
                `Unlocked \n${this.unlockedName}`,
                new Vec3(0, 0.1, -1).multiplyScalar(zDepth),
                1,
                fontDiffuseColor,
                fontEmissiveColor,
            );
            font.applyCamera(viewPosition, viewMatrix, projMatrix);
            font.flush(alpha < 1);
        }

        // Next-unlock distance readout.
        let remainAlpha = 1;
        if (this.unlockDistance < Number.MAX_SAFE_INTEGER) {
            const fontDiffuseColor = new Vec4(1, 1, 1, 1);
            const fontEmissiveColor = new Vec4(0, 0, 0, 1);
            remainAlpha =
                (1 - alpha) * (!this.blendAnimationEndedOnce && this.blendAnimation.timeProgress < 0.5 ? 0 : 1);
            if (remainAlpha > 0.001) {
                const zDepth = 100;
                font.addText(
                    `Next Unlock \n${Math.max(0, Math.round(this.unlockDistance))}`,
                    new Vec3(-0.15, 0.09, -1).multiplyScalar(zDepth),
                    1,
                    new Vec4(fontDiffuseColor.x, fontDiffuseColor.y, fontDiffuseColor.z, remainAlpha),
                    new Vec4(fontEmissiveColor.x, fontEmissiveColor.y, fontEmissiveColor.z, remainAlpha),
                );
                font.applyCamera(viewPosition, viewMatrix, projMatrix);
                font.flush(remainAlpha < 1);
            }
        }

        // Specular light for the unlock flash.
        {
            const theta = 0.5;
            const phi = 2.5;
            SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
        }

        // Unlocked icon image at (199, 815) 128x128 in the backbuffer.
        if (this.unlockedIcon !== undefined && alpha > 0.001) {
            this.host.drawUnlockIcon(this.unlockedIcon, alpha);
            if (!this.blendAnimation.isRunning) {
                this.unlockedIcon = undefined;
            }
        }
        void remainAlpha;
    }
}