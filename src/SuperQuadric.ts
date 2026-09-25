import {
    BufferAttribute,
    Camera,
    DoubleSide,
    DynamicDrawUsage,
    Float32BufferAttribute,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    Matrix4,
    Mesh,
    ShaderMaterial,
    Vector3,
} from "three";
import { Mat4, Vec3, Vec4 } from "./XnaMath.ts";

const SQ_VERTEX_SHADER = /* glsl */ `
attribute vec4 sincosuv;
attribute vec4 instanceWorld0;
attribute vec4 instanceWorld1;
attribute vec4 instanceWorld2;
attribute vec4 instanceWorld3;
attribute vec4 instanceDimensionR;
attribute vec4 instanceNeRadNS;
attribute vec4 instanceDiffuse;
attribute vec4 instanceEmissive;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec4 vColorDiffuse;
varying vec4 vColorEmissive;

float sq(float v, float n) {
    return sign(v) * pow(abs(v), n);
}

void main() {
    mat4 customWorld = mat4(
        instanceWorld0,
        instanceWorld1,
        instanceWorld2,
        instanceWorld3
    );

    float sinu = sincosuv.x;
    float cosu = sincosuv.y;
    float sinv = sincosuv.z;
    float cosv = sincosuv.w;

    float n = instanceNeRadNS.x;
    float e = instanceNeRadNS.y;
    float radius = instanceDimensionR.w;
    float rad = instanceNeRadNS.z;
    float nSpecial = instanceNeRadNS.w;

    n = (atan(cosv, sinv) < rad) ? nSpecial : n;

    vec4 pos;
    pos.x = instanceDimensionR.x * (radius + sq(cosu, e)) * sq(sinv, n);
    pos.y = instanceDimensionR.y * sq(sinu, e);
    pos.z = instanceDimensionR.z * (radius + sq(cosu, e)) * sq(cosv, n);
    pos.w = 1.0;

    pos = customWorld * pos;

    gl_Position = projectionMatrix * viewMatrix * pos;

    vec3 normal;
    normal.x = sq(cosu, 2.0 - e) * sq(sinv, 2.0 - n) / instanceDimensionR.x;
    normal.y = sq(sinu, 2.0 - e) / instanceDimensionR.y;
    normal.z = sq(cosu, 2.0 - e) * sq(cosv, 2.0 - n) / instanceDimensionR.z;

    vNormal = mat3(customWorld) * normal;
    vWorldPosition = pos.xyz;
    vColorDiffuse = instanceDiffuse;
    vColorEmissive = instanceEmissive;
}
`;

const SQ_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 lightDir;
uniform vec3 viewPos;
uniform vec3 skyColor;
uniform vec3 groundColor;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec4 vColorDiffuse;
varying vec4 vColorEmissive;

