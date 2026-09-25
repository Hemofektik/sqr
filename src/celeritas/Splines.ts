/**
 * Splines - port of Hemofektik/Splines (Spline.cs, Surface.cs, Utils.cs):
 * cubic Bezier spline surfaces, the procedural oval race track and its
 * collision segments.
 */
import { Vec3 } from "../XnaMath.ts";

export interface Ray {
    position: Vec3;
    direction: Vec3;
}

export interface Aabb {
    min: Vec3;
    max: Vec3;
}

/**
 * Port of System.Random (Knuth subtractive generator) so the procedural
 * track/building noise matches the original sequence. Only NextDouble is
 * used by the racing code.
 */
export function makeDotNetRandom(seed: number): () => number {
    const MBIG = 2147483647;
    const MSEED = 161803398;
    const subtraction = Math.abs(seed) === 2147483647 ? 2147483646 : Math.abs(seed);
    let mj = MSEED - subtraction;
    if (mj < 0) mj += MBIG;
    const seedArray = new Array<number>(56).fill(0);
    seedArray[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
        const ii = (21 * i) % 55;
        seedArray[ii] = mk;
        mk = mj - mk;
        if (mk < 0) mk += MBIG;
        mj = seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
        for (let i = 1; i < 56; i++) {
            // The reference implementation indexes SeedArray[i] directly here
            // (the 21*i permutation only applies to the first loop).
            let value = (seedArray[i] ?? 0) - (seedArray[1 + ((i + 30) % 55)] ?? 0);
            if (value < 0) value += MBIG;
            seedArray[i] = value;
        }
    }
    let inext = 0;
    let inextp = 21;
    const internalSample = (): number => {
        let locINext = inext + 1;
        if (locINext >= 56) locINext = 1;
        let locINextp = inextp + 1;
        if (locINextp >= 56) locINextp = 1;
        let retVal = (seedArray[locINext] ?? 0) - (seedArray[locINextp] ?? 0);
        if (retVal === MBIG) retVal--;
        if (retVal < 0) retVal += MBIG;
        seedArray[locINext] = retVal;
        inext = locINext;
        inextp = locINextp;
        return retVal;
    };
    return () => internalSample() * (1 / (MBIG + 1));
}

/** Port of Intersection.RayIntersectsTriangle (Moller-Trumbore). */
export function rayIntersectsTriangle(
    ray: Ray,
    v1: Vec3,
    v2: Vec3,
    v3: Vec3,
): { distance: number; u: number; v: number } | undefined {
    const edge1 = Vec3.sub(v2, v1);
    const edge2 = Vec3.sub(v3, v1);
    const directionCrossEdge2 = Vec3.cross(ray.direction, edge2);
    const determinant = Vec3.dot(edge1, directionCrossEdge2);
    if (determinant > -1e-45 && determinant < 1e-45) {
        return undefined;
    }
    const inverseDeterminant = 1 / determinant;
    const distanceVector = Vec3.sub(ray.position, v1);
    let triangleU = Vec3.dot(distanceVector, directionCrossEdge2) * inverseDeterminant;
    if (triangleU < 0 || triangleU > 1) {
        return undefined;
    }
    const distanceCrossEdge1 = Vec3.cross(distanceVector, edge1);
    let triangleV = Vec3.dot(ray.direction, distanceCrossEdge1) * inverseDeterminant;
    if (triangleV < 0 || triangleU + triangleV > 1) {
        return undefined;
    }
    let rayDistance = Vec3.dot(edge2, distanceCrossEdge1) * inverseDeterminant;
    if (rayDistance < 0) {
        return undefined;
    }
    return { distance: rayDistance, u: triangleU, v: triangleV };
}

/** Port of Vector3.Barycentric. */
export function barycentric(v1: Vec3, v2: Vec3, v3: Vec3, u: number, v: number): Vec3 {
    return Vec3.add(v1, Vec3.add(Vec3.scale(Vec3.sub(v2, v1), u), Vec3.scale(Vec3.sub(v3, v1), v)));
}

