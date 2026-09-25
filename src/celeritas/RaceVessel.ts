/**
 * RaceVessel - the Celeritas racing ship, driven by Rapier rigid-body
 * physics: gravity, a four-ray suspension, contacts against the track
 * trimesh, thrust and steering torques. Deliberate deviation from the
 * original XNA spring physics so the ship can go airborne, jump off the
 * terrain, land and bounce instead of being glued to the road.
 */
import { Mat4, Quat, Vec3, Vec4 } from "../XnaMath.ts";
import { SuperQuadric } from "../SuperQuadric.ts";
import { FIXED_STEP, type CeleritasWorld } from "./RacePhysics.ts";
import type { RaceTrack } from "./RaceTrack.ts";

function rowVec(m: Mat4, row: number): Vec3 {
    const e = m.elements;
    return new Vec3(e[row * 4] ?? 0, e[row * 4 + 1] ?? 0, e[row * 4 + 2] ?? 0);
}

function wrapPi(a: number): number {
    if (a < -Math.PI) return a + Math.PI * 2;
    if (a > Math.PI) return a - Math.PI * 2;
    return a;
}

/** Suspension ray reach - the hover gap below the hull corners. Must keep
 * margin over the equilibrium compression (m*g*cos(theta)/(4K)), otherwise
 * rays miss on tilted banks and the hull bottoms out into a friction lock. */
const SUSPENSION_LENGTH = 1.6;
/** Spring stiffness / damping per suspension ray (total ship mass is 1). */
const SUSPENSION_K = 60;
const SUSPENSION_DAMPING = 5;
/** Lateral grip while grounded: slip along the hull's right axis is damped
 * and capped at mu * spring load (Coulomb). Without this a hovering hull
 * slides straight down the track's steep banks - the original only held on
 * because its springs accidentally pulled sideways toward the road point. */
const GRIP_K = 8;
const GRIP_MU = 2;
/** Full-throttle force; with the body's linear damping (0.65) the top
 * speed settles around 400 m/s. */
const THRUST = 260;
/** Steering torque scales (steeringAmount keeps the original's units).
 * Sized against the hull's inertia and angular damping: at full input the
 * yaw must reach ~0.5 rad/s to hold a 1000-radius turn at 300 m/s. */
const YAW_TORQUE = 0.5;
const PITCH_TORQUE = 0.3;
/** Self-righting assist toward world up, in world axes like the original
 * StayUprightConstraint but fighting real angular velocity. */
const UPRIGHT_K = 50;
const UPRIGHT_DAMPING = 4;
/** Below this height the ship has fallen out of the world: respawn. */
const RESPAWN_Y = -200;

export class RaceVessel {
    public steeringSpeedMax: Vec3;
    public steeringAccelerationScale: Vec3;

    private readonly phys: CeleritasWorld;
    private readonly raceTrack: RaceTrack;

    /** Draw state: local voxel matrices + their shared SuperQuadrics. */
    private readonly sqLocals: { sq: SuperQuadric; local: Mat4 }[] = [];
    public readonly sqs: SuperQuadric[] = [];

    public trackNormal = new Vec3(0, 1, 0);
    private steeringAmount = new Vec3(0, 0, 0);
    private throttle = 0;
    private accumulator = 0;

    /** Rotation used for the current draw (incl. steering roll), for lighting. */
    public lastDrawRotation = Quat.identity();

    public constructor(phys: CeleritasWorld, raceTrack: RaceTrack) {
        this.phys = phys;
        this.raceTrack = raceTrack;
        this.steeringSpeedMax = new Vec3(500, 550, 0);
        this.steeringAccelerationScale = new Vec3(30, 100, 0);

        // Voxel grid hull (zBias wedge filter ported verbatim).
        const scale = 0.2;
        for (let z = -5; z < 15; z++) {
            for (let y = 0; y < 2; y++) {
                for (let x = -5; x < 6; x++) {
                    const zBias = Math.abs(x) * 3 - z;
                    if (zBias < 2 || zBias > 14) {
                        continue;
                    }
                    const vesselSQ = new SuperQuadric();
                    const local = Mat4.createWorld(new Vec3(scale * x, scale * y, scale * z), new Vec3(0, 0, -1), Vec3.up);
                    vesselSQ.world = local;
                    vesselSQ.sqParams = new Vec4(0.3, 0.3, 0, 0);
                    vesselSQ.dimension = new Vec3(0.1, 0.1, 0.1);
                    vesselSQ.colorDiffuse = x % 2 !== 0 ? new Vec4(0, 0, 1, 1) : new Vec4(0, 0, 0.5, 1);
                    vesselSQ.colorEmissive = new Vec4(0, 0, 0, 1);
                    this.sqLocals.push({ sq: vesselSQ, local });
                    this.sqs.push(vesselSQ);
                }
            }
        }
    }

