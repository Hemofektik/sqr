export function requiredElement<T extends HTMLElement>(id: string, type: new () => T): T {
    const element = document.getElementById(id);
    if (!(element instanceof type)) {
        throw new Error(`Missing #${id}`);
    }
    return element;
}