/** Port of CubicSpline (cubic Bezier with contiguous control points). */
export class CubicSpline {
    public p0: Vec3;
    public p1: Vec3;
    public p2: Vec3;
    public p3: Vec3;

    public constructor(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.p3 = p3;
    }

    public static createContiguous(posBefore: Vec3, posStart: Vec3, posEnd: Vec3, posBehind: Vec3): CubicSpline {
        const p0 = posStart;
        const p1 = Vec3.add(posStart, Vec3.scale(Vec3.sub(posEnd, posBefore), 1 / 6));
        const p2 = Vec3.add(posEnd, Vec3.scale(Vec3.sub(posStart, posBehind), 1 / 6));
        const p3 = posEnd;
        return new CubicSpline(p0, p1, p2, p3);
    }
}

const PARTIAL_BLEND = [1, 3, 3, 1]; // C(3, k)

function evaluateBlendFunc(x: number, y: number, u: number, v: number): number {
    const blendFuncU = (PARTIAL_BLEND[x] ?? 0) * Math.pow(u, x) * Math.pow(1 - u, 3 - x);
    const blendFuncV = (PARTIAL_BLEND[y] ?? 0) * Math.pow(v, y) * Math.pow(1 - v, 3 - y);
    return blendFuncU * blendFuncV;
}

/** Port of CubicSurface: tensor product of 4 cubic Bezier splines. */
export class CubicSurface {
    private readonly p: Vec3[]; // index = y * 4 + x (pXY with X = u weight, Y = v weight)

    public constructor(
        p00: Vec3, p10: Vec3, p20: Vec3, p30: Vec3,
        p01: Vec3, p11: Vec3, p21: Vec3, p31: Vec3,
        p02: Vec3, p12: Vec3, p22: Vec3, p32: Vec3,
        p03: Vec3, p13: Vec3, p23: Vec3, p33: Vec3,
    ) {
        this.p = [p00, p10, p20, p30, p01, p11, p21, p31, p02, p12, p22, p32, p03, p13, p23, p33];
    }

    public evaluate(u: number, v: number): Vec3 {
        let result = new Vec3(0, 0, 0);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const blend = evaluateBlendFunc(x, y, u, v);
                const ctrl = this.p[y * 4 + x];
                if (ctrl !== undefined) {
                    result = Vec3.add(result, Vec3.scale(ctrl, blend));
                }
            }
        }
        return result;
    }

    public evaluateNormal(u: number, v: number): Vec3 {
        // Port: forward difference (u/v + 0.001) like the original TODO.
        const pos = this.evaluate(u, v);
        const deltaU = this.evaluate(u + 0.001, v);
        const deltaV = this.evaluate(u, v + 0.001);
        return Vec3.cross(Vec3.sub(deltaU, pos), Vec3.sub(deltaV, pos)).normalize();
    }
}

