export class Vec3 {
    public x: number;
    public y: number;
    public z: number;

    public constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    public static readonly up = new Vec3(0, 1, 0);
    public static readonly forward = new Vec3(0, 0, -1);
    public static readonly zero = new Vec3(0, 0, 0);

    public clone(): Vec3 {
        return new Vec3(this.x, this.y, this.z);
    }

    public set(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    public copy(other: Vec3): this {
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
        return this;
    }

    public add(other: Vec3): this {
        this.x += other.x;
        this.y += other.y;
        this.z += other.z;
        return this;
    }

    public sub(other: Vec3): this {
        this.x -= other.x;
        this.y -= other.y;
        this.z -= other.z;
        return this;
    }

    public scale(s: number): this {
        this.x *= s;
        this.y *= s;
        this.z *= s;
        return this;
    }

    public multiplyScalar(s: number): this {
        return this.scale(s);
    }

    public length(): number {
        return Math.hypot(this.x, this.y, this.z);
    }

    public lengthSquared(): number {
        return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    public normalize(): this {
        const len = this.length();
        if (len > 1e-8) {
            this.scale(1 / len);
        }
        return this;
    }

    public static add(a: Vec3, b: Vec3): Vec3 {
        return new Vec3(a.x + b.x, a.y + b.y, a.z + b.z);
    }

    public static sub(a: Vec3, b: Vec3): Vec3 {
        return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    public static scale(a: Vec3, s: number): Vec3 {
        return new Vec3(a.x * s, a.y * s, a.z * s);
    }

    public static dot(a: Vec3, b: Vec3): number {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }

    public static cross(a: Vec3, b: Vec3): Vec3 {
        return new Vec3(
            a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x,
        );
    }

    public static normalize(v: Vec3): Vec3 {
        return v.clone().normalize();
    }

    public static lerp(a: Vec3, b: Vec3, t: number): Vec3 {
        return new Vec3(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            a.z + (b.z - a.z) * t,
        );
    }
}

export class Vec4 {
    public x: number;
    public y: number;
    public z: number;
    public w: number;

    public constructor(x = 0, y = 0, z = 0, w = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    public static readonly one = new Vec4(1, 1, 1, 1);

    public clone(): Vec4 {
        return new Vec4(this.x, this.y, this.z, this.w);
    }

    public set(x: number, y: number, z: number, w: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
        return this;
    }

    public copy(other: Vec4): this {
        this.x = other.x;
        this.y = other.y;
        this.z = other.z;
        this.w = other.w;
        return this;
    }

    public static lerp(a: Vec4, b: Vec4, t: number): Vec4 {
        return new Vec4(
            a.x + (b.x - a.x) * t,
            a.y + (b.y - a.y) * t,
            a.z + (b.z - a.z) * t,
            a.w + (b.w - a.w) * t,
        );
    }
}

/** Row-major 4x4 matrix matching XNA's layout and row-vector convention. */
export class Mat4 {
    public readonly elements: Float32Array;

    public constructor(elements?: Float32Array) {
        this.elements = elements ?? new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]);
    }

    public clone(): Mat4 {
        return new Mat4(this.elements.slice());
    }

    public copy(other: Mat4): this {
        this.elements.set(other.elements);
        return this;
    }

    public static identity(): Mat4 {
        return new Mat4();
    }

    public static multiply(a: Mat4, b: Mat4): Mat4 {
        const ae = a.elements;
        const be = b.elements;
        const r = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            const i4 = i * 4;
            const a0 = ae[i4] ?? 0;
            const a1 = ae[i4 + 1] ?? 0;
            const a2 = ae[i4 + 2] ?? 0;
            const a3 = ae[i4 + 3] ?? 0;
            r[i4] = a0 * (be[0] ?? 0) + a1 * (be[4] ?? 0) + a2 * (be[8] ?? 0) + a3 * (be[12] ?? 0);
            r[i4 + 1] = a0 * (be[1] ?? 0) + a1 * (be[5] ?? 0) + a2 * (be[9] ?? 0) + a3 * (be[13] ?? 0);
            r[i4 + 2] = a0 * (be[2] ?? 0) + a1 * (be[6] ?? 0) + a2 * (be[10] ?? 0) + a3 * (be[14] ?? 0);
            r[i4 + 3] = a0 * (be[3] ?? 0) + a1 * (be[7] ?? 0) + a2 * (be[11] ?? 0) + a3 * (be[15] ?? 0);
        }
        return new Mat4(r);
    }

    public translation(): Vec3 {
        const e = this.elements;
        return new Vec3(e[12] ?? 0, e[13] ?? 0, e[14] ?? 0);
    }

    public setTranslation(v: Vec3): this {
        this.elements[12] = v.x;
        this.elements[13] = v.y;
        this.elements[14] = v.z;
        return this;
    }

    public forward(): Vec3 {
        const e = this.elements;
        return new Vec3(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0));
    }

