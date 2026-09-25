/**
 * RaceVessel - port of Celeritas/RaceVessel.cs: the spring-driven racing
 * ship with ground/side collision rays against the track.
 */
import { Mat4, Quat, Vec3, Vec4 } from "../XnaMath.ts";
import { SuperQuadric } from "../SuperQuadric.ts";
import {
    CollisionResponseSpring,
    DistanceSpring,
    Motor,
    PhysicsObject,
    StayUprightConstraint,
    TorqueSpring,
} from "./Physics.ts";
import type { RaceTrack } from "./RaceTrack.ts";

function rowVec(m: Mat4, row: number): Vec3 {
    const e = m.elements;
    return new Vec3(e[row * 4] ?? 0, e[row * 4 + 1] ?? 0, e[row * 4 + 2] ?? 0);
}

/** Bounciness of the hull against the track border (robustness addition). */
const SIDE_RESTITUTION = 0.5;
/**
 * The distance spring's target freezes at the last road hit while the down
 * ray misses. Once the stretch exceeds this limit the ship would be pinned
 * against the motor's thrust, so the suspension is released instead.
 */
const STALE_SPRING_LIMIT = 6;
/** Consecutive down-ray misses before the border bounce kicks in (lets
 * transient mid-road ray holes pass without deflecting the ship). */
const MISS_STREAK_BOUNCE = 3;
/** How close the last road point must be for a departure to count as a
 * border hit rather than free flight beyond the track. */
const BORDER_BOUNCE_RANGE = 30;
/** Bounciness when leaving the track over the border. */
const BORDER_RESTITUTION = 0.5;
/** Max yaw per frame while border-bouncing (radians), swinging the hull
 * back toward the road so the motor drives the ship home. */
const BORDER_YAW_RATE = 0.12;

export class RaceVessel extends PhysicsObject {
    public speedMax: number;
    public steeringSpeedMax: Vec3;
    public steeringAccelerationScale: Vec3;

    private readonly raceTrack: RaceTrack;
    private readonly stayUprightConstraint: StayUprightConstraint;
    private readonly distanceSpring: DistanceSpring;
    private readonly motor: Motor;
    private readonly steeringThruster: TorqueSpring;
    private readonly groundCollision: CollisionResponseSpring;
    private readonly sideCollision: CollisionResponseSpring;

    /** Draw state: local voxel matrices + their shared SuperQuadrics. */
    private readonly sqLocals: { sq: SuperQuadric; local: Mat4 }[] = [];
    public readonly sqs: SuperQuadric[] = [];

    public trackNormal = new Vec3(0, 0, 0);
    private steeringAmount = new Vec3(0, 0, 0);
    private accelerationAmount = 0;
    private accelerationAmountDelta = 0;

    /** Consecutive down-ray misses (border bounce arming). */
    private missStreak = 0;

    /** Rotation used for the current draw (incl. steering roll), for lighting. */
    public lastDrawRotation = Quat.identity();

    public constructor(raceTrack: RaceTrack) {
        super(1, 1);
        this.raceTrack = raceTrack;
        this.speedMax = 2500;
        this.steeringSpeedMax = new Vec3(500, 550, 0);
        this.steeringAccelerationScale = new Vec3(30, 100, 0);

        this.stayUprightConstraint = new StayUprightConstraint(Vec3.up, 200, 40);
        this.distanceSpring = new DistanceSpring(new Vec3(0, 0, 0), 1000, 20, 0.5);
        this.motor = new Motor(100, 1);
        this.steeringThruster = new TorqueSpring(400, 100);
        this.groundCollision = new CollisionResponseSpring(false, 10000, 200);
        this.sideCollision = new CollisionResponseSpring(false, 20000, 200);

        this.addSpring(this.stayUprightConstraint);
        this.addSpring(this.distanceSpring);
        this.addSpring(this.motor);
        this.addSpring(this.steeringThruster);
        this.addSpring(this.groundCollision);
        this.addSpring(this.sideCollision);

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
        return this.physicalPosition;
    }

    public set position(value: Vec3) {
        this.physicalPosition = value;
        this.distanceSpring.position = Vec3.add(value, Vec3.up);
    }