function aabbOverlaps(a: Aabb, b: Aabb): boolean {
    return a.min.x <= b.max.x && a.max.x >= b.min.x
        && a.min.y <= b.max.y && a.max.y >= b.min.y
        && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function aabbFromPoints(points: Vec3[]): Aabb {
    const min = points[0]?.clone() ?? new Vec3(0, 0, 0);
    const max = min.clone();
    for (const p of points) {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
    }
    return { min, max };
}

/** Port of SplineSurfaceTrack.CollisionSegment: a small triangle grid patch. */
export class CollisionSegment {
    public readonly boundingBox: Aabb;
    private readonly positions: Vec3[];
    private readonly normals: Vec3[];
    private readonly indices: number[];

    public constructor(
        uStart: number, uEnd: number, numQuadsU: number,
        vStart: number, vEnd: number, numQuadsV: number,
        track: SplineSurfaceTrack,
    ) {
        const numVerticesX = numQuadsU + 1;
        const numVerticesY = numQuadsV + 1;
        const uDelta = (uEnd - uStart) / numQuadsU;
        const vDelta = (vEnd - vStart) / numQuadsV;
        this.positions = [];
        this.normals = [];
        let v = vStart;
        for (let m = 0; m < numVerticesY; m++) {
            let u = uStart;
            for (let n = 0; n < numVerticesX; n++) {
                const sample = track.getSurfacePoint(u, v, true);
                this.positions.push(sample.point);
                this.normals.push(sample.normal);
                u += uDelta;
            }
            v += vDelta;
        }
        this.indices = CollisionSegment.buildIndexBuffer(numQuadsU, numQuadsV);
        this.boundingBox = aabbFromPoints(this.positions);
    }

    private static buildIndexBuffer(numQuadsX: number, numQuadsY: number): number[] {
        const numVerticesX = numQuadsX + 1;
        const indexData: number[] = [];
        for (let z = 0; z < numQuadsY; z++) {
            for (let x = 0; x < numQuadsX; x++) {
                const x1 = Math.min(numQuadsX, x + 1);
                const z1 = Math.min(numQuadsY, z + 1);
                indexData.push(z * numVerticesX + x, z1 * numVerticesX + x, z * numVerticesX + x1);
                indexData.push(z * numVerticesX + x1, z1 * numVerticesX + x, z1 * numVerticesX + x1);
            }
        }
        return indexData;
    }

    /** Port of CollisionSegment.GetHit(ray). Returns the FIRST triangle hit. */
    public getHit(ray: Ray): { position: Vec3; normal: Vec3 } | undefined {
        for (let p = 0; p < this.indices.length; p += 3) {
            const i0 = this.indices[p] ?? 0;
            const i1 = this.indices[p + 1] ?? 0;
            const i2 = this.indices[p + 2] ?? 0;
            const v1 = this.positions[i0];
            const v2 = this.positions[i1];
            const v3 = this.positions[i2];
            if (v1 === undefined || v2 === undefined || v3 === undefined) {
                continue;
            }
            const hit = rayIntersectsTriangle(ray, v1, v2, v3);
            if (hit !== undefined) {
                const position = Vec3.add(ray.position, Vec3.scale(ray.direction, hit.distance));
                const n1 = this.normals[i0] ?? new Vec3(0, 1, 0);
                const n2 = this.normals[i1] ?? new Vec3(0, 1, 0);
                const n3 = this.normals[i2] ?? new Vec3(0, 1, 0);
                return { position, normal: barycentric(n1, n2, n3, hit.u, hit.v) };
            }
        }
        return undefined;
    }

    public intersects(other: Aabb): boolean {
        return aabbOverlaps(this.boundingBox, other);
    }
}

/** Port of SplineSurfaceTrack. */
export class SplineSurfaceTrack {
    private readonly surface: CubicSurface[][] = [];

    public constructor(segmentConnections: CubicSpline[][], loop: boolean) {
        for (let s = 0; s < segmentConnections.length; s++) {
            const subSurface: CubicSurface[] = [];
            const row = segmentConnections[s] ?? [];
            for (let ss = 0; ss < row.length; ss++) {
                const prev = SplineSurfaceTrack.getSegmentConnection(segmentConnections, s - 1, ss, loop);
                const current = SplineSurfaceTrack.getSegmentConnection(segmentConnections, s, ss, loop);
                const next1 = SplineSurfaceTrack.getSegmentConnection(segmentConnections, s + 1, ss, loop);
                const next2 = SplineSurfaceTrack.getSegmentConnection(segmentConnections, s + 2, ss, loop);

                const spline0 = CubicSpline.createContiguous(prev.p0, current.p0, next1.p0, next2.p0);
                const spline1 = CubicSpline.createContiguous(prev.p1, current.p1, next1.p1, next2.p1);
                const spline2 = CubicSpline.createContiguous(prev.p2, current.p2, next1.p2, next2.p2);
                const spline3 = CubicSpline.createContiguous(prev.p3, current.p3, next1.p3, next2.p3);

                subSurface.push(new CubicSurface(
                    spline0.p0, spline1.p0, spline2.p0, spline3.p0,
                    spline0.p1, spline1.p1, spline2.p1, spline3.p1,
                    spline0.p2, spline1.p2, spline2.p2, spline3.p2,
                    spline0.p3, spline1.p3, spline2.p3, spline3.p3,
                ));
            }
            this.surface.push(subSurface);
        }
    }

    private static getSegmentConnection(connections: CubicSpline[][], index: number, subIndex: number, wrap: boolean): CubicSpline {
        const missing = new CubicSpline(new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(0, 0, 0), new Vec3(0, 0, 0));
        if (wrap) {
            const wrappedIndex = ((index % connections.length) + connections.length) % connections.length;
            const row = connections[wrappedIndex] ?? [missing];
            return row[Math.min(subIndex, row.length - 1)] ?? missing;
        }
        const clampedIndex = Math.max(Math.min(index, connections.length - 1), 0);
        const row = connections[clampedIndex] ?? [missing];
        return row[Math.min(subIndex, row.length - 1)] ?? missing;
    }

    private getRealVFrac(v: number): [number, number] {
        const numSegments = this.surface.length;
        const realV = v * numSegments;
        const clampedV = Math.min(numSegments - 1, Math.floor(realV));
        return [realV - clampedV, clampedV];
    }

    private getRealUFrac(clampedV: number, u: number): [number, number] {
        const numSegmentsU = this.surface[Math.floor(clampedV)]?.length ?? 1;
        const realU = u * numSegmentsU;
        const clampedU = Math.min(numSegmentsU - 1, Math.floor(realU));
        return [realU - clampedU, clampedU];
    }

    public getSurfacePoint(u: number, v: number, withNormal = false): { point: Vec3; normal: Vec3 } {
        const [vFrac, clampedV] = this.getRealVFrac(v);
        const [uFrac, clampedU] = this.getRealUFrac(clampedV, u);
        const patch = this.surface[Math.floor(clampedV)]?.[Math.floor(clampedU)];
        if (patch === undefined) {
            return { point: new Vec3(0, 0, 0), normal: new Vec3(0, 1, 0) };
        }
        return { point: patch.evaluate(uFrac, vFrac), normal: withNormal ? patch.evaluateNormal(uFrac, vFrac) : new Vec3(0, 1, 0) };
    }

    /** Port of ComputeCollisionTree: 2x4 segments per oval section. */
    public computeCollisionSegments(): CollisionSegment[] {
        const segments: CollisionSegment[] = [];
        const numSegmentsX = 2;
        const numSegmentsY = this.surface.length * 4;
        const uDelta = 1 / numSegmentsX;
        const vDelta = 1 / numSegmentsY;
        let v = 0;
        for (let m = 0; m < numSegmentsY; m++) {
            let u = 0;
            for (let n = 0; n < numSegmentsX; n++) {
                segments.push(new CollisionSegment(u, u + uDelta, 2, v, v + vDelta, 2, this));
                u += uDelta;
            }
            v += vDelta;
        }
        return segments;
    }
}

/**
 * Port of the track collision tree queries: the original used an Octree whose
 * GetFirstHit returns the first triangle hit in traversal order - a linear
 * scan over the (small) segment list gives the same result for these rays.
 */
export class TrackCollision {
    private readonly segments: CollisionSegment[];

    public constructor(segments: CollisionSegment[]) {
        this.segments = segments;
    }

    public firstHit(ray: Ray): { position: Vec3; normal: Vec3 } | undefined {
        for (const segment of this.segments) {
            const hit = segment.getHit(ray);
            if (hit !== undefined) {
                return hit;
            }
        }
        return undefined;
    }

    public intersects(box: Aabb): boolean {
        for (const segment of this.segments) {
            if (segment.intersects(box)) {
                return true;
            }
        }
        return false;
    }
}

/** Port of Utils.CreateSplineSurfaceOval. */
export function createSplineSurfaceOval(radius: number, width: number, noise: number): SplineSurfaceTrack {
    const numSegments = 20;
    const radStep = (Math.PI * 2) / numSegments;
    let rad = 0;
    const rnd = makeDotNetRandom(12345);

    const segments: CubicSpline[][] = [];
    for (let n = 0; n < numSegments; n++) {
        const subSegments: CubicSpline[] = [];

        let segmentDir = new Vec3(Math.cos(rad), 0, Math.sin(rad));
        const segmentForward = new Vec3(-segmentDir.z, 0, segmentDir.x);
        const segmentPos = Vec3.scale(segmentDir, radius);

        const segmentP0 = Vec3.add(segmentPos, Vec3.scale(segmentDir, width * 0.5));
        const segmentP1 = Vec3.add(segmentPos, Vec3.scale(segmentDir, (width * 0.5) / 3));
        const segmentP2 = Vec3.sub(segmentPos, Vec3.scale(segmentDir, (width * 0.5) / 3));
        const segmentP3 = Vec3.sub(segmentPos, Vec3.scale(segmentDir, width * 0.5));

        const mainSegment = new CubicSpline(segmentP0, segmentP1, segmentP2, segmentP3);

        if (noise !== 0) {
            // Alter the points to make up a kewl track.
            const slopeVariation = Math.pow(rnd(), 3) * -6 + 3;
            const radSlope = slopeVariation * 0.75;
            const slope = Math.sin(radSlope) * width;
            const offset = Vec3.add(
                Vec3.scale(segmentDir, Math.pow(rnd(), 3) * radius * 0.2),
                new Vec3(0, (rnd() - 0.5) * noise, 0),
            );
            mainSegment.p0 = Vec3.add(mainSegment.p0, Vec3.add(offset, new Vec3(0, slope, 0)));
            mainSegment.p3 = Vec3.add(mainSegment.p3, Vec3.sub(offset, new Vec3(0, slope, 0)));

            segmentDir = Vec3.sub(mainSegment.p0, mainSegment.p3).normalize();

            // The original computes noiseVector (drawing one random value!)
            // but only uses it in commented-out code - the draw must stay to
            // keep the random sequence identical.
            rnd();

            mainSegment.p1 = Vec3.add(mainSegment.p1, Vec3.add(offset, new Vec3(0, slope / 3, 0)));
            mainSegment.p2 = Vec3.add(mainSegment.p2, Vec3.sub(offset, new Vec3(0, slope / 3, 0)));
        }

        const segmentDir0 = Vec3.sub(mainSegment.p0, mainSegment.p1).normalize();
        const segmentDir1 = Vec3.sub(mainSegment.p3, mainSegment.p2).normalize();
        // Not normalized in the original either (length varies with the
        // angle between the boundary direction and segmentForward).
        const segmentUp0 = Vec3.cross(segmentForward, segmentDir0);
        const segmentUp1 = Vec3.cross(segmentDir1, segmentForward);

        const boundaryHeightScale = 3;
        const boundaryCurveScale1 = 5;
        const boundaryCurveScale2 = -0.5;
        const leftBoundaryPos = Vec3.add(mainSegment.p0, Vec3.scale(segmentUp0, boundaryHeightScale));
        const leftBoundarySegment = new CubicSpline(
            Vec3.add(leftBoundaryPos, Vec3.scale(segmentDir0, boundaryCurveScale1)),
            Vec3.sub(leftBoundaryPos, Vec3.scale(segmentDir0, boundaryCurveScale2)),
            Vec3.add(mainSegment.p0, Vec3.sub(mainSegment.p0, mainSegment.p1)),
            mainSegment.p0,
        );

        const rightBoundaryPos = Vec3.add(mainSegment.p3, Vec3.scale(segmentUp1, boundaryHeightScale));
        const rightBoundarySegment = new CubicSpline(
            mainSegment.p3,
            Vec3.add(mainSegment.p3, Vec3.sub(mainSegment.p3, mainSegment.p2)),
            Vec3.sub(rightBoundaryPos, Vec3.scale(segmentDir1, boundaryCurveScale2)),
            Vec3.add(rightBoundaryPos, Vec3.scale(segmentDir1, boundaryCurveScale1)),
        );

        subSegments.push(leftBoundarySegment);
        subSegments.push(mainSegment);
        subSegments.push(rightBoundarySegment);
        segments.push(subSegments);

        rad += radStep;
    }

    return new SplineSurfaceTrack(segments, true);
}
