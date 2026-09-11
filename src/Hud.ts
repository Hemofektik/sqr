/**
 * HUD components - ports of ScoreBoard.cs, TimeBoard.cs, Countdown.cs, Praising.cs.
 *
 * All draw with the superquadric font using the XNA perspective projection.
 */
import { Animation } from "./Animation.ts";
import { Curve } from "./Curve.ts";
import { SuperQuadric } from "./SuperQuadric.ts";
import { SQFont } from "./SQFont.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

function setHudLight(): void {
    const theta = 0.5;
    const phi = 2.5;
    SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
}

function applyHudCamera(font: SQFont, viewPosition: Vec3): void {
    const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
    const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);
    font.applyCamera(viewPosition, viewMatrix, projMatrix);
}

/** Port of ScoreBoard.cs. */
export class ScoreBoard {
    private score = 0;
    private scoreShown = 0;
    private lastScoreAdded = 0;
    private lastScoreAddedText = "";
    private lastScoreAddedTime = 0;
    private readonly font: SQFont;

    public constructor(font: SQFont) {
        this.font = font;
    }

    public getScore(): number {
        return this.score + this.lastScoreAdded;
    }

    public setScore(value: number): void {
        this.score = value;
    }

    public setScoreToAdd(scoreToAdd: number): void {
        this.lastScoreAdded = scoreToAdd;
        this.lastScoreAddedText = `+${scoreToAdd}`;
        this.lastScoreAddedTime = 1;
    }

    public update(dt: number, updateBonus: boolean): void {
        if (this.score < this.scoreShown) {
            this.scoreShown = this.score;
        }
        this.scoreShown += Math.ceil((this.score - this.scoreShown) * dt);
        if (updateBonus) {
            if (this.lastScoreAddedTime < 1) {
                this.score += this.lastScoreAdded;
                this.lastScoreAdded = 0;
            }
            this.lastScoreAddedTime -= dt;
        }
    }

    public draw(alpha: number): void {
        const fontDiffuseColor = new Vec4(1, 1, 1, alpha);
        const fontEmissiveColor = new Vec4(0, 0, 0, alpha);
        setHudLight();

        const zDepth = 50;
        this.font.addText(
            `Score: ${this.scoreShown}`,
            new Vec3(0.2, 0.6, -1).multiplyScalar(zDepth),
            1,
            fontDiffuseColor,
            fontEmissiveColor,
        );

        if (this.lastScoreAddedTime > 0) {
            const c = new Vec4(1, 1, 1, this.lastScoreAddedTime);
            const e = new Vec4(0, 0, 0, this.lastScoreAddedTime);
            this.font.addText(
                this.lastScoreAddedText,
                new Vec3(0.7, 0.6 - this.lastScoreAddedTime, -1).multiplyScalar(zDepth),
                1,
                c,
                e,
            );
        }

        applyHudCamera(this.font, new Vec3(0, 0, 1));
        this.font.flush(true);
    }
}

/** Port of TimeBoard.cs. */
export class TimeBoard {
    private time = 0;
    private timeStart = 0;
    private timeLeft = 0;
    private timeLeftShown = 0;
    private lastBonus = 0;
    private lastBonusText = "";
    private lastBonusTime = 0;
    private readonly font: SQFont;

    public constructor(font: SQFont) {
        this.font = font;
    }

    public get Time(): number {
        return this.time;
    }

    public set Time(value: number) {
        this.time = value;
    }

    public get TimeStart(): number {
        return this.timeStart;
    }

    public set TimeStart(value: number) {
        this.timeStart = value;
    }

    public get TimeLeft(): number {
        return this.timeLeft;
    }

    public update(totalGameTime: number, dt: number, updateBonus: boolean): void {
        this.timeLeft = this.time - (totalGameTime - this.timeStart);
        this.timeLeftShown += (this.timeLeft - this.timeLeftShown) * Math.min(dt * 3, 1);
        if (updateBonus) {
            this.time += this.lastBonus;
            this.lastBonus = 0;
            this.lastBonusTime -= dt;
        }
    }

    public addTimeBonus(bonus: number): void {
        this.lastBonus = bonus;
        this.lastBonusText = `+${bonus.toFixed(2).padStart(5, "0")}`;
        this.lastBonusTime = bonus > 0 ? 1 : 0;
    }

    public draw(alpha: number): void {
        const fontDiffuseColor = new Vec4(1, 1, 1, alpha);
        const fontEmissiveColor = new Vec4(0, 0, 0, alpha);
        setHudLight();

        const zDepth = 50;
        const shown = this.timeLeftShown < 0 ? 0 : this.timeLeftShown;
        const timeLeftText = shown.toFixed(2).padStart(5, "0");
        this.font.addText(
            `Time: ${timeLeftText}`,
            new Vec3(-0.9, 0.6, -1).multiplyScalar(zDepth),
            1,
            fontDiffuseColor,
            fontEmissiveColor,
        );

        if (this.lastBonusTime > 0) {
            const c = new Vec4(1, 1, 1, this.lastBonusTime);
            const e = new Vec4(0, 0, 0, this.lastBonusTime);
            this.font.addText(
                this.lastBonusText,
                new Vec3(-0.55, 0.6 - this.lastBonusTime, -1).multiplyScalar(zDepth),
                1,
                c,
                e,
            );
        }

        applyHudCamera(this.font, new Vec3(0, 0, 1));
        this.font.flush(true);
    }
}

