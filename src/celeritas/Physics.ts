/**
 * Physics - port of Hemofektik/PhysicsObject.cs (Glenn Fiedler style RK4
 * rigid body with pluggable springs), used by the Celeritas racing game.
 */
import { Mat4, Quat, Vec3 } from "../XnaMath.ts";

export interface SpringForce {
    force: Vec3;
    torque: Vec3;
}

export interface Spring {
    evaluate(position: Vec3, orientation: Quat, velocity: Vec3, angularVelocity: Vec3): SpringForce;
}

const ZERO = new Vec3(0, 0, 0);

function force(f: Vec3): SpringForce {
    return { force: f, torque: ZERO };
}

export class ZeroSpring implements Spring {
    public position: Vec3;
    public tightness: number;
    public damping: number;

    public constructor(position: Vec3, tightness: number, damping: number) {
        this.position = position;
        this.tightness = tightness;
        this.damping = damping;
    }

    // F = - kx - bv
    public evaluate(position: Vec3, _orientation: Quat, velocity: Vec3, _angularVelocity: Vec3): SpringForce {
        return force(Vec3.sub(this.position, position).multiplyScalar(this.tightness).sub(Vec3.scale(velocity, this.damping)));
    }
}

export class Motor implements Spring {
    public targetVelocity = new Vec3(0, 0, 0);
    public tightness: number;
    public damping: number;

    public constructor(tightness: number, damping: number) {
        this.tightness = tightness;
        this.damping = damping;
    }

    // F = (targetVelocity - v) * tightness - v * damping
    public evaluate(_position: Vec3, _orientation: Quat, velocity: Vec3, _angularVelocity: Vec3): SpringForce {
        return force(Vec3.sub(this.targetVelocity, velocity).multiplyScalar(this.tightness).sub(Vec3.scale(velocity, this.damping)));
    }
}

export class DistanceSpring extends ZeroSpring {
    public distance: number;

    public constructor(position: Vec3, tightness: number, damping: number, distance: number) {
        super(position, tightness, damping);
        this.distance = distance;
    }

    // F = -k(|x|-d)(x/|x|) - bv   (sign per the original: (dist - d) * dir * k)
    public override evaluate(position: Vec3, _orientation: Quat, velocity: Vec3, _angularVelocity: Vec3): SpringForce {
        const positionDelta = Vec3.sub(this.position, position);
        const distance = positionDelta.length();
        // Epsilon guard: the original divides by |delta| unchecked; an exact
        // zero would produce NaN and kill the simulation.
        const direction = positionDelta.multiplyScalar(1 / Math.max(distance, 1e-6));
        return force(Vec3.scale(direction, (distance - this.distance) * this.tightness).sub(Vec3.scale(velocity, this.damping)));
    }
}

export class CollisionResponseSpring implements Spring {
    public enabled: boolean;
    public penetrationDepth = 0;
    public normal = new Vec3(0, 1, 0);
    public tightness: number;
    public damping: number;

    public constructor(enabled: boolean, tightness: number, damping: number) {
        this.enabled = enabled;
        this.tightness = tightness;
        this.damping = damping;
    }

    // F = nkd - bn(n.v)
    public evaluate(_position: Vec3, _orientation: Quat, velocity: Vec3, _angularVelocity: Vec3): SpringForce {
        if (!this.enabled) {
            return force(ZERO);
        }
        const spring = Vec3.scale(this.normal, this.tightness * this.penetrationDepth);
        const damper = Vec3.scale(this.normal, this.damping * Vec3.dot(this.normal, velocity));
        return force(spring.sub(damper));
    }
}

export class StayUprightConstraint implements Spring {
    private target = new Vec3(0, 1, 0);
    private targetOrientationAngle = new Vec3(0, 0, 0);
    public tightness: number;
    public damping: number;

    public constructor(targetOrientation: Vec3, tightness: number, damping: number) {
        this.tightness = tightness;
        this.damping = damping;
        this.target = targetOrientation;
        this.recomputeAngles();
    }

    /** Port of the TargetOrientation property (setter recomputes angles). */
    public get targetOrientation(): Vec3 {
        return this.target;
    }

    public set targetOrientation(value: Vec3) {
        this.target = value;
        this.recomputeAngles();
    }

