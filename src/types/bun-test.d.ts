declare module 'bun:test' {
    export const describe: (name: string, fn: () => void) => void;
    export const it: (name: string, fn: () => void | Promise<void>) => void;
    export const beforeEach: (fn: () => void | Promise<void>) => void;
    export const expect: <T = unknown>(
        actual: T,
    ) => {
        toBe(expected: unknown): void;
        toEqual(expected: unknown): void;
        toHaveLength(expected: number): void;
        toBeNull(): void;
    };
}
