import { Curve } from "./Curve.ts";

export class Animation {
    public duration: number;
    public timeCurve: Curve | undefined;
    public isRunning = false;
    public startTime = 0;
    public progress = 0;
    public timeProgress = 0;

    public constructor(duration: number) {
        this.duration = duration;
    }

    public start(totalSeconds: number): void {
        this.startTime = totalSeconds;
        this.isRunning = true;
        this.update(totalSeconds);
    }

    public update(totalSeconds: number): void {
        if (!this.isRunning) {
            return;
        }

        this.timeProgress = (totalSeconds - this.startTime) / this.duration;
        const curve = this.timeCurve;
        if (curve !== undefined) {
            this.progress = curve.evaluate(this.timeProgress);
        } else {
            this.progress = this.timeProgress;
        }

        if (this.timeProgress >= 1) {
            this.progress = curve !== undefined ? curve.evaluate(1) : 1;
            this.isRunning = false;
        }
    }
}
