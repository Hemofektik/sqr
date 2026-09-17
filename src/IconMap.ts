/**
 * IconMap - port of SQR.IconMap.cs.
 *
 * Builds one superquadric per opaque icon pixel and animates them from a
 * fuzzed cloud into the flat image. Pixels are sorted back-to-front for
 * correct alpha blending.
 */
import { Animation } from "./Animation.ts";
import { Curve, loadCurve } from "./Curve.ts";
import { SuperQuadric } from "./SuperQuadric.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

const MAX_ICON_WIDTH = 48;
const MAX_ICON_HEIGHT = 48;

/** Port of SuperQuadric.Animation: keyframes lerped by a time curve. */
class SQKeyframeAnimation {
    private readonly timeCurve: Curve;
    private readonly keys: SuperQuadric[];

    public constructor(timeCurve: Curve, keys: SuperQuadric[]) {
        this.timeCurve = timeCurve;
        this.keys = keys;
    }

    public apply(target: SuperQuadric, time: number): void {
        const timeLerp = Math.min(1, Math.max(0, this.timeCurve.evaluate(time)));
        const numKeys = this.keys.length;
        const fullTimeLerp = timeLerp * (numKeys - 1);
        const index0 = Math.floor(fullTimeLerp);
        const index1 = Math.min(index0 + 1, numKeys - 1);
        const lerp = fullTimeLerp - index0;

        const sq0 = this.keys[index0];
        const sq1 = this.keys[index1];
        if (sq0 === undefined || sq1 === undefined) {
            return;
        }

        target.world = Mat4.lerp(sq0.world, sq1.world, lerp);
        target.radius = sq0.radius + (sq1.radius - sq0.radius) * lerp;
        target.dimension = Vec3.lerp(sq0.dimension, sq1.dimension, lerp);
        target.sqParams = Vec4.lerp(sq0.sqParams, sq1.sqParams, lerp);
        target.colorDiffuse = Vec4.lerp(sq0.colorDiffuse, sq1.colorDiffuse, lerp);
        target.colorEmissive = Vec4.lerp(sq0.colorEmissive, sq1.colorEmissive, lerp);
    }
}

/** Deterministic RNG (the original used seeded Random instances). */
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function cloneSQ(sq: SuperQuadric): SuperQuadric {
    const copy = new SuperQuadric();
    copy.world = sq.world.clone();
    copy.radius = sq.radius;
    copy.dimension = sq.dimension.clone();
    copy.sqParams = sq.sqParams.clone();
    copy.colorDiffuse = sq.colorDiffuse.clone();
    copy.colorEmissive = sq.colorEmissive.clone();
    return copy;
}

interface PixelQuadric {
    sq: SuperQuadric;
    animation: SQKeyframeAnimation | undefined;
    pos: Vec3;
}

export class IconMap {
    private pixels: PixelQuadric[] = [];
    private readonly rnd = makeRandom(123456);
    private readonly puzzleStartAnimation = new Animation(1);
    private readonly puzzleCompleteAnimation = new Animation(1.5);
    private readonly shininessAnimationCurve = loadCurve("bell");
    /** Port of IconMap's fuzzingCurve: a plain 0 -> 1 interpolation. */
    private readonly fuzzingCurve = (() => {
        const curve = new Curve();
        curve.addKey(0, 0, 0, 0);
        curve.addKey(1, 1, 0, 0);
        return curve;
    })();

    private width = 0;
    private height = 0;
    private colorMap: Uint8ClampedArray | undefined;
    private lastMainColor = new Vec4(0, 0, 0, 0);
    private sortedSQS: SuperQuadric[] = [];
    private objectRotation = Mat4.identity();

    /** Sets the object rotation baked into every instance (fixed-camera mode). */
    public setObjectRotation(rotation: Mat4): void {
        this.objectRotation = rotation;
    }

