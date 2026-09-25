/**
 * RaceTrack - port of Celeritas/RaceTrack.cs: the procedural oval track
 * (spline surface mesh with the splinetrack shader), ring of buildings and
 * the ground plane, plus the collision queries the vessel uses.
 */
import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 as ThreeVector3 } from "three";
import { Mat4, Vec3, Vec4 } from "../XnaMath.ts";
import { SuperQuadric, SuperQuadricBatch } from "../SuperQuadric.ts";
import { makeDotNetRandom, createSplineSurfaceOval, TrackCollision, type Ray, type Aabb } from "./Splines.ts";

// Port of Content/fx/splinetrack.fx (world is identity for the track).
const TRACK_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
    vWorld = position;
    vNormal = normal;
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const TRACK_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 lightDir;
uniform vec3 viewPos;
uniform vec3 skyColor;
uniform vec3 groundColor;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
    vec3 viewDir = normalize(vWorld - viewPos);
    vec3 normal = normalize(vNormal);

    // Dashed lane markings that fade with distance (per the original fx).
    vec3 color = (fract(vUv.y * 300.0 + abs(0.5 - vUv.x) * 5.0) > 0.5)
        ? vec3(0.6, 0.4, 0.1) : vec3(0.7, 0.7, 0.0);
    vec3 fracPosBiased = fract(vWorld) - 0.5;
    float viewDistance = length(vWorld - viewPos);
    color = color - (dot(fracPosBiased, fracPosBiased)) * max(0.0, 1.0 - viewDistance / 150.0);

    vec4 colorDiffuse = vec4(color, 1.0);
    vec4 colorEmissive = vec4(0.0, 0.0, 0.0, 1.0);

    float lambert = dot(lightDir, normal) * 0.5 + 0.5;
    float diffuse = lambert * lambert;

    vec3 reflection = reflect(viewDir, normal);
    float specular = pow(clamp(dot(lightDir, reflection), 0.0, 1.0), 9.0) * colorEmissive.a;

    vec3 ambientLight = mix(groundColor, skyColor, diffuse);
    gl_FragColor.rgb = (diffuse * colorDiffuse.rgb + ambientLight) + specular + colorEmissive.rgb;
    gl_FragColor.a = colorDiffuse.a + specular;
}
`;

/** Extract the 6 frustum planes (row-vector XNA view*projection) for culling. */
function frustumPlanes(viewProj: Mat4): { n: Vec3; d: number }[] {
    const e = (i: number): number => viewProj.elements[i] ?? 0;
    const col = (j: number): [number, number, number, number] => [e(j), e(j + 4), e(j + 8), e(j + 12)];
    const c0 = col(0);
    const c1 = col(1);
    const c2 = col(2);
    const c3 = col(3);
    const plane = (a: [number, number, number, number], b: [number, number, number, number], sign: number): { n: Vec3; d: number } => ({
        n: new Vec3(sign * a[0] + b[0], sign * a[1] + b[1], sign * a[2] + b[2]),
        d: sign * a[3] + b[3],
    });
    return [
        plane(c0, c3, 1),   // left:   x + w >= 0
        plane(c0, c3, -1),  // right: -x + w >= 0
        plane(c1, c3, 1),   // bottom
        plane(c1, c3, -1),  // top
        plane(c2, [0, 0, 0, 0], 1),   // near: z >= 0 (D3D)
        plane(c2, c3, -1),  // far:   -z + w >= 0
    ];
}

function sphereVisible(planes: { n: Vec3; d: number }[], center: Vec3, radius: number): boolean {
    for (const plane of planes) {
        if (plane.n.x * center.x + plane.n.y * center.y + plane.n.z * center.z + plane.d < -radius) {
            return false;
        }
    }
    return true;
}

export class RaceTrack {
    public readonly trackCollision: TrackCollision;
    public readonly buildings: SuperQuadric[] = [];
    public readonly trackMesh: Mesh;
    public readonly buildingsBatchMesh: Mesh;
    /** Prepared per frame: visible buildings uploaded into this batch. */
    public readonly buildingsBatch: SuperQuadricBatch;
    public readonly trackMaterial: ShaderMaterial;
    private readonly sst: ReturnType<typeof createSplineSurfaceOval>;

    public constructor() {
        const trackRadius = 1000;
        const trackWidth = 20;
        const sst = createSplineSurfaceOval(trackRadius, trackWidth, 20);
        this.sst = sst;
        this.trackCollision = new TrackCollision(sst.computeCollisionSegments());

        // --- Track render mesh (port of ProceduralRenderer) ----------------
        const NUM_QUADS_X = 16;
        const NUM_QUADS_Y = 512;
        const numVerticesX = NUM_QUADS_X + 1;
        const numVerticesY = NUM_QUADS_Y + 1;
        const positions = new Float32Array(numVerticesX * numVerticesY * 3);
        const normals = new Float32Array(numVerticesX * numVerticesY * 3);
        const uvs = new Float32Array(numVerticesX * numVerticesY * 2);
        const indices = new Uint16Array(NUM_QUADS_X * NUM_QUADS_Y * 6);
        {
            let vp = 0;
            let v = 0;
            const vDelta = 1 / NUM_QUADS_Y;
            for (let m = 0; m < numVerticesY; m++) {
                for (let n = 0; n < numVerticesX; n++) {
                    let u = n / NUM_QUADS_X;
                    // Push faces to the corners to minimize edges on the track
                    // border (ported in-place warp).
                    const uh = (u - 0.5) * 2;
                    const us = Math.sign(uh) * 0.5;
                    u = us * Math.pow(Math.abs(uh), 0.5) + 0.5;
                    const sample = sst.getSurfacePoint(u, v, true);
                    positions[vp * 3] = sample.point.x;
                    positions[vp * 3 + 1] = sample.point.y;
                    positions[vp * 3 + 2] = sample.point.z;
                    normals[vp * 3] = sample.normal.x;
                    normals[vp * 3 + 1] = sample.normal.y;
                    normals[vp * 3 + 2] = sample.normal.z;
                    uvs[vp * 2] = u;
                    uvs[vp * 2 + 1] = v;
                    vp++;
                }
                v += vDelta;
            }
            let ip = 0;
            for (let z = 0; z < NUM_QUADS_Y; z++) {
                for (let x = 0; x < NUM_QUADS_X; x++) {
                    const x1 = Math.min(NUM_QUADS_X, x + 1);
                    const z1 = Math.min(NUM_QUADS_Y, z + 1);
                    // Same layout as the original FillIndexBuffer, but with
                    // each triangle's winding reversed: XNA/D3D culls
                    // counter-clockwise faces while WebGL/three.js culls them,
                    // so the original order makes the track front-faced from
                    // below here.
                    indices[ip++] = z * numVerticesX + x;
                    indices[ip++] = z * numVerticesX + x1;
                    indices[ip++] = z1 * numVerticesX + x;
                    indices[ip++] = z * numVerticesX + x1;
                    indices[ip++] = z1 * numVerticesX + x1;
                    indices[ip++] = z1 * numVerticesX + x;
                }
            }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("normal", new BufferAttribute(normals, 3));
        geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
        geometry.setIndex(new BufferAttribute(indices, 1));
        this.trackMaterial = new ShaderMaterial({
            vertexShader: TRACK_VERTEX_SHADER,
            fragmentShader: TRACK_FRAGMENT_SHADER,
            uniforms: {
                lightDir: { value: new ThreeVector3(0.5, 1, -1) },
                viewPos: { value: new ThreeVector3() },
                skyColor: { value: new ThreeVector3(0.3, 0.3, 0.3) },
                groundColor: { value: new ThreeVector3(0.2, 0.2, 0.2) },
            },
            depthTest: true,
            depthWrite: true,
        });
        this.trackMesh = new Mesh(geometry, this.trackMaterial);
        this.trackMesh.frustumCulled = false;
        this.trackMesh.matrixAutoUpdate = false;

        // --- Buildings + ground -------------------------------------------
        {
            const rnd = makeDotNetRandom(12345);
            const numBuildingsX = Math.trunc(trackRadius / 6.25);
            const radiusOverdrive = 1.2;
            for (let z = 0; z < numBuildingsX; z++) {
                for (let x = 0; x < numBuildingsX; x++) {
                    const pos = new Vec3(
                        ((x / (numBuildingsX - 1)) - 0.5) * 2 * trackRadius * radiusOverdrive,
                        -20,
                        ((z / (numBuildingsX - 1)) - 0.5) * 2 * trackRadius * radiusOverdrive,
                    );
                    if (Math.abs(pos.length() - trackRadius) > trackWidth + 50) {
                        continue;
                    }
                    const building = new SuperQuadric();
                    const bSize = Math.pow(rnd(), 3);
                    building.dimension = new Vec3(5 + 10 * bSize, 20 + 80 * bSize, 5 + bSize * 10);
                    building.world = Mat4.createWorld(pos, new Vec3(0, 0, -1), Vec3.up);
                    building.sqParams = new Vec4(0, 0, 0, 0);
                    building.colorEmissive = new Vec4(0, 0, 0, 1);

                    const bb: Aabb = {
                        min: pos.sub(building.dimension),
                        max: pos.add(building.dimension),
                    };
                    if (!this.trackCollision.intersects(bb)) {
                        this.buildings.push(building);
                    }
                }
            }

            const groundMesh = new SuperQuadric();
            groundMesh.dimension = new Vec3(trackRadius * 5, 5, trackRadius * 5);
            groundMesh.world = Mat4.createWorld(new Vec3(0, -45, 0), new Vec3(0, 0, -1), Vec3.up);
            groundMesh.sqParams = new Vec4(0, 0, 0, 0);
            groundMesh.colorEmissive = new Vec4(0, 0, 0, 0);
            this.buildings.push(groundMesh);
        }

        // Capacity for the batch that draws them (culled subset each frame).
        this.buildingsBatch = new SuperQuadricBatch(12, this.buildings.length + 1);
        this.buildingsBatchMesh = this.buildingsBatch.mesh;
    }

    public firstTrackHit(ray: Ray): { position: Vec3; normal: Vec3 } | undefined {
        return this.trackCollision.firstHit(ray);
    }

    /** Port of GetPointOnTrack(u, v[, out normal]). */
    public trackSurfacePoint(u: number, v: number, withNormal = false): { point: Vec3; normal: Vec3 } {
        return this.sst.getSurfacePoint(u, v, withNormal);
    }

    /** Culls the buildings against the view frustum and uploads them. */
    public uploadVisibleBuildings(viewProj: Mat4): void {
        const planes = frustumPlanes(viewProj);
        const visible: SuperQuadric[] = [];
        for (const building of this.buildings) {
            const center = building.world.translation();
            const dim = building.dimension;
            // The original tests pos +/- Dimension (full dimension, not half).
            const radius = dim.length();
            if (sphereVisible(planes, center, radius)) {
                visible.push(building);
            }
        }
        this.buildingsBatch.setInstances(visible);
    }

    public update(): void {
        // Port of ProceduralRenderer.Update: a no-op TODO in the original.
    }
}

/** Updates the track shader uniforms for the current frame. */
export function applyTrackUniforms(
    material: ShaderMaterial,
    viewPosition: Vec3,
    lightDir: Vec3,
    skyColor: Vec4,
    groundColor: Vec4,
): void {
    const set = (name: string, v: ThreeVector3): void => {
        const uniform = material.uniforms[name];
        if (uniform !== undefined && uniform.value instanceof ThreeVector3) {
            uniform.value.copy(v);
        }
    };
    set("viewPos", new ThreeVector3(viewPosition.x, viewPosition.y, viewPosition.z));
    set("lightDir", new ThreeVector3(lightDir.x, lightDir.y, lightDir.z));
    set("skyColor", new ThreeVector3(skyColor.x, skyColor.y, skyColor.z));
    set("groundColor", new ThreeVector3(groundColor.x, groundColor.y, groundColor.z));
}
