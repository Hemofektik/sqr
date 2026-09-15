/**
 * AudioManager - port of Hemofektik.AudioManager/AudioPlayer.
 *
 * Music tracks are playlists of enabled track indices (ports of CreatePlayList
 * / EnableAllTracks / ToggleTrack / Activate). SFX are one-shot cues
 * (PlayCue). All audio plays through the Web Audio API, with the volumes from
 * the persisted UserConfig (sfxVolume / musicVolume).
 */
export class AudioManager {
    private ctx: AudioContext | undefined;
    private musicGain: GainNode | undefined;
    private sfxGain: GainNode | undefined;
    private readonly musicBuffers = new Map<number, AudioBuffer>();
    private readonly sfxBuffers = new Map<string, AudioBuffer>();
    private currentSource: AudioBufferSourceNode | undefined;
    private enabledTracks = new Set<number>();
    private currentTrack = -1;
    /** Monotonic token so an older playTrack cannot overwrite a newer one. */
    private playGeneration = 0;
    /** Set while the AudioContext is suspended (before the first gesture). */
    private suspended = true;
    /** Playlist to start once the context is unlocked. */
    private pendingPlaylist: number[] | undefined;
    private readonly trackFiles: string[];
    private sfxVolume: number;
    private musicVolume: number;

    public constructor(trackFiles: string[], sfxVolume: number, musicVolume: number) {
        this.trackFiles = trackFiles;
        this.sfxVolume = sfxVolume;
        this.musicVolume = musicVolume;
    }

    /** Lazily creates the AudioContext (must happen after a user gesture). */
    private ensureContext(): AudioContext | undefined {
        if (this.ctx !== undefined) {
            return this.ctx;
        }
        const Ctor = window.AudioContext;
        if (Ctor === undefined) {
            return undefined;
        }
        this.ctx = new Ctor();
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = this.musicVolume;
        this.musicGain.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this.sfxVolume;
        this.sfxGain.connect(this.ctx.destination);
        return this.ctx;
    }

    /** Called from a user gesture to unlock audio playback in the browser. */
    public unlock(): void {
        const ctx = this.ensureContext();
        if (ctx === undefined) {
            return;
        }
        this.suspended = ctx.state !== "running";
        void ctx.resume().then(() => {
            this.suspended = false;
            // Start whatever playlist was requested before the unlock.
            const pending = this.pendingPlaylist;
            this.pendingPlaylist = undefined;
            if (pending !== undefined) {
                void this.activateList(pending);
            }
        }).catch(() => undefined);
    }

    public setSfxVolume(volume: number): void {
        this.sfxVolume = volume;
        if (this.sfxGain !== undefined) {
            this.sfxGain.gain.value = volume;
        }
    }

    public setMusicVolume(volume: number): void {
        this.musicVolume = volume;
        if (this.musicGain !== undefined) {
            this.musicGain.gain.value = volume;
        }
    }

    private async fetchBuffer(url: string): Promise<AudioBuffer | undefined> {
        const ctx = this.ensureContext();
        if (ctx === undefined) {
            return undefined;
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                return undefined;
            }
            const data = await response.arrayBuffer();
            return await ctx.decodeAudioData(data);
        } catch {
            return undefined;
        }
    }

    /** Loads a music track by playlist index (cached). */
    private async ensureMusicTrack(index: number): Promise<AudioBuffer | undefined> {
        const cached = this.musicBuffers.get(index);
        if (cached !== undefined) {
            return cached;
        }
        const file = this.trackFiles[index];
        if (file === undefined) {
            return undefined;
        }
        const buffer = await this.fetchBuffer(`/audio/music/${file}`);
        if (buffer !== undefined) {
            this.musicBuffers.set(index, buffer);
        }
        return buffer;
    }

    private async ensureSfx(cueName: string): Promise<AudioBuffer | undefined> {
        const cached = this.sfxBuffers.get(cueName);
        if (cached !== undefined) {
            return cached;
        }
        const buffer = await this.fetchBuffer(`/audio/sfx/${cueName}.ogg`);
        if (buffer !== undefined) {
            this.sfxBuffers.set(cueName, buffer);
        }
        return buffer;
    }

    /** Port of PlayList.EnableAllTracks. */
    public enableAllTracks(enabled: boolean): void {
        this.enabledTracks = new Set();
        if (enabled) {
            for (let n = 0; n < this.trackFiles.length; n++) {
                this.enabledTracks.add(n);
            }
        }
    }

    /** Port of PlayList.ToggleTrack. */
    public toggleTrack(index: number): void {
        if (this.enabledTracks.has(index)) {
            this.enabledTracks.delete(index);
        } else {
            this.enabledTracks.add(index);
        }
    }

    /** Port of PlayList.Activate: starts playing the first enabled track. */
    public async activate(): Promise<void> {
        await this.activateList([...this.enabledTracks]);
    }

    private async activateList(indices: number[]): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx === undefined) {
            return;
        }
        // The context is suspended until the first user gesture: remember the
        // request and start it from unlock() instead of fighting the warning.
        if (this.suspended || ctx.state !== "running") {
            this.pendingPlaylist = indices;
            return;
        }
        for (const index of indices) {
            // Already playing this track: keep it running instead of
            // restarting (the original's Activate was a no-op in that case).
            if (this.currentTrack === index && this.currentSource !== undefined) {
                return;
            }
            await this.playTrack(index);
            return;
        }
    }

    /** Port of PlayList.Play: continues with the first enabled track. */
    public async play(): Promise<void> {
        await this.activate();
    }

    private async playTrack(index: number): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx === undefined) {
            return;
        }
        const generation = ++this.playGeneration;
        const buffer = await this.ensureMusicTrack(index);
        if (buffer === undefined) {
            return;
        }
        // An newer playTrack was started while this one was loading.
        if (generation !== this.playGeneration) {
            return;
        }
        this.stopMusic();
        this.currentTrack = index;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.musicGain ?? ctx.destination);
        this.currentSource = source;
        source.start();
    }

    public stopMusic(): void {
        if (this.currentSource !== undefined) {
            try {
                this.currentSource.stop();
            } catch {
                // Already stopped.
            }
            this.currentSource = undefined;
        }
        this.currentTrack = -1;
    }

    public getCurrentTrack(): number {
        return this.currentTrack;
    }

    /** Port of AudioManager.PlayCue: one-shot sound effect. */
    public async playCue(cueName: string): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx === undefined) {
            return;
        }
        const buffer = await this.ensureSfx(cueName);
        if (buffer === undefined) {
            return;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.sfxGain ?? ctx.destination);
        source.start();
    }

    /** Prefetches all sfx cues so they play without a network delay. */
    public async preloadSfx(cueNames: string[]): Promise<void> {
        await Promise.all(cueNames.map((name) => this.ensureSfx(name)));
    }
}