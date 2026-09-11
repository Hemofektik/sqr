interface CurveKey {
    position: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

import curvesJson from "./curves.json";

/** Loads a named curve from the converted XNA curve assets (src/curves.json). */
export function loadCurve(name: string): Curve {
    const keys = curvesJson[name as keyof typeof curvesJson];
    const curve = new Curve();
    for (const key of keys ?? []) {
        curve.addKey(key.position, key.value, key.tangentIn, key.tangentOut);
    }
    return curve;
}

export class Curve {
    public preLoop: "constant" = "constant";
    public postLoop: "constant" = "constant";
    public readonly keys: CurveKey[] = [];

    public addKey(position: number, value: number, tangentIn = 0, tangentOut = 0): void {
        this.keys.push({ position, value, tangentIn, tangentOut });
        this.keys.sort((a, b) => a.position - b.position);
    }

    public evaluate(position: number): number {
        const keys = this.keys;
        const first = keys[0];
        const last = keys[keys.length - 1];
        if (first === undefined || last === undefined) {
            return 0;
        }
        if (position <= first.position) {
            return first.value;
        }
        if (position >= last.position) {
            return last.value;
        }

        let index = 0;
        for (let i = 0; i < keys.length - 1; i++) {
            const next = keys[i + 1];
            if (next !== undefined && position < next.position) {
                index = i;
                break;
            }
        }

        const k0 = keys[index];
        const k1 = keys[index + 1];
        if (k0 === undefined || k1 === undefined) {
            return last.value;
        }

        const dt = k1.position - k0.position;
        if (dt <= 1e-8) {
            return k1.value;
        }
        const t = (position - k0.position) / dt;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = (2 * t3) - (3 * t2) + 1;
        const h10 = t3 - (2 * t2) + t;
        const h01 = (-2 * t3) + (3 * t2);
        const h11 = t3 - t2;
        return (h00 * k0.value) + (h10 * k0.tangentOut * dt) + (h01 * k1.value) + (h11 * k1.tangentIn * dt);
    }

    public static smoothStep(): Curve {
        const curve = new Curve();
        curve.addKey(0, 0, 0, 0);
        curve.addKey(1, 1, 0, 0);
        return curve;
    }

    public static bell(): Curve {
        const curve = new Curve();
        curve.addKey(0, 0, 0, 0);
        curve.addKey(0.4, 1, 0, 0);
        curve.addKey(0.6, 1, 0, 0);
        curve.addKey(1, 0, 0, 0);
        return curve;
    }
}
