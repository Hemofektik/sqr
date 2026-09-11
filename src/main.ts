import { Game } from "./Game.ts";

document.oncontextmenu = (): boolean => false;

function main(): void {
    const canvas = document.getElementById("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
        return;
    }

    const game = new Game(canvas);
    const animloop = (): void => {
        game.update();
        window.requestAnimationFrame(animloop);
    };
    animloop();
}

window.addEventListener("load", main);