    private recomputeAngles(): void {
        this.targetOrientationAngle = new Vec3(
            Math.atan2(this.target.y, this.target.z),
            Math.atan2(this.target.x, this.target.z),
            Math.atan2(this.target.x, this.target.y),
        );
    }

    public evaluate(_position: Vec3, orientation: Quat, _velocity: Vec3, angularVelocity: Vec3): SpringForce {
        const currentOrientation = orientation.toMat4().up();
        // The original computes angle components around three axes but only
        // torques around X and Z of them (Y is commented out there too).
        const currentOrientationAngle = new Vec3(
            Math.atan2(currentOrientation.y, currentOrientation.z),
            Math.atan2(currentOrientation.x, currentOrientation.z),
            Math.atan2(currentOrientation.x, currentOrientation.y),
        );

        let dx = currentOrientationAngle.x - this.targetOrientationAngle.x;
        let dz = currentOrientationAngle.z - this.targetOrientationAngle.z;
        if (dx < -Math.PI) dx += Math.PI;
        if (dx > +Math.PI) dx -= Math.PI;
        if (dz < -Math.PI) dz += Math.PI;
        if (dz > +Math.PI) dz -= Math.PI;

        return { force: ZERO, torque: new Vec3(dx, 0, dz).multiplyScalar(this.tightness).sub(Vec3.scale(angularVelocity, this.damping)) };
    }
}

export class TorqueSpring implements Spring {
    public targetTorque = new Vec3(0, 0, 0);
    public tightness: number;
    public damping: number;

    // The original ctor ignores its arguments (a bug kept for fidelity);
    // the caller assigns tightness every update and damping stays 0.
    public constructor(_tightness: number, _damping: number) {
        this.tightness = 0;
        this.damping = 0;
    }

    // T = (R * targetTorque - w) * tightness - w * damping
    public evaluate(_position: Vec3, orientation: Quat, _velocity: Vec3, angularVelocity: Vec3): SpringForce {
        const rotatedTorque = orientation.rotate(this.targetTorque);
        return { force: ZERO, torque: rotatedTorque.sub(angularVelocity).multiplyScalar(this.tightness).sub(Vec3.scale(angularVelocity, this.damping)) };
    }
}

interface BodyState {
    position: Vec3;
    momentum: Vec3;
    orientation: Quat;
    angularMomentum: Vec3;
    // secondary state
    velocity: Vec3;
    spin: Quat;
    angularVelocity: Vec3;
    size: number;
    inverseMass: number;
    inverseInertiaTensor: number;
}

