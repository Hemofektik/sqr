/**
 * SQFont runtime - port of Hemofektik.SQFont.cs.
 *
 * Text is rendered as superquadrics: every opaque glyph pixel becomes one
 * quadric. The glyph layout comes from the preprocessed JSON
 * (tools/sqfont-convert.mjs -> public/fonts/astronaut.json).
 */
import { Camera, Scene } from "three";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";
import { SuperQuadric, SuperQuadricBatch, applyXnaCamera } from "./SuperQuadric.ts";

interface GlyphJson {
    w: number;
    q: number[];
}

interface FontJson {
    letterHeight: number;
    letterSpace: number;
    glyphs: Record<string, GlyphJson>;
}

const FIRST_CODE = 32;
const LAST_CODE = 122;

interface TextBatch {
    text: string;
    pos: Vec3;
    scale: number;
    diffuseColor: Vec4;
    emissiveColor: Vec4;
}

export class SQFont {
    private readonly letterHeight: number;
    private readonly letterSpace: number;
    private readonly glyphs = new Map<number, GlyphJson>();
    private readonly batch: SuperQuadricBatch;
    private readonly sqs: SuperQuadric[] = [];
    private readonly texts: TextBatch[] = [];
    public readonly scene = new Scene();
    public readonly camera = new Camera();

    public constructor(fontJson: FontJson, maxQuads: number) {
        this.letterHeight = fontJson.letterHeight;
        this.letterSpace = fontJson.letterSpace;
        for (let code = FIRST_CODE; code <= LAST_CODE; code++) {
            const glyph = fontJson.glyphs[String(code)];
            if (glyph !== undefined) {
                this.glyphs.set(code, glyph);
            }
        }
        this.batch = new SuperQuadricBatch(16, maxQuads, false);
        this.scene.add(this.batch.mesh);
    }

    public getLetterHeight(): number {
        return this.letterHeight;
    }

    public getTextWidth(text: string): number {
        let width = 0;
        for (const raw of text) {
            let code = raw.codePointAt(0) ?? 63;
            if (code === 13 || code === 10) {
                continue;
            }
            if (code < FIRST_CODE || code > LAST_CODE) {
                code = 63; // '?'
            }
            const glyph = this.glyphs.get(code);
            width += (glyph?.w ?? 0) + this.letterSpace;
        }
        return width;
    }

    /** Port of SQFont.AddElement: adds a single custom superquadric. */
    public addElement(
        diffuseColor: Vec4,
        emissiveColor: Vec4,
        scale: number,
        pos: Vec3,
        sqParameters: Vec4,
    ): void {
        const sq = new SuperQuadric();
        sq.colorEmissive = emissiveColor.clone();
        sq.colorDiffuse = diffuseColor.clone();
        sq.sqParams = sqParameters.clone();
        sq.world = Mat4.multiply(
            Mat4.createScale(scale),
            new Mat4().setTranslation(pos),
        );
        this.sqs.push(sq);
    }

    /** Port of SQFont.AddText. */
    public addText(
        text: string,
        pos: Vec3,
        scale: number,
        diffuseColor: Vec4,
        emissiveColor = new Vec4(0, 0, 0, 1),
    ): void {
        this.texts.push({
            text,
            pos: pos.clone(),
            scale,
            diffuseColor: diffuseColor.clone(),
            emissiveColor: emissiveColor.clone(),
        });
    }

