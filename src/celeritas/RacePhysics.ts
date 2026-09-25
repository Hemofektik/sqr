/**
 * RacePhysics - Rapier rigid-body world for the Celeritas racing game.
 *
 * Deliberate deviation from the original XNA spring physics: instead of
 * springs gluing the vessel to the road, the track is a real static collider
 * (trimesh matching the render mesh) and the ship is a dynamic body with
 * gravity, a ray-cast suspension, contacts and restitution - so it can go
 * airborne, jump off the terrain, land and bounce off borders naturally.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { Vec3 } from "../XnaMath.ts";
import type { RaceTrack } from "./RaceTrack.ts";

let rapierReady: Promise<void> | undefined;

/** Loads the Rapier WASM module once; must resolve before building the world. */
export function initRapier(): Promise<void> {
    rapierReady ??= RAPIER.init();
    return rapierReady;
}

export const FIXED_STEP = 1 / 60;

export interface WorldRayHit {
    toi: number;
    normal: Vec3;
}

export class CeleritasWorld {
    public readonly world: RAPIER.World;
    public readonly ship: RAPIER.RigidBody;
    public readonly shipCollider: RAPIER.Collider;

    public constructor(track: RaceTrack) {
        this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        const scenery = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

        // The track: a trimesh built from the render mesh itself, so what you
        // see is exactly what you collide with (no ray probes, no holes).
        this.world.createCollider(
            RAPIER.ColliderDesc.trimesh(track.renderVertices, new Uint32Array(track.renderIndices))
                .setRestitution(0.25)
                // Traction comes from the vessel's suspension grip, not
                // collider friction - keep this low so wedged hulls slide
                // free instead of locking against steep terrain faces.
                .setFriction(0.2),
            scenery,
        );

        // Buildings + ground plane as boxes (their visual extent is +-dimension).
        for (const b of track.buildings) {
            const e = b.world.elements;
            this.world.createCollider(
                RAPIER.ColliderDesc.cuboid(b.dimension.x, b.dimension.y, b.dimension.z)
                    .setTranslation(e[12] ?? 0, e[13] ?? 0, e[14] ?? 0)
                    .setRestitution(0.3)
                    // Low like the track: high friction here let a throttled
                    // hull stick to a building wall in mid-air.
                    .setFriction(0.2),
                scenery,
            );
        }

        // The vessel hull (voxel extent is about 2 x 0.4 x 4 around a body
        // origin at the hull bottom; the collider is slightly taller for
        // stable contacts). Mass 1 matches the original physics constants.
        this.ship = this.world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setCcdEnabled(true)
                .setLinearDamping(0.65)
                // Angular damping settles crash tumbling; without it a spin
                // picked up off-road never dies (Rapier defaults to 0) and
                // the thrust vector just whirls in circles.
                .setAngularDamping(0.8),
        );
        this.shipCollider = this.world.createCollider(
            // Rounded hull: a flat nose jammed into a steep terrain face
            // creates a wide contact patch that locks solid; rounded edges
            // glance off instead.
            RAPIER.ColliderDesc.roundCuboid(1, 0.4, 1.9, 0.35)
                .setTranslation(0, 0.1, 0.9)
                .setRestitution(0.1)
                .setFriction(0.2)
                .setMass(1),
            this.ship,
        );
    }

    /** Ray cast against everything except the ship itself. */
    public castRay(origin: Vec3, dir: Vec3, maxToi: number): WorldRayHit | undefined {
        const ray = new RAPIER.Ray(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: dir.x, y: dir.y, z: dir.z },
        );
        const hit = this.world.castRayAndGetNormal(
            ray, maxToi, true, undefined, undefined, undefined, this.ship,
        );
        if (hit === null) {
            return undefined;
        }
        return {
            toi: hit.timeOfImpact,
            normal: new Vec3(hit.normal.x, hit.normal.y, hit.normal.z),
        };
    }

    public step(dt: number): void {
        this.world.timestep = dt;
        this.world.step();
    }
}
