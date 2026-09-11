import { Camera, Scene } from "three";
import { Animation } from "./Animation.ts";
import { Curve } from "./Curve.ts";
import { SuperQuadric, SuperQuadricBatch, applyXnaCamera } from "./SuperQuadric.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

function setMenuLight(): void {
    const theta = 0.5;
    const phi = 2.5;
    SuperQuadric.setLightDir(Mat4.createFromYawPitchRoll(phi, theta, 0).forward());
}

export class MenuBackGroundRenderer {
    private readonly sqs: SuperQuadric[] = [];
    private readonly batch: SuperQuadricBatch;
    private prevColor = Vec4.one.clone();
    private mainColor = Vec4.one.clone();
    private readonly colorAnimationCurve = Curve.smoothStep();
    private readonly positionAnimationCurve = Curve.bell();
    private readonly animation = new Animation(1.5);

    public constructor() {
        const numQuadrics = 1600;
        for (let n = 0; n < numQuadrics; n++) {
            const sq = new SuperQuadric();
            sq.sqParams = new Vec4(0.1, 0.1, -10, 1);
            sq.colorEmissive = new Vec4(0, 0, 0, 0.3);
            this.sqs.push(sq);
        }
        this.batch = new SuperQuadricBatch(16, numQuadrics, false);
    }

    public get mesh() {
        return this.batch.mesh;
    }

    public startAnimation(totalSeconds: number, targetColor: Vec4): void {
        if (this.animation.isRunning) {
            const lerp = this.colorAnimationCurve.evaluate(this.animation.progress);
            this.prevColor = Vec4.lerp(this.prevColor, this.mainColor, lerp);
        } else {
            this.prevColor = this.mainColor.clone();
        }
        this.mainColor = targetColor.clone();
        this.animation.start(totalSeconds);
    }

    private getPosition(rad: number, radius: number): Vec3 {
        const x1 = Math.sin(rad) * radius;
        const y1 = Math.cos(rad) * radius;
        const x2 = Math.sin(rad + x1) * radius;
        const y2 = Math.cos(rad + y1) * radius;
        const z2 = Math.cos(rad + (x1 + x2) * 0.2) * radius;
        return new Vec3(x2, y2, z2);
    }

    public update(totalSeconds: number): void {
        this.animation.update(totalSeconds);

        if (this.animation.isRunning) {
            for (const sq of this.sqs) {
                const progress = this.animation.progress;
                const lerp = this.colorAnimationCurve.evaluate(progress);
                const moveProgress = this.positionAnimationCurve.evaluate(progress * 2);
                sq.sqParams = new Vec4(0.2 + moveProgress * 0.8, 0.2, -10, 1);
                sq.colorDiffuse = Vec4.lerp(this.prevColor, this.mainColor, lerp);
            }
        }

        const rotationSpeed = totalSeconds * 0.005;
        const invSQSCount = (1 / this.sqs.length) * 2 * Math.PI;
        for (let n = 0; n < this.sqs.length; n++) {
            const sq = this.sqs[n];
            if (sq === undefined) {
                continue;
            }
            const rad = n * invSQSCount + rotationSpeed;
            const pos = this.getPosition(rad, 25.3);
            sq.world = Mat4.createBillboard(pos, Vec3.zero, Vec3.up, Vec3.forward);
        }

        this.batch.setInstances(this.sqs);
    }

    public applyCamera(camera: Camera): void {
        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        setMenuLight();

        const viewPosition = new Vec3(0, 0, 33);
        const viewTarget = new Vec3(0, 0, 0);
        const upDir = Vec3.normalize(new Vec3(0.3, 0.8, 0.3));
        const viewMatrix = Mat4.createLookAt(viewPosition, viewTarget, upDir);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 150);
        applyXnaCamera(camera, viewMatrix, projMatrix);
        this.batch.setGlobals(viewPosition);
    }
}

export class BackGroundRenderer {
    private readonly sqs: SuperQuadric[] = [];
    private readonly batch: SuperQuadricBatch;
    private prevColor = Vec4.one.clone();
    private mainColor = Vec4.one.clone();
    private readonly colorAnimationCurve = Curve.smoothStep();
    private readonly positionAnimationCurve = Curve.bell();
    private readonly animation = new Animation(1.5);
    private readonly z = -20;