    public get position(): Vec3 {
        const t = this.phys.ship.translation();
        return new Vec3(t.x, t.y, t.z);
    }

    public set position(value: Vec3) {
        this.phys.ship.setTranslation({ x: value.x, y: value.y, z: value.z }, true);
    }

    public get rotation(): Quat {
        const r = this.phys.ship.rotation();
        return new Quat(r.x, r.y, r.z, r.w);
    }

    public set rotation(value: Quat) {
        this.phys.ship.setRotation({ x: value.x, y: value.y, z: value.z, w: value.w }, true);
    }

    public get speed(): number {
        const v = this.phys.ship.linvel();
        return Math.hypot(v.x, v.y, v.z);
    }

    public set velocityVector(value: Vec3) {
        this.phys.ship.setLinvel({ x: value.x, y: value.y, z: value.z }, true);
    }

    /** Fixed-step rigid-body update: suspension, thrust, steering, upright. */
    public update(_time: number, deltaTime: number): void {
        this.accumulator += Math.min(deltaTime, 0.1);
        while (this.accumulator >= FIXED_STEP) {
            this.stepPhysics(FIXED_STEP);
            this.accumulator -= FIXED_STEP;
        }

        // Steering input decays between frames (as in the original).
        this.steeringAmount.x *= 0.5 - deltaTime;
        this.steeringAmount.y *= 0.5 - deltaTime;
        this.steeringAmount.z *= 0.5 - deltaTime;

        // Failsafe: never fall out of the world - respawn on the track.
        if (this.position.y < RESPAWN_Y) {
            const road = this.raceTrack.nearestRoadPoint(this.position);
            this.position = Vec3.add(road, new Vec3(0, 6, 0));
            this.velocityVector = new Vec3(0, 0, 0);
        }
    }

