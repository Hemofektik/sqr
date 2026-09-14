/**
 * LoadingSpinner - a ring of superquadrics orbiting while the gallery icons
 * load, in the spirit of the menu swarm (MenuBackGroundRenderer).
 */
import { Camera, Scene } from "three";
import { SuperQuadric, SuperQuadricBatch, applyXnaCamera } from "./SuperQuadric.ts";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

export class LoadingSpinner {
    private readonly sqs: SuperQuadric[] = [];
    private readonly batch: SuperQuadricBatch;
    public readonly scene = new Scene();
    public readonly camera = new Camera();

    public constructor(numQuadrics = 64) {
        for (let n = 0; n < numQuadrics; n++) {
            const sq = new SuperQuadric();
            sq.sqParams = new Vec4(0.2, 0.2, -10, 1);
            sq.colorEmissive = new Vec4(0, 0, 0, 0.3);
            this.sqs.push(sq);
        }
        this.batch = new SuperQuadricBatch(16, numQuadrics, false);
        this.scene.add(this.batch.mesh);
    }

    /** Animates the ring and prepares it for rendering. */
    public update(totalSeconds: number): void {
        const rotationSpeed = totalSeconds * 1.5;
        const invCount = (1 / this.sqs.length) * 2 * Math.PI;
        for (let n = 0; n < this.sqs.length; n++) {
            const sq = this.sqs[n];
            if (sq === undefined) {
                continue;
            }
            const rad = n * invCount + rotationSpeed;
            const radius = 8;
            const pos = new Vec3(Math.sin(rad) * radius, Math.cos(rad) * radius, 0);
            sq.world = Mat4.createBillboard(pos, Vec3.zero, Vec3.up, Vec3.forward);
            // Fade the tail of the swarm out.
            const fade = 0.5 + 0.5 * Math.sin(rad * 2 + totalSeconds * 2);
            sq.colorDiffuse = new Vec4(1, 0.7, 0.2, 0.5 + fade * 0.5);
        }
        this.batch.setInstances(this.sqs);

        const viewPosition = new Vec3(0, 0, 33);
        const viewMatrix = Mat4.createLookAt(viewPosition, new Vec3(0, 0, 0), Vec3.up);
        const projMatrix = Mat4.createPerspectiveOffCenter(-1.6, 1.6, -0.9, 0.9, 1, 150);
        applyXnaCamera(this.camera, viewMatrix, projMatrix);
        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        this.batch.setGlobals(viewPosition);
    }
}