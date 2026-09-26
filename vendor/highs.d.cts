// Types for the vendored HiGHS build (highs.cjs), which ships none. It exports one loader
// that resolves to the solver module; optimizer.ts describes the part of it the planner uses.
declare function loadHighs(options?: { locateFile?: (name: string) => string }): Promise<unknown>;
export = loadHighs;