    public constructor() {
        for (let y = 3; y < 9; y++) {
            for (let x = 2; x < 9; x++) {
                const sq = new SuperQuadric();
                sq.world.setTranslation(new Vec3(x, y, this.z));
                sq.sqParams = new Vec4(0.1, 0.1, -10, 1);
                sq.colorEmissive = new Vec4(0, 0, 0, 0.3);
                this.sqs.push(sq);
            }
        }
        this.batch = new SuperQuadricBatch(32, this.sqs.length, false);
    }

    public get mesh() {
        return this.batch.mesh;
    }

    public startAnimation(totalSeconds: number, targetColor: Vec4): void {
        if (this.animation.isRunning) {
            const lerp = this.colorAnimationCurve.evaluate(this.animation.progress) + 0.35;
            this.prevColor = Vec4.lerp(this.prevColor, this.mainColor, lerp);
        } else {
            this.prevColor = this.mainColor.clone();
        }
        this.mainColor = targetColor.clone();
        this.animation.start(totalSeconds);
    }

    public update(totalSeconds: number): void {
        this.animation.update(totalSeconds);

        if (this.animation.isRunning) {
            for (let n = 0; n < this.sqs.length; n++) {
                const sq = this.sqs[n];
                if (sq === undefined) {
                    continue;
                }
                const bias = Math.cos(n) * 0.5 + 0.5;
                const progress = Math.min(1, Math.max(0, this.animation.progress + this.animation.progress * bias));
                const lerp = this.colorAnimationCurve.evaluate(progress);
                sq.colorDiffuse = Vec4.lerp(this.prevColor, this.mainColor, lerp);
                const pos = sq.world.translation();
                const moveProgress = this.positionAnimationCurve.evaluate(progress * 2);
                sq.world.setTranslation(new Vec3(pos.x, pos.y, this.z + moveProgress * 0.2));
                sq.sqParams = new Vec4(0.1 + moveProgress * 0.1, 0.1 + moveProgress * 0.1, -10, 1);
            }
        }

        this.batch.setInstances(this.sqs);
    }

    public applyCamera(camera: Camera): void {
        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        setMenuLight();

        const viewPosition = new Vec3(5.3, 4.25, this.z + 2.25);
        const viewTarget = new Vec3(5.2, 4.7, this.z);
        const upDir = Vec3.normalize(new Vec3(0.3, 0.8, 0.3));
        const viewMatrix = Mat4.createLookAt(viewPosition, viewTarget, upDir);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 150);
        applyXnaCamera(camera, viewMatrix, projMatrix);
        this.batch.setGlobals(viewPosition);
    }
}

export class BackgroundScreen {
    public readonly menuScene = new Scene();
    public readonly gridScene = new Scene();
    public readonly menuCamera = new Camera();
    public readonly gridCamera = new Camera();
    public readonly menuRenderer: MenuBackGroundRenderer;
    public readonly gridRenderer: BackGroundRenderer;

    public constructor() {
        this.menuRenderer = new MenuBackGroundRenderer();
        this.gridRenderer = new BackGroundRenderer();
        this.menuScene.add(this.menuRenderer.mesh);
        this.gridScene.add(this.gridRenderer.mesh);
        this.startAnimation(0, new Vec4(1, 1, 1, 1));
    }

    public startAnimation(totalSeconds: number, targetColor1: Vec4, targetColor2 = new Vec4(1.5, 1.5, 1.5, 1)): void {
        this.menuRenderer.startAnimation(totalSeconds, targetColor1);
        this.gridRenderer.startAnimation(totalSeconds, targetColor2);
    }

    public update(totalSeconds: number): void {
        this.menuRenderer.update(totalSeconds);
        this.gridRenderer.update(totalSeconds);
        this.menuRenderer.applyCamera(this.menuCamera);
        this.gridRenderer.applyCamera(this.gridCamera);
    }
}
