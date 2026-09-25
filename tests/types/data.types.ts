// Compile-time checks of public/types/ against the real data (npm run typecheck; nothing here
// runs). A JSON import is typed with its literal strings widened to string, so each file is
// checked two ways:
//   Loose<T>       T with every string-literal union widened to string: the data must fit it,
//                  which checks every required field and every value's kind;
//   Extra<A, B>    the fields of A that B does not declare, recursively: must be never, so a
//                  field the data has is never missing from the types.
// Literal values themselves (a phase '3', a goal 'balanced') are checked at run time by
// validateState and settings(), and by tests/data-types.test.mjs.
import type {
  Catalog,
  CurrentCalculatedPlan,
  CurrentSettings,
  Handbook,
  Progression,
  ProgressState,
  SaveExport,
  StageResult,
  StoredCalculatedPlan,
  StoredStage,
  UpdateOp,
} from '../../public/types/index.ts';
import type { calculate, catalog, settings } from '../../planner.mjs';
import type {
  initialState,
  mutate,
  newProfileState,
  shareState,
  validateState,
} from '../../public/state.ts';
import type { validateTransfer } from '../../public/transfer.ts';
import handbook from '../../public/plan.json' with { type: 'json' };
import progression from '../../public/progression.json' with { type: 'json' };
import firstPlan from '../fixtures/calculated-plan-2026-09-12.json' with { type: 'json' };

// A record's values may be undefined here: TypeScript types a JSON array of objects as one
// union in which each key another element has shows as `key?: undefined`.
type Loose<T> = T extends string
  ? string
  : T extends readonly (infer X)[]
    ? Loose<X>[]
    : T extends object
      ? string extends keyof T
        ? { [key: string]: Loose<T[string & keyof T]> | undefined }
        : { [K in keyof T]: Loose<T[K]> }
      : T;

type Extra<A, B, Path extends string = ''> = A extends readonly (infer X)[]
  ? B extends readonly (infer Y)[]
    ? Extra<X, Y, `${Path}[]`>
    : never
  : A extends object
    ? B extends object
      ? string extends keyof B
        ? Extra<A[keyof A], B[string & keyof B], `${Path}.{key}`>
        : {
            [K in keyof A & string]: K extends keyof B
              ? Extra<A[K], NonNullable<B[K]>, `${Path}.${K}`>
              : `${Path}.${K}`;
          }[keyof A & string]
      : never
    : never;

// Fails to compile, naming the extra fields, unless T is never.
type NoExtra<T extends never> = T;

handbook satisfies Loose<Handbook>;
export type HandbookHasNoUndeclaredFields = NoExtra<Extra<typeof handbook, Handbook>>;

progression satisfies Loose<Progression>;
export type ProgressionHasNoUndeclaredFields = NoExtra<Extra<typeof progression, Progression>>;

firstPlan satisfies Loose<StoredCalculatedPlan>;
export type FirstPlanHasNoUndeclaredFields = NoExtra<Extra<typeof firstPlan, StoredCalculatedPlan>>;

// A plan calculated today is also a valid stored plan, once its Infinity hours are saved as
// null: the Stored types only loosen the Current ones.
declare const current: CurrentCalculatedPlan;
current satisfies StoredCalculatedPlan;
declare const result: StageResult;
result satisfies StoredStage;

// The JavaScript entry points carry these types in JSDoc. Plain .js files are not checked,
// so a broken annotation (a mistyped path, a renamed type) silently becomes an error type
// that behaves like any and passes every type-level test. Each is therefore pinned twice:
// Same<> checks it is exactly the declared type, and the @ts-expect-error lines only compile
// while the type is real, since any would accept the wrong value without an error.
type IsAny<T> = 0 extends 1 & T ? true : false;
type Same<A, B> =
  IsAny<A> extends true ? false : [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type True<T extends true> = T;
export type EntryPointTypes = [
  True<Same<ReturnType<typeof validateState>, ProgressState>>,
  True<Same<ReturnType<typeof initialState>, ProgressState>>,
  True<Same<ReturnType<typeof mutate>, ProgressState>>,
  True<Same<Parameters<typeof mutate>[1], UpdateOp>>,
  True<Same<ReturnType<typeof shareState>, ProgressState>>,
  True<Same<ReturnType<typeof newProfileState>['state'], ProgressState>>,
  True<Same<ReturnType<typeof calculate>, CurrentCalculatedPlan>>,
  True<Same<ReturnType<typeof settings>, CurrentSettings>>,
  True<Same<ReturnType<typeof catalog>, Catalog>>,
  True<Same<ReturnType<typeof validateTransfer>['saves'], SaveExport['saves']>>,
];
// @ts-expect-error a ProgressState is not a number
export const validateStateIsTyped: ReturnType<typeof validateState> = 0;
// @ts-expect-error a ProgressState is not a number
export const initialStateIsTyped: ReturnType<typeof initialState> = 0;
// @ts-expect-error a ProgressState is not a number
export const mutateIsTyped: ReturnType<typeof mutate> = 0;
// @ts-expect-error an UpdateOp is not a number
export const mutateOpIsTyped: Parameters<typeof mutate>[1] = 0;
// @ts-expect-error a ProgressState is not a number
export const shareStateIsTyped: ReturnType<typeof shareState> = 0;
// @ts-expect-error a ProgressState is not a number
export const newProfileStateIsTyped: ReturnType<typeof newProfileState>['state'] = 0;
// @ts-expect-error a calculated plan is not a number
export const calculateIsTyped: ReturnType<typeof calculate> = 0;
// @ts-expect-error settings are not a number
export const settingsIsTyped: ReturnType<typeof settings> = 0;
// @ts-expect-error a catalog is not a number
export const catalogIsTyped: ReturnType<typeof catalog> = 0;
// @ts-expect-error a save export is not a number
export const validateTransferIsTyped: ReturnType<typeof validateTransfer> = 0;
