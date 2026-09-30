// What the workspace's route handlers get and return. workspace.ts builds a WorkspaceContext,
// hands it to each group of handlers (account-routes.ts, save-routes.ts, profile-routes.ts)
// and looks up one handler per endpoint in their tables.
import type { IncomingMessage } from 'node:http';
import type {
  ProgressState,
  StoredUser,
  UpdateOp,
  WorkspaceSummary,
} from '../public/types/index.ts';
import type { Commit, Profile, Save, Workspace } from './persistence.ts';
import type { Limits } from './limits.ts';

// A request body: parsed JSON whose fields are not checked yet.
export type Body = Record<string, unknown>;
// What route() returns for server.ts to send.
export interface RouteReply {
  data: unknown;
  status: number;
  headers: Record<string, string>;
}
export type Route = (
  req: IncomingMessage,
  url: URL,
  body: (req: IncomingMessage) => Promise<unknown>,
) => Promise<RouteReply>;
// What a route handler gets: the request, its URL, a reader for its JSON body (server.ts
// enforces the size limit; only routes that need a body call it) and the requesting user,
// who is null or undefined when signed out. A handler in userRoutes always has a user; one in
// scopedRoutes also has the save and profile scope() resolved.
export interface RouteRequest {
  req: IncomingMessage;
  url: URL;
  body: () => Promise<Body>;
  user: StoredUser | null | undefined;
}
export type UserRequest = RouteRequest & { user: StoredUser };
export type ScopedRequest = UserRequest & { save: Save; profile: Profile };
export type Handler<Request> = (request: Request) => RouteReply | Promise<RouteReply>;
// A route's reply: JSON data, 200 unless given, and any extra headers.
export const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): RouteReply => ({ data, status, headers });

// Everything the handlers share: the workspace as the last commit left it, the commit queue,
// the rate limits, the user's summary and scope (scope.ts, bound to the current workspace), and
// the options openWorkspace was given.
export interface WorkspaceContext {
  current: () => Workspace;
  commit: Commit;
  limits: Limits;
  setupToken: string;
  summary: (user: StoredUser | null | undefined) => WorkspaceSummary;
  // The requesting user's summary as the workspace now holds it, read after a commit.
  currentSummary: (user: StoredUser) => WorkspaceSummary;
  scope: (
    req: { headers: Record<string, unknown> },
    url: URL,
    user: StoredUser,
  ) => { save: Save; profile: Profile };
  // The save and profile a request body names (saveId, profileId), checked by scope() like the
  // headers are.
  scopeNamed: (input: Body, url: URL, user: StoredUser) => { save: Save; profile: Profile };
  validateState: (state: unknown) => ProgressState;
  mutate: (state: ProgressState, update: UpdateOp) => ProgressState;
  rankBudgetMs: number;
}