    public constructor() {
        for (let n = 0; n < MAX_ICON_WIDTH * MAX_ICON_HEIGHT; n++) {
            const sq = new SuperQuadric();
            sq.colorDiffuse = new Vec4(0.7, 0.7, 0.7, 0);
            this.pixels.push({ sq, animation: undefined, pos: new Vec3(0, 0, 0) });
        }
    }

    public getWidth(): number {
        return this.width;
    }

    public getHeight(): number {
        return this.height;
    }

    /** Port of IconMap.Init. Returns the icon's main color. */
    public init(width: number, height: number, map: Uint8ClampedArray, totalGameTime: number): Vec4 {
        this.width = width;
        this.height = height;
        this.colorMap = map;
        return this.createVisualization(totalGameTime);
    }

    /** Port of IconMap.CreateVisualization. */
    private createVisualization(totalGameTime: number): Vec4 {
        this.puzzleStartAnimation.start(totalGameTime);

        const mainColor = new Vec4(0, 0, 0, 0);
        const standardSQParams = new Vec4(0.1, 0.1, -10, 1);

        const invisibleSQ = new SuperQuadric();
        invisibleSQ.colorDiffuse = new Vec4(this.lastMainColor.x, this.lastMainColor.y, this.lastMainColor.z, 0);
        invisibleSQ.sqParams = standardSQParams.clone();

        const fuzzingSize = this.width * 0.707;
        let numQuadrics = 0;

        for (let colorIndex = 0; colorIndex < this.pixels.length; colorIndex++) {
            const y = Math.floor(colorIndex / this.width);
            const x = colorIndex % this.width;

            const sq = new SuperQuadric();
            let targetSQ: SuperQuadric;
            const map = this.colorMap;
            const alpha = map !== undefined && colorIndex < map.length / 4 ? (map[colorIndex * 4 + 3] ?? 0) : 0;

            if (alpha === 0) {
                targetSQ = invisibleSQ;
                targetSQ.colorEmissive = new Vec4(this.lastMainColor.x, this.lastMainColor.y, this.lastMainColor.z, 0);
            } else {
                const r = (map?.[colorIndex * 4] ?? 0) / 255;
                const g = (map?.[colorIndex * 4 + 1] ?? 0) / 255;
                const b = (map?.[colorIndex * 4 + 2] ?? 0) / 255;
                const a = alpha / 255;

                mainColor.x += r;
                mainColor.y += g;
                mainColor.z += b;
                mainColor.w += a;
                numQuadrics++;

                const zDepth = this.width - 2;
                const pos = new Vec3(
                    x - this.width / 2,
                    -y + this.height / 2,
                    this.rnd() * zDepth - zDepth * 0.5,
                );

                sq.colorDiffuse = new Vec4(0, 0, 0, a);
                sq.colorEmissive = new Vec4(r, g, b, 1);
                sq.dimension = new Vec3(0.5, 0.5, 0.5);
                sq.world = new Mat4().setTranslation(pos);
                sq.sqParams = standardSQParams.clone();
                targetSQ = sq;
            }

            const startKey = cloneSQ(this.pixels[colorIndex]?.sq ?? new SuperQuadric());
            const animation = this.createAnimation(startKey, targetSQ, fuzzingSize);
            this.pixels[colorIndex] = { sq: startKey, animation, pos: new Vec3(0, 0, 0) };
        }

        this.lastMainColor = new Vec4(
            mainColor.x / numQuadrics,
            mainColor.y / numQuadrics,
            mainColor.z / numQuadrics,
            mainColor.w / numQuadrics,
        );
        return this.lastMainColor;
    }