void main() {
    vec3 viewDir = normalize(vWorldPosition - viewPos);
    vec3 normal = normalize(vNormal);

    float lambert = dot(lightDir, normal) * 0.5 + 0.5;
    float diffuse = lambert * lambert;

    vec3 reflection = normalize(reflect(viewDir, normal));
    float specular = pow(clamp(dot(lightDir, reflection), 0.0, 1.0), 9.0) * vColorEmissive.a;

    vec3 ambientLight = mix(groundColor, skyColor, diffuse);
    gl_FragColor.rgb = (diffuse * vColorDiffuse.rgb + ambientLight) + specular + vColorEmissive.rgb;
    gl_FragColor.a = vColorDiffuse.a + specular;
}
`;

export class SuperQuadric {
    public world = Mat4.identity();
    public radius = 0;
    public dimension = new Vec3(0.5, 0.5, 0.5);
    public sqParams = new Vec4(1, 1, -10, 1);
    public colorDiffuse = new Vec4(1, 1, 1, 1);
    public colorEmissive = new Vec4(0, 0, 0, 0);
    /** Optional keyframe animation (IconMap/Praising dispersion sequences). */
    public praiseAnimation: { apply(target: SuperQuadric, time: number): void } | undefined;

    public static lightDir = new Vec3(0.5, 1, -1);
    public static skyColor = new Vec4(0, 0.1, 0.3, 1);
    public static groundColor = new Vec4(0.15, 0.15, 0.35, 1);

    public static resetStandardParameters(): void {
        SuperQuadric.skyColor = new Vec4(0, 0.1, 0.3, 1);
        SuperQuadric.groundColor = new Vec4(0.15, 0.15, 0.35, 1);
        SuperQuadric.lightDir = Vec3.normalize(new Vec3(0.5, 1, -1));
    }

    public static setLightDir(value: Vec3): void {
        SuperQuadric.lightDir = Vec3.normalize(value);
    }
}

interface ShapeCache {
    geometry: InstancedBufferGeometry;
    world0: InstancedBufferAttribute;
    world1: InstancedBufferAttribute;
    world2: InstancedBufferAttribute;
    world3: InstancedBufferAttribute;
    dimensionR: InstancedBufferAttribute;
    neRadNS: InstancedBufferAttribute;
    diffuse: InstancedBufferAttribute;
    emissive: InstancedBufferAttribute;
}

function fillShapeBuffers(numVerticesXRaw: number, torus: boolean): {
    sincos: Float32Array;
    indices: Uint16Array;
} {
    // Port of InitConstants: the grid is clamped to sane thresholds. The
    // vessel requests 4 but the original renders it at 6 - below that the
    // latitude samples miss the equator and the "round cubes" turn boxy.
    const numVerticesX = Math.max(6, Math.min(180, numVerticesXRaw));
    const numQuadsX = numVerticesX - 1;
    const numVertices = numVerticesX * numVerticesX;
    const numIndices = numQuadsX * numQuadsX * 6;
    const sincos = new Float32Array(numVertices * 4);
    const indices = new Uint16Array(numIndices);

    let vp = 0;
    for (let m = 0; m < numVerticesX; m++) {
        for (let n = 0; n < numVerticesX; n++) {
            let u = n / numQuadsX;
            let v = m / numQuadsX;

            const uh = (u - 0.5) * 2;
            const vh = (v - 0.5) * 2;
            const us = Math.sign(uh) * 0.5;
            const vs = Math.sign(vh) * 0.5;
            u = us * Math.pow(Math.abs(uh), 0.5) + 0.5;
            v = vs * Math.pow(Math.abs(vh), 1) + 0.5;

            let radu = (u - 0.5) * Math.PI;
            const radv = (v - 0.5) * Math.PI * 2;

            let sinu = Math.sin(radu);
            let cosu = Math.cos(radu);
            let sinv = Math.sin(radv);
            let cosv = Math.cos(radv);

            if (n === 0) {
                sinu = -1;
                cosu = 0;
            }
            if (n === numQuadsX) {
                sinu = 1;
                cosu = 0;
            }
            if (m === 0) {
                sinv = 0;
                cosv = -1;
            }
            if (m === numQuadsX) {
                sinv = 0;
                cosv = -1;
            }

            if (torus) {
                radu *= 2;
                sinu = Math.sin(radu);
                cosu = Math.cos(radu);
                if (n === 0) {
                    sinu = 0;
                    cosu = -1;
                }
                if (n === numQuadsX) {
                    sinu = 0;
                    cosu = -1;
                }
            }

            const i = vp * 4;
            sincos[i] = sinu;
            sincos[i + 1] = cosu;
            sincos[i + 2] = sinv;
            sincos[i + 3] = cosv;
            vp++;
        }
    }

    let ip = 0;
    const stepSize = 1;
    for (let z = 0; z < numQuadsX; z += stepSize) {
        for (let x = 0; x < numQuadsX; x += stepSize) {
            const z1 = Math.min(numQuadsX, z + stepSize);
            const x1 = Math.min(numQuadsX, x + stepSize);
            indices[ip] = z1 * numVerticesX + x;
            indices[ip + 1] = z * numVerticesX + x;
            indices[ip + 2] = z * numVerticesX + x1;
            indices[ip + 3] = z1 * numVerticesX + x;
            indices[ip + 4] = z * numVerticesX + x1;
            indices[ip + 5] = z1 * numVerticesX + x1;
            ip += 6;
        }
    }

    return { sincos, indices };
}

function createShapeCache(numVerticesX: number, maxInstances: number, torus: boolean): ShapeCache {
    const { sincos, indices } = fillShapeBuffers(numVerticesX, torus);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("sincosuv", new Float32BufferAttribute(sincos, 4));
    geometry.setIndex(new BufferAttribute(indices, 1));
    geometry.instanceCount = maxInstances;

    const world0 = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const world1 = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const world2 = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const world3 = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const dimensionR = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const neRadNS = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const diffuse = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);
    const emissive = new InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4);

    for (const attr of [world0, world1, world2, world3, dimensionR, neRadNS, diffuse, emissive]) {
        attr.setUsage(DynamicDrawUsage);
    }

    geometry.setAttribute("instanceWorld0", world0);
    geometry.setAttribute("instanceWorld1", world1);
    geometry.setAttribute("instanceWorld2", world2);
    geometry.setAttribute("instanceWorld3", world3);
    geometry.setAttribute("instanceDimensionR", dimensionR);
    geometry.setAttribute("instanceNeRadNS", neRadNS);
    geometry.setAttribute("instanceDiffuse", diffuse);
    geometry.setAttribute("instanceEmissive", emissive);

    return {
        geometry,
        world0,
        world1,
        world2,
        world3,
        dimensionR,
        neRadNS,
        diffuse,
        emissive,
    };
}

function writeInstance(cache: ShapeCache, index: number, sq: SuperQuadric): void {
    const e = sq.world.elements;
    cache.world0.setXYZW(index, e[0] ?? 0, e[1] ?? 0, e[2] ?? 0, e[3] ?? 0);
    cache.world1.setXYZW(index, e[4] ?? 0, e[5] ?? 0, e[6] ?? 0, e[7] ?? 0);
    cache.world2.setXYZW(index, e[8] ?? 0, e[9] ?? 0, e[10] ?? 0, e[11] ?? 0);
    cache.world3.setXYZW(index, e[12] ?? 0, e[13] ?? 0, e[14] ?? 0, e[15] ?? 0);

    cache.dimensionR.setXYZW(index, sq.dimension.x, sq.dimension.y, sq.dimension.z, sq.radius);
    cache.neRadNS.setXYZW(
        index,
        Math.max(sq.sqParams.x, 0.05),
        Math.max(sq.sqParams.y, 0.05),
        Math.max(sq.sqParams.z, -10),
        Math.max(sq.sqParams.w, 0.05),
    );
    cache.diffuse.setXYZW(index, sq.colorDiffuse.x, sq.colorDiffuse.y, sq.colorDiffuse.z, sq.colorDiffuse.w);
    cache.emissive.setXYZW(index, sq.colorEmissive.x, sq.colorEmissive.y, sq.colorEmissive.z, sq.colorEmissive.w);
}

export class SuperQuadricBatch {
    public readonly mesh: Mesh;
    private readonly material: ShaderMaterial;
    private readonly cache: ShapeCache;

    public constructor(numVerticesX: number, maxInstances: number, torus = false) {
        this.cache = createShapeCache(numVerticesX, maxInstances, torus);
        this.material = new ShaderMaterial({
            vertexShader: SQ_VERTEX_SHADER,
            fragmentShader: SQ_FRAGMENT_SHADER,
            uniforms: {
                lightDir: { value: new Vector3() },
                viewPos: { value: new Vector3() },
                skyColor: { value: new Vector3() },
                groundColor: { value: new Vector3() },
            },
            depthTest: true,
            depthWrite: true,
            // XNA default cull is CCW (keeps CW). Three.js keeps CCW.
            side: DoubleSide,
        });
        this.mesh = new Mesh(this.cache.geometry, this.material);
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
    }

    public setInstances(list: SuperQuadric[]): void {
        const count = list.length;
        this.cache.geometry.instanceCount = count;
        for (let i = 0; i < count; i++) {
            const sq = list[i];
            if (sq === undefined) {
                continue;
            }
            writeInstance(this.cache, i, sq);
        }
        this.cache.world0.needsUpdate = true;
        this.cache.world1.needsUpdate = true;
        this.cache.world2.needsUpdate = true;
        this.cache.world3.needsUpdate = true;
        this.cache.dimensionR.needsUpdate = true;
        this.cache.neRadNS.needsUpdate = true;
        this.cache.diffuse.needsUpdate = true;
        this.cache.emissive.needsUpdate = true;
    }

    public setBlending(enabled: boolean): void {
        this.material.transparent = enabled;
    }

    public setGlobals(viewPosition: Vec3): void {
        const uniforms = this.material.uniforms;
        const light = uniforms["lightDir"]?.value;
        const viewPos = uniforms["viewPos"]?.value;
        const sky = uniforms["skyColor"]?.value;
        const ground = uniforms["groundColor"]?.value;
        if (light instanceof Vector3) {
            light.set(SuperQuadric.lightDir.x, SuperQuadric.lightDir.y, SuperQuadric.lightDir.z);
        }
        if (viewPos instanceof Vector3) {
            viewPos.set(viewPosition.x, viewPosition.y, viewPosition.z);
        }
        if (sky instanceof Vector3) {
            sky.set(SuperQuadric.skyColor.x, SuperQuadric.skyColor.y, SuperQuadric.skyColor.z);
        }
        if (ground instanceof Vector3) {
            ground.set(SuperQuadric.groundColor.x, SuperQuadric.groundColor.y, SuperQuadric.groundColor.z);
        }
    }
}

const d3dToGlClip = new Matrix4().set(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 2, -1,
    0, 0, 0, 1,
);

export function applyXnaCamera(camera: Camera, view: Mat4, proj: Mat4): void {
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    // XNA stores row-major matrices for row vectors. That array is already the
    // column-major layout Three.js wants for the equivalent column-vector matrix.
    camera.matrixWorldInverse.fromArray(view.elements);
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
    camera.matrix.copy(camera.matrixWorld);
    camera.projectionMatrix.fromArray(proj.elements);
    camera.projectionMatrix.premultiply(d3dToGlClip);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}