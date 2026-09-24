/**
 * UserConfig - port of SQR.UserConfig.cs.
 *
 * Persists the player's settings in localStorage (the original used the XNA
 * storage device). Defaults match the original constructor.
 */
export interface UserConfigData {
    category: number;
    lastGameModeIndex: number;
    sfxVolume: number;
    musicVolume: number;
    brightness: number;
    invertYAxis: boolean;
    /** Unlocked icon count per category index. */
    numIconsUnlocked: number[];
}

export const NUM_UNLOCKED_ICONS_BY_DEFAULT = 10; // port of NumUnlockedIconsByDefault

const STORAGE_KEY = "sqr.userconfig";

function defaultConfig(numCategories: number): UserConfigData {
    return {
        category: 0,
        lastGameModeIndex: 1,
        sfxVolume: 0.45,
        musicVolume: 0.4,
        brightness: 0.5,
        invertYAxis: false,
        numIconsUnlocked: Array.from({ length: numCategories }, () => NUM_UNLOCKED_ICONS_BY_DEFAULT),
    };
}

export class UserConfig {
    private data: UserConfigData;

    public constructor(numCategories: number) {
        this.data = defaultConfig(numCategories);
        this.load(numCategories);
    }

    private load(numCategories: number): void {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw === null) {
                return;
            }
            const parsed = JSON.parse(raw) as Partial<UserConfigData>;
            const defaults = defaultConfig(numCategories);
            // Migration: the two flag categories were merged into one, so the
            // stored unlock counts shrink from 4 to 3 entries:
            // [common, uncommon, food, mix] -> [merged flags, food, mix].
            // One free unlock set is dropped (the merged category has its own
            // default), and the stored category index remaps 0/1 -> 0.
            const oldUnlocked = parsed.numIconsUnlocked;
            const isOldLayout = oldUnlocked !== undefined
                && oldUnlocked.length === defaults.numIconsUnlocked.length + 1;
            let numIconsUnlocked = defaults.numIconsUnlocked.map(
                (def, i) => oldUnlocked?.[i] ?? def,
            );
            let category = parsed.category ?? defaults.category;
            if (isOldLayout && oldUnlocked !== undefined) {
                numIconsUnlocked = [
                    Math.max(
                        NUM_UNLOCKED_ICONS_BY_DEFAULT,
                        (oldUnlocked[0] ?? 0) + (oldUnlocked[1] ?? 0) - NUM_UNLOCKED_ICONS_BY_DEFAULT,
                    ),
                    oldUnlocked[2] ?? defaults.numIconsUnlocked[1] ?? 0,
                    oldUnlocked[3] ?? defaults.numIconsUnlocked[2] ?? 0,
                ];
                category = category <= 1 ? 0 : category - 1;
            }
            this.data = {
                ...defaults,
                ...parsed,
                category,
                numIconsUnlocked,
            };
        } catch {
            // Corrupted storage: keep defaults.
        }
    }

    public save(): void {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch {
            // Storage unavailable (private mode etc.): settings stay in memory.
        }
    }

    public get category(): number {
        return this.data.category;
    }

    public set category(value: number) {
        if (this.data.category !== value) {
            this.data.category = value;
            this.save();
        }
    }

    public get lastGameModeIndex(): number {
        return this.data.lastGameModeIndex;
    }

    public set lastGameModeIndex(value: number) {
        if (this.data.lastGameModeIndex !== value) {
            this.data.lastGameModeIndex = value;
            this.save();
        }
    }

    public get sfxVolume(): number {
        return this.data.sfxVolume;
    }

    public set sfxVolume(value: number) {
        if (this.data.sfxVolume !== value) {
            this.data.sfxVolume = value;
            this.save();
        }
    }

    public get musicVolume(): number {
        return this.data.musicVolume;
    }

    public set musicVolume(value: number) {
        if (this.data.musicVolume !== value) {
            this.data.musicVolume = value;
            this.save();
        }
    }

    public get brightness(): number {
        return this.data.brightness;
    }

    public set brightness(value: number) {
        if (this.data.brightness !== value) {
            this.data.brightness = value;
            this.save();
        }
    }

    public get invertYAxis(): boolean {
        return this.data.invertYAxis;
    }

    public set invertYAxis(value: boolean) {
        if (this.data.invertYAxis !== value) {
            this.data.invertYAxis = value;
            this.save();
        }
    }

    public getNumIconsUnlocked(categoryIndex: number): number {
        return this.data.numIconsUnlocked[categoryIndex] ?? NUM_UNLOCKED_ICONS_BY_DEFAULT;
    }

    public unlockIcon(categoryIndex: number): void {
        const current = this.getNumIconsUnlocked(categoryIndex);
        this.data.numIconsUnlocked[categoryIndex] = current + 1;
        this.save();
    }
}