    /** Port of SuperQuadric.Animation creation in IconMap. */
    private createAnimation(startKey: SuperQuadric, endKey: SuperQuadric, fuzzingSize: number): SQKeyframeAnimation {
        const middleKey = cloneSQ(startKey);
        middleKey.colorEmissive = new Vec4(0, 0, 0, 1);
        middleKey.colorDiffuse = new Vec4(
            1 - startKey.colorEmissive.x,
            1 - startKey.colorEmissive.y,
            1 - startKey.colorEmissive.z,
            startKey.colorDiffuse.w,
        );

        const dir = new Vec3(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5).normalize();
        middleKey.world = new Mat4().setTranslation(Vec3.scale(dir, fuzzingSize));
        middleKey.sqParams = new Vec4(0.5, 0.5, -10, 1);

        return new SQKeyframeAnimation(this.fuzzingCurve, [cloneSQ(startKey), middleKey, cloneSQ(endKey)]);
    }

    public startPuzzleCompleteAnimation(totalGameTime: number): void {
        this.puzzleCompleteAnimation.start(totalGameTime);
    }

    public isPuzzleCompleteAnimationRunning(): boolean {
        return this.puzzleCompleteAnimation.isRunning;
    }

    public getPuzzleCompleteProgress(): number {
        return this.puzzleCompleteAnimation.progress;
    }

    /**
     * Port of IconMap.Draw: sets the rotating light while the puzzle-complete
     * animation plays. Must be called right before the icon batch is rendered,
     * because the light is shared static state that other draw calls overwrite.
     */
    public draw(): void {
        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);

        if (this.puzzleCompleteAnimation.isRunning) {
            // rotate the light around the superquadrics
            const theta = (1 - this.puzzleCompleteAnimation.progress) * (Math.PI * 2 - Math.PI * 0.5);
            const phi = this.puzzleCompleteAnimation.progress * 3 - 1;
            SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
        }
    }

    /** Port of IconMap.Update. */
    public update(totalGameTime: number, cameraPos: Vec3, viewMatrix: Mat4): void {
        let shininess = 0;
        if (this.puzzleCompleteAnimation.isRunning) {
            this.puzzleCompleteAnimation.update(totalGameTime);
            shininess = this.shininessAnimationCurve.evaluate(this.puzzleCompleteAnimation.progress);
        }

        if (this.puzzleStartAnimation.isRunning) {
            this.puzzleStartAnimation.update(totalGameTime);
            for (const pq of this.pixels) {
                if (pq.animation !== undefined) {
                    pq.animation.apply(pq.sq, this.puzzleStartAnimation.progress);
                }
                pq.pos = pq.sq.world.translation();
            }
        }

        const camDir = Vec3.scale(cameraPos, -1).normalize();
        let camOriginDistance = Math.pow(Math.min(1, 1 - Vec3.dot(camDir, Vec3.forward)), 0.3);
        if (Vec3.dot(viewMatrix.up(), Vec3.up) < 0) {
            camOriginDistance = 1; // prevents solving the puzzle upside down
        }

        const sorted: SuperQuadric[] = [];
        for (const pq of this.pixels) {
            if (pq.sq.colorDiffuse.w > 0.001) {
                // Bake the object rotation into the instance matrix (the
                // camera is fixed, the object rotates). Translation is the
                // rotated local position; the shader transforms normals by
                // this matrix, so lighting stays correct.
                const rotated = this.objectRotation.transformVector(new Vec3(pq.pos.x, pq.pos.y, pq.pos.z * camOriginDistance));
                pq.sq.world.setTranslation(rotated);
                pq.sq.colorEmissive = new Vec4(
                    pq.sq.colorEmissive.x,
                    pq.sq.colorEmissive.y,
                    pq.sq.colorEmissive.z,
                    shininess,
                );
                sorted.push(pq.sq);
            }
        }

        // Sort back to front.
        sorted.sort((a, b) => {
            const da = a.world.translation().sub(cameraPos).lengthSquared();
            const db = b.world.translation().sub(cameraPos).lengthSquared();
            return db - da;
        });
        this.sortedSQS = sorted;
    }

    public getSortedSQs(): SuperQuadric[] {
        return this.sortedSQS;
    }
}