    public get rotation(): Quat {
        return this.physicalRotation;
    }

    public set rotation(value: Quat) {
        this.physicalRotation = value;
    }

    public get speed(): number {
        return this.physicalVelocity.length();
    }

    public set velocityVector(value: Vec3) {
        this.physicalVelocity = value;
    }

    /** Port of RaceVessel.Update. */
    public update(time: number, deltaTime: number): void {
        this.updatePhysicsConstantTimeStep(time, deltaTime);

        const rotation = this.physicalRotation.toMat4();
        const up = rowVec(rotation, 1);
        const down = Vec3.scale(up, -1);
        const right = rowVec(rotation, 0);
        const left = Vec3.scale(right, -1);

        // Collision ray down.
        {
            const ray = { position: Vec3.add(this.position, Vec3.scale(up, 5)), direction: down };
            let hit = this.raceTrack.firstTrackHit(ray);
            if (hit === undefined) {
                // Robustness: when the hull rolls at the border the tilted
                // ray can graze past a surface that is still directly below -
                // retry vertically before declaring a miss.
                hit = this.raceTrack.firstTrackHit({
                    position: Vec3.add(this.position, new Vec3(0, 5, 0)),
                    direction: new Vec3(0, -1, 0),
                });
            }
            if (hit !== undefined) {
                this.missStreak = 0;
                this.stayUprightConstraint.targetOrientation = hit.normal;
                this.distanceSpring.position = hit.position;

                const sizeOfMesh = 1;
                const distanceToCollisionPoint = Vec3.sub(hit.position, this.position).length();
                const penetrationDepth = sizeOfMesh - distanceToCollisionPoint;
                if (penetrationDepth > 0) {
                    this.groundCollision.normal = hit.normal;
                    this.groundCollision.penetrationDepth = penetrationDepth;
                    this.groundCollision.enabled = true;
                    this.trackNormal = hit.normal;
                } else {
                    this.groundCollision.enabled = false;
                }
            } else {
                this.groundCollision.enabled = false;
                this.missStreak++;
                // Robustness (not in the original): the frozen distance-spring
                // target keeps pulling toward the last road point forever,
                // which pins the ship once the ray misses for good (e.g. after
                // leaving the border). Beyond a stretch the original would
                // never recover from, release the suspension so the vessel
                // coasts free until the ray hits the track again.
                const stale = Vec3.sub(this.distanceSpring.position, this.position);
                if (stale.length() > STALE_SPRING_LIMIT) {
                    const upNow = rowVec(this.physicalRotation.toMat4(), 1);
                    // Rest length of the DistanceSpring (0.5).
                    this.distanceSpring.position = Vec3.add(this.position, Vec3.scale(upNow, 0.5));
                }
                // Border bounce: once the miss persists the ship is leaving
                // over the track border - find the nearest road point and
                // reflect the motion directly away from it so the ship bounces
                // back instead of escaping or getting captured at the edge.
                // (A frozen last-hit point would go stale under tangential
                // travel; the nearest point tracks the ship each frame.)
                if (this.missStreak >= MISS_STREAK_BOUNCE) {
                    const away = Vec3.sub(this.position, this.raceTrack.nearestRoadPoint(this.position));
                    // Horizontal only: the ship may be descending toward the
                    // road while sliding off it sideways - the reflection must
                    // act on the lateral escape, not the vertical motion.
                    away.y = 0;
                    const dist = away.length();
                    if (dist > 1e-3 && dist < BORDER_BOUNCE_RANGE) {
                        const dir = Vec3.scale(away, 1 / dist);
                        const velocity = this.physicalVelocity;
                        const awaySpeed = dir.x * velocity.x + dir.z * velocity.z;
                        if (awaySpeed > 0) {
                            const vx = velocity.x - (1 + BORDER_RESTITUTION) * awaySpeed * dir.x;
                            const vz = velocity.z - (1 + BORDER_RESTITUTION) * awaySpeed * dir.z;
                            this.physicalVelocity = new Vec3(vx, velocity.y, vz);
                        }
                        // Swing the hull back toward the road so the motor
                        // drives the ship home instead of re-accelerating
                        // off the edge (velocity reflections alone cannot
                        // overcome a nose that still points outward).
                        const backward = rowVec(rotation, 2);
                        const hl = Math.hypot(backward.x, backward.z) || 1;
                        const nx = backward.x / hl;
                        const nz = backward.z / hl;
                        const toX = -dir.x;
                        const toZ = -dir.z;
                        const crossY = nz * toX - nx * toZ;
                        const dotT = nx * toX + nz * toZ;
                        const yawErr = Math.max(
                            -BORDER_YAW_RATE,
                            Math.min(BORDER_YAW_RATE, Math.atan2(crossY, dotT)),
                        );
                        this.physicalRotation = Quat.createFromYawPitchRoll(yawErr, 0, 0).multiply(this.physicalRotation);
                    }
                }
            }
        }

        // Collision rays to the side. The original fired only a rightward ray
        // and could keep the spring enabled with a stale normal when the
        // surface faced away - both allowed the border to capture the ship.
        // A wall hit now bounces the hull instead.
        {
            const sizeOfMesh = 2;
            const rays = [
                { position: Vec3.add(this.position, Vec3.scale(left, sizeOfMesh)), direction: right },
                { position: Vec3.add(this.position, Vec3.scale(right, sizeOfMesh)), direction: left },
            ];
            let wallNormal: Vec3 | undefined;
            let wallPenetration = 0;
            for (const ray of rays) {
                const hit = this.raceTrack.firstTrackHit(ray);
                if (hit === undefined || Vec3.dot(hit.normal, ray.direction) > -0.5) {
                    continue; // miss, or surface faces away - not a wall
                }
                const distanceToCollisionPoint = Vec3.sub(hit.position, this.position).length();
                const penetrationDepth = sizeOfMesh - distanceToCollisionPoint;
                if (penetrationDepth > 0) {
                    wallNormal = hit.normal;
                    wallPenetration = penetrationDepth;
                    break;
                }
            }
            if (wallNormal !== undefined) {
                this.sideCollision.normal = wallNormal;
                this.sideCollision.penetrationDepth = wallPenetration;
                this.sideCollision.enabled = true;
                // Bounce: pop the hull back out of the wall and reflect the
                // velocity along its normal with restitution.
                this.physicalPosition = Vec3.add(this.position, Vec3.scale(wallNormal, wallPenetration));
                const velocity = this.physicalVelocity;
                const normalVelocity = Vec3.dot(velocity, wallNormal);
                if (normalVelocity < 0) {
                    this.physicalVelocity = Vec3.sub(
                        velocity,
                        Vec3.scale(wallNormal, (1 + SIDE_RESTITUTION) * normalVelocity),
                    );
                }
            } else {
                this.sideCollision.enabled = false;
            }
        }

        this.accelerationAmount += (this.speedMax - this.accelerationAmount) * this.accelerationAmountDelta * deltaTime;
        this.accelerationAmount -= this.accelerationAmount * 0.5 * deltaTime;
        this.accelerationAmountDelta = 0;

        this.motor.tightness = (Math.abs(this.accelerationAmount) / this.speedMax) * 10;
        this.motor.targetVelocity = Vec3.scale(rowVec(rotation, 2), this.accelerationAmount);

        this.steeringAmount.x *= 0.5 - deltaTime;
        this.steeringAmount.y *= 0.5 - deltaTime;
        this.steeringAmount.z *= 0.5 - deltaTime;
        this.steeringThruster.tightness = 1;
        this.steeringThruster.targetTorque = this.steeringAmount.clone();
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

    /** Port of Accelerate. */
    public accelerate(amount: number): void {
        this.accelerationAmountDelta += amount;
    }

    /**
     * Port of RaceVessel.Draw's matrix setup: composes each voxel's local
     * matrix with the vessel world (incl. steering roll) so the batch can
     * draw them, and returns the composed rotation for the light transform.
     */
    public prepareDraw(): Quat {
        const roll = Quat.createFromYawPitchRoll(0, 0, -this.steeringAmount.y * 0.01);
        const vesselRotation = this.physicalRotation.multiply(roll);
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
