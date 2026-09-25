/**
 * Tacho - port of Celeritas/Tacho.cs: speedometer bar + km/h readout drawn
 * with the superquadric font.
 */
import { SQFont } from "../SQFont.ts";
import { Mat4, Vec3, Vec4 } from "../XnaMath.ts";
import { SuperQuadric } from "../SuperQuadric.ts";

export class Tacho {
    private readonly sqFont: SQFont;
    private velocity = 0;
    private velocityShown = 0;

    public constructor(sqFont: SQFont) {
        this.sqFont = sqFont;
    }

    public set velocity_(value: number) {
        this.velocity = value;
    }

    /** Port of Tacho.Velocity setter (ulong). */
    public setVelocity(value: number): void {
        this.velocity = value;
    }

    /** Port of Tacho.Update: integer-eased display value. */
    public update(elapsedSeconds: number): void {
        if (this.velocity < this.velocityShown) {
            this.velocityShown = this.velocity;
        }
        this.velocityShown += Math.ceil((this.velocity - this.velocityShown) * elapsedSeconds);
    }

    /** Port of Tacho.Draw (alpha = 0.5 in the original screen). */
    public draw(alpha: number): void {
        const fontDiffuseColor = new Vec4(1, 1, 1, 1);
        const fontEmissiveColor = new Vec4(0, 0, 0, 1);

        const zDepth = 50;
        const viewPosition = new Vec3(0, 0, 1);
        const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);

        {
            const theta = 0.5;
            const phi = 2.5;
            SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
        }

        // Colored velocity bar (green -> yellow -> red).
        {
            const fadeValue = alpha;
            const sliderStartPos = new Vec3(0.2, 0.6, -1.01);
            const elementSizeX = new Vec3(1.01, 0, 0);
            const elementSizeY = new Vec3(0, 1.01, 0);
            const cube = new Vec4(0.1, 0.1, -10, 1);

            const green = new Vec4(0, 1, 0, fadeValue);
            const yellow = new Vec4(1, 1, 0, fadeValue);
            const red = new Vec4(1, 0, 0, fadeValue);

            const scale = 1;
            const emissiveColor = new Vec4(0, 0, 0, fadeValue);

            const numSliderElements = 40;
            const numElementsX = Math.min(numSliderElements, Math.trunc((this.velocityShown / 1300) * numSliderElements));
            for (let y = 1; y < 4; y++) {
                for (let x = 0; x < numElementsX; x++) {
                    const lerp = x / (numSliderElements - 1);
                    let sliderColor: Vec4;
                    if (lerp < 0.5) {
                        sliderColor = Vec4.lerp(green, yellow, lerp * 2);
                    } else {
                        sliderColor = Vec4.lerp(yellow, red, lerp * 2 - 1);
                    }

                    const offset = Vec3.add(
                        Vec3.scale(elementSizeX, x),
                        Vec3.add(Vec3.scale(elementSizeY, y), new Vec3(1.5, 1.5, 0)),
                    );
                    const pos = Vec3.add(Vec3.scale(sliderStartPos, zDepth), offset);
                    this.sqFont.addElement(sliderColor, emissiveColor, scale, pos, cube);
                }
            }
        }

        this.sqFont.addText(
            `${this.velocityShown} km/h`,
            new Vec3(0.2, 0.6, -1.0).multiplyScalar(zDepth),
            1,
            fontDiffuseColor,
            fontEmissiveColor,
        );
        this.sqFont.applyCamera(viewPosition, viewMatrix, projMatrix);
        this.sqFont.flush(alpha < 1);
    }
}