/** Port of Countdown.cs. */
export class Countdown {
    private timeLeft: number;
    private readonly font: SQFont;

    public constructor(font: SQFont, timeLeft: number) {
        this.font = font;
        this.timeLeft = timeLeft;
    }

    public get TimeLeft(): number {
        return this.timeLeft;
    }

    public update(dt: number): boolean {
        this.timeLeft -= dt;
        if (this.timeLeft < 0) {
            this.timeLeft = 0;
        }
        return this.timeLeft > 0;
    }

    public draw(alpha: number): void {
        if (this.timeLeft <= 0) {
            return;
        }
        const fontDiffuseColor = new Vec4(1, 1, 1, alpha);
        const fontEmissiveColor = new Vec4(0, 0, 0, alpha);
        setHudLight();

        const zDepth = 40;
        this.font.addText(
            String(Math.ceil(this.timeLeft)),
            new Vec3(0, 0, -1).multiplyScalar(zDepth),
            1,
            fontDiffuseColor,
            fontEmissiveColor,
        );
        applyHudCamera(this.font, new Vec3(0, 0, 1));
        this.font.flush(alpha < 1);
    }
}

/** Port of Praising.cs. */
const PRAISE_PHRASES = ["awesome", "excellent", "superior", "   neat", "nice", "   good", " finally..."];

export class Praising {
    private readonly praiseAnimation = new Animation(1);
    private sqs: SuperQuadric[] = [];
    private currentPraisePhraseIndex = 0;
    private readonly rnd = makeRandom(987654);
    private readonly font: SQFont;

    public constructor(font: SQFont) {
        this.font = font;
    }

    public update(totalGameTime: number): void {
        this.praiseAnimation.update(totalGameTime);
    }

    public startPraising(totalGameTime: number, quicknessInSeconds: number): void {
        this.praiseAnimation.start(totalGameTime);
        this.sqs = [];

        const fontDiffuseColor = new Vec4(1, 0.4, 0.1, 1);
        const fontEmissiveColor = new Vec4(1, 0.4, 0.1, 1);

        this.currentPraisePhraseIndex = Math.min(Math.floor(quicknessInSeconds), PRAISE_PHRASES.length - 1);
        const phrase = PRAISE_PHRASES[this.currentPraisePhraseIndex] ?? "";

        const zDepth = 50;
        this.font.addText(phrase, new Vec3(-0.5, -0.8, -1).multiplyScalar(zDepth), 1, fontDiffuseColor, fontEmissiveColor);
        // Build the quads now (GetText equivalent) into a private list.
        this.sqs = this.font.takeQueuedQuads();

        const fuzzingSize = 100;
        void fuzzingSize;
        const curve = new Curve();
        curve.addKey(0, 0, 0, 0);
        curve.addKey(1, 1, 0, 0);

        for (const sq of this.sqs) {
            const startKey = cloneSQ(sq);
            const endKey = cloneSQ(sq);
            endKey.colorEmissive = new Vec4(0, 0, 0, 1);
            endKey.colorDiffuse = new Vec4(
                1 - startKey.colorEmissive.x,
                1 - startKey.colorEmissive.y,
                1 - startKey.colorEmissive.z,
                startKey.colorDiffuse.w,
            );
            const dir = new Vec3(this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() + 0.1).normalize();
            endKey.world = new Mat4().setTranslation(Vec3.scale(dir, 100));
            endKey.sqParams = new Vec4(0.5, 0.5, -10, 1);
            sq.praiseAnimation = new SQKeyframeAnimation(curve, [startKey, endKey]);
        }
    }

    public draw(alpha: number): void {
        if (!this.praiseAnimation.isRunning) {
            return;
        }

        const animScaled = this.praiseAnimation.progress * 3;
        const flyInAnimValue = 1 - Math.min(1, animScaled);
        const flyInAnimRadiant = flyInAnimValue * Math.PI;
        const flyInAnimRadius = 30;
        const specularAnimValue = Math.min(1, Math.max(1, animScaled) - 1);
        const disperseAnimValue = Math.min(1, Math.max(2, animScaled) - 2);

        if (disperseAnimValue > 0) {
            for (const sq of this.sqs) {
                if (sq.praiseAnimation !== undefined) {
                    sq.praiseAnimation.apply(sq, disperseAnimValue);
                }
            }
        }

        const viewPosition = new Vec3(
            Math.sin(flyInAnimRadiant) * flyInAnimRadius,
            0,
            Math.cos(flyInAnimRadiant) * flyInAnimRadius,
        );
        const fontPos = new Vec3(0, 0, -50);
        const viewMatrix = Mat4.createLookAt(viewPosition, fontPos, Vec3.up);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 550);

        const theta = (1 - specularAnimValue) * (Math.PI * 2 - Math.PI * 0.5);
        const phi = specularAnimValue * 3 - 1;
        SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());

        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        this.font.drawSuperQuadrics(this.sqs, viewPosition, viewMatrix, projMatrix, alpha < 1);
        void alpha;
    }
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

function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}