    public up(): Vec3 {
        const e = this.elements;
        return new Vec3(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0);
    }

    public backward(): Vec3 {
        return new Vec3(this.elements[8] ?? 0, this.elements[9] ?? 0, this.elements[10] ?? 0);
    }

    public static lerp(a: Mat4, b: Mat4, t: number): Mat4 {
        const ae = a.elements;
        const be = b.elements;
        const r = new Float32Array(16);
        for (let i = 0; i < 16; i++) {
            r[i] = (ae[i] ?? 0) + ((be[i] ?? 0) - (ae[i] ?? 0)) * t;
        }
        return new Mat4(r);
    }

    public static createLookAt(cameraPosition: Vec3, cameraTarget: Vec3, cameraUpVector: Vec3): Mat4 {
        const z = Vec3.sub(cameraPosition, cameraTarget).normalize();
        const x = Vec3.cross(cameraUpVector, z).normalize();
        const y = Vec3.cross(z, x);
        const m = new Mat4();
        const e = m.elements;
        e[0] = x.x;
        e[1] = y.x;
        e[2] = z.x;
        e[3] = 0;
        e[4] = x.y;
        e[5] = y.y;
        e[6] = z.y;
        e[7] = 0;
        e[8] = x.z;
        e[9] = y.z;
        e[10] = z.z;
        e[11] = 0;
        e[12] = -Vec3.dot(x, cameraPosition);
        e[13] = -Vec3.dot(y, cameraPosition);
        e[14] = -Vec3.dot(z, cameraPosition);
        e[15] = 1;
        return m;
    }

    public static createPerspectiveOffCenter(
        left: number,
        right: number,
        bottom: number,
        top: number,
        nearPlaneDistance: number,
        farPlaneDistance: number,
    ): Mat4 {
        const m = new Mat4();
        const e = m.elements;
        e[0] = (2 * nearPlaneDistance) / (right - left);
        e[1] = 0;
        e[2] = 0;
        e[3] = 0;
        e[4] = 0;
        e[5] = (2 * nearPlaneDistance) / (top - bottom);
        e[6] = 0;
        e[7] = 0;
        e[8] = (left + right) / (right - left);
        e[9] = (top + bottom) / (top - bottom);
        e[10] = farPlaneDistance / (nearPlaneDistance - farPlaneDistance);
        e[11] = -1;
        e[12] = 0;
        e[13] = 0;
        e[14] = (nearPlaneDistance * farPlaneDistance) / (nearPlaneDistance - farPlaneDistance);
        e[15] = 0;
        return m;
    }

    public static createPerspectiveFieldOfView(
        fov: number,
        aspectRatio: number,
        nearPlaneDistance: number,
        farPlaneDistance: number,
    ): Mat4 {
        const yScale = 1 / Math.tan(fov * 0.5);
        const xScale = yScale / aspectRatio;
        const m = new Mat4();
        const e = m.elements;
        e[0] = xScale;
        e[5] = yScale;
        e[10] = farPlaneDistance / (nearPlaneDistance - farPlaneDistance);
        e[11] = -1;
        e[14] = (nearPlaneDistance * farPlaneDistance) / (nearPlaneDistance - farPlaneDistance);
        return m;
    }

