/**
 * CeleritasScreen - port of GameStateManagement.CeleritasScreen: the hidden
 * racing mini-game (press Y on the main menu). Chase camera around a procedural
 * oval track, spring-driven vessel, tacho HUD.
 */
import { Camera, Scene } from "three";
import { GameScreen } from "./ScreenManager.ts";
import type { ScreenContext } from "./ScreenManager.ts";
import { Mat4, Quat, Vec3, Vec4 } from "./XnaMath.ts";
import { SuperQuadric, SuperQuadricBatch, applyXnaCamera } from "./SuperQuadric.ts";
import { RaceTrack, applyTrackUniforms } from "./celeritas/RaceTrack.ts";
import { CeleritasWorld, initRapier } from "./celeritas/RacePhysics.ts";
import { RaceVessel } from "./celeritas/RaceVessel.ts";
import { Tacho } from "./celeritas/Tacho.ts";

// The track geometry/collision is immutable - build it once and share it
// (the original rebuilt it in LoadContent on every entry).
let sharedTrack: RaceTrack | undefined;
function getSharedTrack(): RaceTrack {
    sharedTrack ??= new RaceTrack();
    return sharedTrack;
}

export class CeleritasScreen extends GameScreen {
    public readonly kind = "celeritas" as const;

    private readonly scene = new Scene();
    private readonly camera = new Camera();
    private raceTrack: RaceTrack | undefined;
    private raceVessel: RaceVessel | undefined;
    private vesselBatch: SuperQuadricBatch | undefined;
    private tacho: Tacho | undefined;
    private musicStarted = false;

    // Continuous input, fed from Game.update (port of HandleInputInternal).
    private inputAcc = 0;
    private inputSteerX = 0;
    private inputSteerY = 0;

    public constructor() {
        super();
        this.transitionOnTime = 0.5;
        this.transitionOffTime = 0;
    }

    protected override onBound(): void {
        // Port of LoadContent (physics init is async - setupVessel finishes it).
        const font = this.manager?.context.font;
        if (font === undefined) {
            return;
        }
        this.raceTrack = getSharedTrack();
        this.tacho = new Tacho(font);

        // Port: AudioManager.SetMusicVolume(2.0f) - boost music for the race.
        const cfg = this.manager?.context.userConfig;
        if (cfg !== undefined) {
            this.manager?.context.applyAudioVolumes(cfg.sfxVolume, Math.min(1, cfg.musicVolume * 2));
        }

        // Rapier's WASM module loads async; update/draw guard on raceVessel
        // until the physics world and vessel exist.
        void initRapier().then(() => this.setupVessel());
    }

    private setupVessel(): void {
        const track = this.raceTrack;
        if (track === undefined || this.raceVessel !== undefined) {
            return;
        }
        const phys = new CeleritasWorld(track);
        const vessel = new RaceVessel(phys, track);

        const inFrontOfVessel = track.trackSurfacePoint(0.5, 0.001).point;
        const start = track.trackSurfacePoint(0.5, 0, true);
        const upNormal = start.normal;
        vessel.position = Vec3.add(start.point, Vec3.scale(upNormal, 3));
        // Port: Rotation = Invert(LookAt(inFront, position, up)) as quaternion.
        const la = Mat4.createLookAt(inFrontOfVessel, vessel.position, upNormal);
        vessel.rotation = Quat.fromMat4(transposeRotation(la));
        vessel.velocityVector = new Vec3(0, 0, 0);

        this.vesselBatch = new SuperQuadricBatch(4, vessel.sqs.length + 1);
        this.scene.add(this.vesselBatch.mesh);
        this.scene.add(track.trackMesh);
        this.scene.add(track.buildingsBatchMesh);
        this.raceVessel = vessel;
    }

    /** Restore the user's music volume when leaving (original never did; we do). */
    public override exitScreen(): void {
        super.exitScreen();
        const cfg = this.manager?.context.userConfig;
        if (cfg !== undefined) {
            this.manager?.context.applyAudioVolumes(cfg.sfxVolume, cfg.musicVolume);
        }
    }

    /** Port of the per-frame input handling (keyboard path of the original). */
    public setInput(accel: number, steerX: number, steerY: number): void {
        this.inputAcc = accel;
        this.inputSteerX = steerX;
        this.inputSteerY = steerY;
    }