    /** Port of SQFont.GetText: emits one SuperQuadric per glyph pixel. */
    private getText(
        text: string,
        pos: Vec3,
        scale: number,
        diffuseColor: Vec4,
        emissiveColor: Vec4,
    ): void {
        const posOriginX = pos.x;
        for (const raw of text) {
            let code = raw.codePointAt(0) ?? 63;
            if (code === 13 || code === 10) {
                pos.x = posOriginX;
                pos.y -= this.letterHeight * 1.2;
                continue;
            }
            if (code < FIRST_CODE || code > LAST_CODE) {
                code = 63;
            }
            const glyph = this.glyphs.get(code);
            if (glyph !== undefined) {
                const q = glyph.q;
                for (let i = 0; i < q.length; i += 4) {
                    const px = q[i] ?? 0;
                    const py = q[i + 1] ?? 0;
                    const roll = q[i + 2] ?? 0;
                    const roundedRadiant = q[i + 3] ?? -10;

                    const sq = new SuperQuadric();
                    sq.colorEmissive = emissiveColor.clone();
                    sq.colorDiffuse = diffuseColor.clone();
                    sq.sqParams = new Vec4(0.2, 0.2, roundedRadiant, 1);

                    // XNA: q_roll * q_pitch (Hamilton product) means the pitch is
                    // applied first, then the roll around the world Z axis.
                    // Rolling first would rotate around the shape's local Z,
                    // which the 90 degree pitch maps onto the world X axis.
                    const rot = Mat4.multiply(
                        Mat4.createFromYawPitchRoll(0, Math.PI / 2, 0),
                        Mat4.createFromYawPitchRoll(0, 0, roll),
                    );
                    sq.world = Mat4.multiply(Mat4.multiply(
                        rot,
                        Mat4.createScale(scale),
                    ), new Mat4().setTranslation(
                        new Vec3(pos.x + px * scale, pos.y + py * scale, pos.z),
                    ));

                    this.sqs.push(sq);
                }
            }
            pos.x += ((glyph?.w ?? 0) + this.letterSpace) * scale;
        }
    }

    /**
     * Port of SQFont.Flush: builds the queued text quads and renders them
     * immediately with the current camera. Multiple flushes per frame are
     * allowed - each renders its own text, like the XNA screens did.
     */
    public flush(alphaBlend = false): void {
        for (const batch of this.texts) {
            this.getText(batch.text, batch.pos, batch.scale, batch.diffuseColor, batch.emissiveColor);
        }
        this.texts.length = 0;

        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        this.batch.setBlending(alphaBlend);
        this.batch.setInstances(this.sqs);
        this.sqs.length = 0;

        applyXnaCamera(this.camera, this.cameraView, this.cameraProj);
        this.batch.setGlobals(this.cameraPosition);
        this.renderCallback?.(this.scene, this.camera);
    }

    /** Host-provided draw callback so each flush renders immediately. */
    public setRenderCallback(callback: (scene: Scene, camera: Camera) => void): void {
        this.renderCallback = callback;
    }

    private renderCallback: ((scene: Scene, camera: Camera) => void) | undefined;

    /**
     * Returns and clears the queued text quads without rendering (used by
     * Praising, which animates the quads itself before drawing).
     */
    public takeQueuedQuads(): SuperQuadric[] {
        for (const batch of this.texts) {
            this.getText(batch.text, batch.pos, batch.scale, batch.diffuseColor, batch.emissiveColor);
        }
        this.texts.length = 0;
        const quads = this.sqs.slice();
        this.sqs.length = 0;
        return quads;
    }

    /** Draws a custom superquadric list with an explicit camera (Praising). */
    public drawSuperQuadrics(
        list: SuperQuadric[],
        viewPosition: Vec3,
        view: Mat4,
        proj: Mat4,
        alphaBlend: boolean,
    ): void {
        this.batch.setBlending(alphaBlend);
        this.batch.setInstances(list);
        applyXnaCamera(this.camera, view, proj);
        this.batch.setGlobals(viewPosition);
        this.renderCallback?.(this.scene, this.camera);
    }

    /** Sets the ortho camera used for the next flush (per-screen setup). */
    public applyCamera(viewPosition: Vec3, view: Mat4, proj: Mat4): void {
        this.cameraPosition = viewPosition.clone();
        this.cameraView = view.clone();
        this.cameraProj = proj.clone();
        applyXnaCamera(this.camera, view, proj);
    }

    private cameraPosition = new Vec3(0, 0, 1);
    private cameraView = Mat4.createLookAt(new Vec3(0, 0, 1), new Vec3(0, 0, 0), Vec3.up);
    private cameraProj = Mat4.createOrthographicOffCenter(-100, 100, -56.25, 56.25, 1, 550);
}