function qAdd(a: Quat, b: Quat): Quat {
    return new Quat(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
}

function qScale(q: Quat, s: number): Quat {
    return new Quat(q.x * s, q.y * s, q.z * s, q.w * s);
}

function cloneState(s: BodyState): BodyState {
    return {
        position: s.position.clone(),
        momentum: s.momentum.clone(),
        orientation: s.orientation.clone(),
        angularMomentum: s.angularMomentum.clone(),
        velocity: s.velocity.clone(),
        spin: s.spin.clone(),
        angularVelocity: s.angularVelocity.clone(),
        size: s.size,
        inverseMass: s.inverseMass,
        inverseInertiaTensor: s.inverseInertiaTensor,
    };
}

function recalculate(state: BodyState): void {
    state.velocity = Vec3.scale(state.momentum, state.inverseMass);
    state.angularVelocity = Vec3.scale(state.angularMomentum, state.inverseInertiaTensor);
    state.orientation.normalize();
    // spin = 0.5 * (quat(w, 0) * orientation)
    const w = new Quat(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z, 0);
    state.spin = qScale(w.multiply(state.orientation), 0.5);
}

interface Derivative {
    velocity: Vec3;
    force: Vec3;
    spin: Quat;
    torque: Vec3;
}

export class PhysicsObject {
    private readonly springs: Spring[] = [];
    private current: BodyState;
    private accumulator = 0;
    private static readonly FIXED_DT = 0.002; // 500 Hz update frequency

    public constructor(size: number, mass: number) {
        this.current = {
            position: new Vec3(0, 0, 0),
            momentum: new Vec3(0, 0, 0),
            orientation: Quat.identity(),
            angularMomentum: new Vec3(0, 0, 0),
            velocity: new Vec3(0, 0, 0),
            spin: new Quat(0, 0, 0, 1),
            angularVelocity: new Vec3(0, 0, 0),
            size,
            inverseMass: 1 / mass,
            inverseInertiaTensor: 1 / (mass * size * size / 6),
        };
        recalculate(this.current);
    }

    public addSpring(spring: Spring): void {
        this.springs.push(spring);
    }

    /** Port of UpdatePhysicsConstantTimeStep: fixed 500Hz substeps. */
    protected updatePhysicsConstantTimeStep(time: number, deltaTime: number): void {
        let t = time - deltaTime;
        this.accumulator += deltaTime;
        const dt = PhysicsObject.FIXED_DT;
        while (this.accumulator >= dt) {
            this.integrate(this.current, t, dt);
            this.accumulator -= dt;
            t += dt;
        }
    }

    protected get physicalPosition(): Vec3 {
        return this.current.position;
    }

    protected set physicalPosition(value: Vec3) {
        this.current.position = value;
    }

    protected get physicalRotation(): Quat {
        return this.current.orientation;
    }

    protected set physicalRotation(value: Quat) {
        this.current.orientation = value;
    }

    protected get physicalVelocity(): Vec3 {
        return this.current.velocity;
    }

    protected set physicalVelocity(value: Vec3) {
        this.current.velocity = value;
        // The original writes the velocity field directly; keep momentum in
        // sync so the next integration starts from it.
        this.current.momentum = Vec3.scale(value, 1 / this.current.inverseMass);
    }

    private computeForces(state: BodyState): { force: Vec3; torque: Vec3 } {
        let forceSum = new Vec3(0, 0, 0);
        let torqueSum = new Vec3(0, 0, 0);
        for (const spring of this.springs) {
            const f = spring.evaluate(state.position, state.orientation, state.velocity, state.angularVelocity);
            forceSum = Vec3.add(forceSum, f.force);
            torqueSum = Vec3.add(torqueSum, f.torque);
        }
        return { force: forceSum, torque: torqueSum };
    }

    private evaluate(state: BodyState, _t: number): Derivative {
        const forces = this.computeForces(state);
        return { velocity: state.velocity, force: forces.force, spin: state.spin, torque: forces.torque };
    }

    private evaluateWith(base: BodyState, _t: number, dt: number, derivative: Derivative): Derivative {
        const state = cloneState(base);
        state.position = Vec3.add(state.position, Vec3.scale(derivative.velocity, dt));
        state.momentum = Vec3.add(state.momentum, Vec3.scale(derivative.force, dt));
        state.orientation = qAdd(state.orientation, qScale(derivative.spin, dt));
        state.angularMomentum = Vec3.add(state.angularMomentum, Vec3.scale(derivative.torque, dt));
        recalculate(state);
        const forces = this.computeForces(state);
        return { velocity: state.velocity, force: forces.force, spin: state.spin, torque: forces.torque };
    }

    /** Port of the RK4 integrate step (errors O(dt^5)). */
    private integrate(state: BodyState, t: number, dt: number): void {
        const a = this.evaluate(state, t);
        const b = this.evaluateWith(state, t, dt * 0.5, a);
        const c = this.evaluateWith(state, t, dt * 0.5, b);
        const d = this.evaluateWith(state, t, dt, c);

        const sixth = dt / 6;
        state.position = Vec3.add(state.position, Vec3.scale(
            Vec3.add(Vec3.add(a.velocity, Vec3.scale(Vec3.add(b.velocity, c.velocity), 2)), d.velocity), sixth));
        state.momentum = Vec3.add(state.momentum, Vec3.scale(
            Vec3.add(Vec3.add(a.force, Vec3.scale(Vec3.add(b.force, c.force), 2)), d.force), sixth));
        // orientation += (a.spin + 2*(b.spin + c.spin) + d.spin) * dt/6 (component-wise)
        const spinSum = qAdd(qAdd(a.spin, qScale(qAdd(b.spin, c.spin), 2)), d.spin);
        state.orientation = qAdd(state.orientation, qScale(spinSum, sixth));
        state.angularMomentum = Vec3.add(state.angularMomentum, Vec3.scale(
            Vec3.add(Vec3.add(a.torque, Vec3.scale(Vec3.add(b.torque, c.torque), 2)), d.torque), sixth));

        recalculate(state);
    }
}

/** Utility: build a world matrix from a rotation (port of Matrix usage in draw). */
export function worldFromRotation(rotation: Quat): Mat4 {
    const m = rotation.toMat4();
    return m;
}
