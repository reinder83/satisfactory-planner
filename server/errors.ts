// The errors the server modules throw. A thrown error with a status is sent to the browser by
// server.ts with that status and its message.

// A function declaration, so TypeScript knows the code after a failed check is unreachable.
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
// The error code of a failed file read, if it has one.
export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
