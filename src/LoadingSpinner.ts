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

    public constructor(numQuadrics = 32) {
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

            // Animate the superquadric parameters based on the position on
            // the circle: n/e sweep through the full shape range (cube ->
            // sphere -> octahedron-ish), so every quadric on the ring shows a
            // different shape. The rounded-corner angle follows the position
            // too, giving beveled edges that rotate around the ring.
            const t = n / this.sqs.length;
            const wave = Math.sin(t * 2 * Math.PI + totalSeconds * 2);
            const shapeN = 0.2 + (wave * 0.5 + 0.5) * 1.8; // 0.2 .. 2.0
            const shapeE = 0.2 + (Math.cos(t * 2 * Math.PI + totalSeconds * 2) * 0.5 + 0.5) * 1.8;
            const roundedRadiant = t * 2 * Math.PI;
            sq.sqParams = new Vec4(shapeN, shapeE, roundedRadiant, 1);

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