    private stepPhysics(dt: number): void {
        const body = this.phys.ship;
        const rotation = this.rotation.toMat4();
        const right = rowVec(rotation, 0);
        const up = rowVec(rotation, 1);
        const forward = rowVec(rotation, 2); // thrust axis (image of +Z)
        const position = this.position;
        const linvel = body.linvel();
        const omega = body.angvel();

        // Suspension: four downward rays with a push-only spring-damper.
        // Push-only matters: nothing pulls the ship toward the road, so it
        // leaves the ground and jumps instead of being glued down.
        let grounded = false;
        const corners = [
            new Vec3(-0.8, 0.1, -0.8),
            new Vec3(0.8, 0.1, -0.8),
            new Vec3(-0.8, 0.1, 2.0),
            new Vec3(0.8, 0.1, 2.0),
        ];
        for (const corner of corners) {
            const origin = new Vec3(
                position.x + right.x * corner.x + up.x * corner.y + forward.x * corner.z,
                position.y + right.y * corner.x + up.y * corner.y + forward.y * corner.z,
                position.z + right.z * corner.x + up.z * corner.y + forward.z * corner.z,
            );
            const hit = this.phys.castRay(origin, Vec3.scale(up, -1), SUSPENSION_LENGTH);
            if (hit === undefined) {
                continue;
            }
            grounded = true;
            this.trackNormal = hit.normal;
            const contact = new Vec3(
                origin.x - up.x * hit.toi,
                origin.y - up.y * hit.toi,
                origin.z - up.z * hit.toi,
            );
            const r = Vec3.sub(contact, position);
            const pointVel = Vec3.add(new Vec3(linvel.x, linvel.y, linvel.z), Vec3.cross(new Vec3(omega.x, omega.y, omega.z), r));
            const normalVel = Vec3.dot(pointVel, hit.normal);
            const force = SUSPENSION_K * (SUSPENSION_LENGTH - hit.toi) - SUSPENSION_DAMPING * normalVel;
            if (force > 0) {
                body.applyImpulseAtPoint(
                    { x: hit.normal.x * force * dt, y: hit.normal.y * force * dt, z: hit.normal.z * force * dt },
                    { x: contact.x, y: contact.y, z: contact.z },
                    true,
                );
                // Lateral grip: resist slip along the hull's right axis,
                // capped by Coulomb friction (mu * load) so it releases
                // before it can fight the thrust or steering.
                const latSpeed = Vec3.dot(pointVel, right);
                const grip = Math.max(-GRIP_MU * force, Math.min(GRIP_MU * force, -latSpeed * GRIP_K));
                if (grip !== 0) {
                    body.applyImpulseAtPoint(
                        { x: right.x * grip * dt, y: right.y * grip * dt, z: right.z * grip * dt },
                        { x: contact.x, y: contact.y, z: contact.z },
                        true,
                    );
                }
            }
        }

        // Thrust (works in the air too, like the original motor).
        if (this.throttle !== 0) {
            const impulse = this.throttle * THRUST * dt;
            body.applyImpulse(
                { x: forward.x * impulse, y: forward.y * impulse, z: forward.z * impulse },
                true,
            );
        }

        // Steering: torque around the hull's own axes (also works in the air).
        const pitch = this.steeringAmount.x * PITCH_TORQUE * dt;
        const yaw = this.steeringAmount.y * YAW_TORQUE * dt;
        body.applyTorqueImpulse(
            {
                x: right.x * pitch + up.x * yaw,
                y: right.y * pitch + up.y * yaw,
                z: right.z * pitch + up.z * yaw,
            },
            true,
        );
        // Self-righting assist: while grounded, hug the surface normal (like
        // the original StayUprightConstraint following the road); in the air,
        // level toward world up. Damped by real angular velocity.
        const target = grounded ? this.trackNormal : new Vec3(0, 1, 0);
        const errX = wrapPi(Math.atan2(up.y, up.z) - Math.atan2(target.y, target.z));
        const errZ = wrapPi(Math.atan2(up.x, up.y) - Math.atan2(target.x, target.y));
        body.applyTorqueImpulse(
            {
                x: (errX * UPRIGHT_K - omega.x * UPRIGHT_DAMPING) * dt,
                y: 0,
                z: (errZ * UPRIGHT_K - omega.z * UPRIGHT_DAMPING) * dt,
            },
            true,
        );

        this.phys.step(dt);
    }

    /** Port of Steer: accumulate clamped steering torque. */
    public steer(angularAmount: Vec3): void {
        const scaled = new Vec3(
            angularAmount.x * this.steeringAccelerationScale.x,
            angularAmount.y * this.steeringAccelerationScale.y,
            angularAmount.z * this.steeringAccelerationScale.z,
        );
        this.steeringAmount = new Vec3(
            Math.max(-this.steeringSpeedMax.x, Math.min(this.steeringSpeedMax.x, this.steeringAmount.x + scaled.x)),
            Math.max(-this.steeringSpeedMax.y, Math.min(this.steeringSpeedMax.y, this.steeringAmount.y + scaled.y)),
            Math.max(-this.steeringSpeedMax.z, Math.min(this.steeringSpeedMax.z, this.steeringAmount.z + scaled.z)),
        );
    }

    /** Port of Accelerate: throttle in [-1, 1], fed every frame. */
    public accelerate(amount: number): void {
        this.throttle = Math.max(-1, Math.min(1, amount));
    }

    /**
     * Port of RaceVessel.Draw's matrix setup: composes each voxel's local
     * matrix with the vessel world (incl. steering roll) so the batch can
     * draw them, and returns the composed rotation for the light transform.
     */
    public prepareDraw(): Quat {
        const roll = Quat.createFromYawPitchRoll(0, 0, -this.steeringAmount.y * 0.01);
        const vesselRotation = this.rotation.multiply(roll);
        this.lastDrawRotation = vesselRotation;
        const rotMat = vesselRotation.toMat4();
        // Port: Matrix.CreateWorld(Position, vesselRotation.Forward, vesselRotation.Up)
        const viewManipulation = Mat4.createWorld(this.position, rotMat.forward(), rotMat.up());
        for (const entry of this.sqLocals) {
            entry.sq.world = Mat4.multiply(entry.local, viewManipulation);
        }
        return vesselRotation;
    }
}
