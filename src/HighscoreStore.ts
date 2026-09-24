/**
 * HighscoreStore - port of SQR.HighscoreData.cs.
 *
 * Persists the top-10 highscore entries per game mode and category in
 * localStorage (the original used the XNA storage device). Lists are seeded
 * with the original's default entries when no data exists yet.
 */

export interface HighscoreEntry {
    place: number;
    score: number;
    gamerTag: string;
}

interface RawEntry {
    score: number;
    gamerTag: string;
}

/** Port of HighscoreData's default entries. */
const DEFAULT_ENTRIES: RawEntry[] = [
    { score: 1000000, gamerTag: "Rotkaeppchen" },
    { score: 800000, gamerTag: "Rike" },
    { score: 500000, gamerTag: "Kuchen" },
    { score: 300000, gamerTag: "Dude" },
    { score: 150000, gamerTag: "pal" },
    { score: 80000, gamerTag: "Cookie" },
    { score: 40000, gamerTag: "superquadric" },
    { score: 20000, gamerTag: "guy" },
    { score: 10000, gamerTag: "cube" },
    { score: 5000, gamerTag: "polygon" },
];

const STORAGE_KEY = "sqr.highscores";
const MAX_ENTRIES = 10;

type StorageRecord = Record<string, RawEntry[]>;

function readAll(): StorageRecord {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) {
            return {};
        }
        const parsed = JSON.parse(raw) as StorageRecord;
        if (typeof parsed !== "object" || parsed === null) {
            return {};
        }
        return migrate(parsed);
    } catch {
        // Corrupted storage: start from defaults.
        return {};
    }
}

/**
 * One-time remap after the two flag categories were merged. Only the old
 * 4-category layout has boards keyed ":3" (Mix), so its presence detects
 * stale data: common/uncommon (":0"/":1") merge into ":0" (best-of top 10),
 * food ":2" moves to ":1", mix ":3" moves to ":2".
 */
function migrate(record: StorageRecord): StorageRecord {
    if (!Object.keys(record).some((k) => k.endsWith(":3"))) {
        return record;
    }
    const out: StorageRecord = {};
    for (const [k, entries] of Object.entries(record)) {
        const sep = k.lastIndexOf(":");
        const cat = Number(k.slice(sep + 1));
        const newKey = cat <= 1 ? `${k.slice(0, sep)}:0` : `${k.slice(0, sep)}:${cat - 1}`;
        const merged = (out[newKey] ?? []).concat(entries ?? []);
        merged.sort((a, b) => b.score - a.score);
        out[newKey] = merged.slice(0, 10);
    }
    writeAll(out);
    return out;
}

function writeAll(record: StorageRecord): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
        // Storage unavailable (private mode etc.): scores stay in memory.
    }
}

function key(gameMode: number, categoryIndex: number): string {
    return `${gameMode}:${categoryIndex}`;
}

function withPlaces(raw: RawEntry[]): HighscoreEntry[] {
    return raw.map((entry, index) => ({
        place: index + 1,
        score: entry.score,
        gamerTag: entry.gamerTag,
    }));
}

export class HighscoreStore {
    /** Port of HighscoreData's entry list for a mode/category combination. */
    public static load(gameMode: number, categoryIndex: number): HighscoreEntry[] {
        const stored = readAll()[key(gameMode, categoryIndex)];
        const raw = stored ?? DEFAULT_ENTRIES.map((entry) => ({ ...entry }));
        return withPlaces(raw);
    }

    /**
     * Port of HighscoreData.AddNewEntry: inserts the score, ranks the list,
     * keeps the top 10, persists everything and returns the stored list
     * together with the index of the new entry (for the pulse highlight).
     */
    public static add(
        gameMode: number,
        categoryIndex: number,
        score: number,
        gamerTag: string,
    ): { entries: HighscoreEntry[]; newIndex: number } {
        const record = readAll();
        const k = key(gameMode, categoryIndex);
        const raw = (record[k] ?? DEFAULT_ENTRIES.map((entry) => ({ ...entry }))).slice();
        const newEntry: RawEntry = { score, gamerTag };
        raw.push(newEntry);
        // Port of HighscoreData.EntryComparison: descending by score.
        raw.sort((a, b) => b.score - a.score);
        raw.length = Math.min(raw.length, MAX_ENTRIES);
        record[k] = raw;
        writeAll(record);
        return {
            entries: withPlaces(raw),
            newIndex: raw.indexOf(newEntry),
        };
    }
}