    public static createOrthographicOffCenter(
        left: number,
        right: number,
        bottom: number,
        top: number,
        nearPlaneDistance: number,
        farPlaneDistance: number,
    ): Mat4 {
        const m = new Mat4();
        const e = m.elements;
        e[0] = 2 / (right - left);
        e[5] = 2 / (top - bottom);
        e[10] = 1 / (nearPlaneDistance - farPlaneDistance);
        e[12] = (left + right) / (left - right);
        e[13] = (top + bottom) / (bottom - top);
        e[14] = nearPlaneDistance / (nearPlaneDistance - farPlaneDistance);
        e[15] = 1;
        return m;
    }

    public static createScale(scale: number): Mat4 {
        const m = new Mat4();
        const e = m.elements;
        e[0] = scale;
        e[5] = scale;
        e[10] = scale;
        return m;
    }

    public static createFromYawPitchRoll(yaw: number, pitch: number, roll: number): Mat4 {
        const halfRoll = roll * 0.5;
        const halfPitch = pitch * 0.5;
        const halfYaw = yaw * 0.5;
        const sinRoll = Math.sin(halfRoll);
        const cosRoll = Math.cos(halfRoll);
        const sinPitch = Math.sin(halfPitch);
        const cosPitch = Math.cos(halfPitch);
        const sinYaw = Math.sin(halfYaw);
        const cosYaw = Math.cos(halfYaw);

        const x = (cosYaw * sinPitch * cosRoll) + (sinYaw * cosPitch * sinRoll);
        const y = (sinYaw * cosPitch * cosRoll) - (cosYaw * sinPitch * sinRoll);
        const z = (cosYaw * cosPitch * sinRoll) - (sinYaw * sinPitch * cosRoll);
        const w = (cosYaw * cosPitch * cosRoll) + (sinYaw * sinPitch * sinRoll);

        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const xy = x * y;
        const zw = z * w;
        const zx = z * x;
        const yw = y * w;
        const yz = y * z;
        const xw = x * w;

        const m = new Mat4();
        const e = m.elements;
        e[0] = 1 - (2 * (yy + zz));
        e[1] = 2 * (xy + zw);
        e[2] = 2 * (zx - yw);
        e[3] = 0;
        e[4] = 2 * (xy - zw);
        e[5] = 1 - (2 * (zz + xx));
        e[6] = 2 * (yz + xw);
        e[7] = 0;
        e[8] = 2 * (zx + yw);
        e[9] = 2 * (yz - xw);
        e[10] = 1 - (2 * (xx + yy));
        e[11] = 0;
        e[12] = 0;
        e[13] = 0;
        e[14] = 0;
        e[15] = 1;
        return m;
    }

    public static createBillboard(
        objectPosition: Vec3,
        cameraPosition: Vec3,
        cameraUpVector: Vec3,
        cameraForwardVector: Vec3,
    ): Mat4 {
        const vector = Vec3.sub(objectPosition, cameraPosition);
        const num = vector.lengthSquared();
        if (num < 0.0001) {
            vector.copy(cameraForwardVector).scale(-1);
        } else {
            vector.scale(1 / Math.sqrt(num));
        }
        const vector3 = Vec3.cross(cameraUpVector, vector).normalize();
        const vector2 = Vec3.cross(vector, vector3);

        const m = new Mat4();
        const e = m.elements;
        e[0] = vector3.x;
        e[1] = vector3.y;
        e[2] = vector3.z;
        e[3] = 0;
        e[4] = vector2.x;
        e[5] = vector2.y;
        e[6] = vector2.z;
        e[7] = 0;
        e[8] = vector.x;
        e[9] = vector.y;
        e[10] = vector.z;
        e[11] = 0;
        e[12] = objectPosition.x;
        e[13] = objectPosition.y;
        e[14] = objectPosition.z;
        e[15] = 1;
        return m;
    }
}