    public override update(dt: number, gameTime: number, otherScreenHasFocus: boolean, coveredByOtherScreen: boolean): void {
        super.update(dt, gameTime, otherScreenHasFocus, coveredByOtherScreen);

        const track = this.raceTrack;
        const vessel = this.raceVessel;
        const tacho = this.tacho;
        if (track === undefined || vessel === undefined || tacho === undefined) {
            return;
        }

        if (!this.musicStarted && this.manager !== undefined) {
            this.musicStarted = true;
            // Port: playlist with only track 6 (racemusic01) enabled.
            this.manager.context.setMusicPlaylist([6]);
        }

        // Port of HandleInputInternal (keyboard branch).
        vessel.accelerate(this.inputAcc);
        if (this.inputSteerX !== 0 || this.inputSteerY !== 0) {
            vessel.steer(new Vec3(this.inputSteerX, this.inputSteerY, 0));
        }

        vessel.update(gameTime, dt);
        track.update();

        tacho.setVelocity(Math.trunc(vessel.speed * 3.6)); // m/s -> km/h
        tacho.update(dt);
    }

    public override draw(ctx: ScreenContext): void {
        const track = this.raceTrack;
        const vessel = this.raceVessel;
        const vesselBatch = this.vesselBatch;
        const tacho = this.tacho;
        if (track === undefined || vessel === undefined || vesselBatch === undefined || tacho === undefined) {
            return;
        }

        // Port of Draw: standard parameters, then chase camera.
        SuperQuadric.resetStandardParameters();

        const normal = vessel.trackNormal;
        const vehicleDir = vessel.rotation.toMat4().forward();
        const viewTargetPosition = Vec3.add(
            Vec3.add(vessel.position, Vec3.scale(vehicleDir, 4)),
            Vec3.scale(normal, 2),
        );
        // The original computes a view spring but then overrides
        // viewPosition = viewTargetPosition - ported without the dead code.
        const viewPosition = viewTargetPosition;
        const viewMatrix = Mat4.createLookAt(viewPosition, vessel.position, normal);
        const projMatrix = Mat4.createPerspectiveFieldOfView(1.8, ctx.viewportWidth / ctx.viewportHeight, 0.5, 10000);

        // --- Vessel pass (port of RaceVessel.Draw) --------------------------
        vessel.prepareDraw();
        SuperQuadric.skyColor = new Vec4(0.2, 0.2, 0.2, 1);
        SuperQuadric.groundColor = new Vec4(0.1, 0.1, 0.1, 1);
        // The original rotates LightDir into vessel space because its shader
        // transforms normals only by the voxel-local matrix (viewManipulation
        // is folded into the view matrix there). Our batch composes the full
        // world matrix into each instance, so normals are world-space and the
        // light must stay in world space - rotating it here applies the vessel
        // rotation twice and lights the ship from the wrong side.
        vesselBatch.setInstances(vessel.sqs);
        vesselBatch.setGlobals(viewPosition);

        // --- Track + buildings pass (port of RaceTrack.Draw) ----------------
        SuperQuadric.skyColor = new Vec4(0.3, 0.3, 0.3, 1);
        SuperQuadric.groundColor = new Vec4(0.2, 0.2, 0.2, 1);
        const viewProj = Mat4.multiply(viewMatrix, projMatrix);
        track.uploadVisibleBuildings(viewProj);
        track.buildingsBatch.setGlobals(viewPosition);
        applyTrackUniforms(
            track.trackMaterial,
            viewPosition,
            new Vec3(0.5, 1, -1).normalize(),
            new Vec4(0.3, 0.3, 0.3, 1),
            new Vec4(0.2, 0.2, 0.2, 1),
        );

        applyXnaCamera(this.camera, viewMatrix, projMatrix);
        ctx.renderScene(this.scene, this.camera, 0.2, 0.9);

        // --- HUD ------------------------------------------------------------
        SuperQuadric.skyColor = new Vec4(0, 0, 0, 0);
        SuperQuadric.groundColor = new Vec4(0, 0, 0, 0);
        tacho.draw(0.5);
    }
}

/** Inverse of a rigid rotation matrix (rotation part transposed). */
function transposeRotation(m: Mat4): Mat4 {
    const e = m.elements;
    const t = new Mat4();
    const d = t.elements;
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            d[r * 4 + c] = e[c * 4 + r] ?? 0;
        }
    }
    d[15] = 1;
    return t;
}
