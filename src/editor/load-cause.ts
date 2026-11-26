import * as S from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

/**
 * Why a Workflow or its App catalog could not be read. Throw sites in the
 * client name the cause as data; this module is the only place that turns a
 * cause into words, so no raw error text, decode dump or fetch message ever
 * reaches the screen.
 */
const loadCauseSchema = S.Union([
  S.Struct({ kind: S.Literal("hub-index"), code: S.String }),
  S.Struct({
    kind: S.Literal("decode"),
    subject: S.Literals(["catalog", "workflow"]),
  }),
  S.Struct({ kind: S.Literal("transport") }),
  S.Struct({ kind: S.Literal("denied") }),
  S.Struct({ kind: S.Literal("rebuilding") }),
  S.Struct({
    kind: S.Literal("not-found"),
    subject: S.Literals(["workflow", "version"]),
  }),
  S.Struct({ kind: S.Literal("unexpected") }),
]);
export type LoadCause = typeof loadCauseSchema.Type;

/** The client's typed failure; `cause` keeps the underlying error for logs. */
export class LoadFailure extends Error {
  readonly load: LoadCause;
  constructor(load: LoadCause, options?: { readonly cause?: unknown }) {
    super(`Trellis could not read data (${load.kind})`, options);
    this.name = "LoadFailure";
    this.load = load;
  }
}

const isLoadFailure = S.is(S.instanceOf(LoadFailure));
const unexpected: LoadCause = { kind: "unexpected" };

/** The typed cause of a caught error; anything untyped is "unexpected". */
export const loadCause = S.decodeUnknownSync(
  S.Unknown.pipe(
    S.decodeTo(S.toType(loadCauseSchema), {
      decode: SchemaGetter.transform((caught) =>
        isLoadFailure(caught) ? caught.load : unexpected,
      ),
      encode: SchemaGetter.transform((cause) => cause),
    }),
  ),
);

/** Plain words for a cause, as a sentence fragment that ends in a full stop. */
export function loadCauseWords(cause: LoadCause): string {
  switch (cause.kind) {
    case "hub-index":
      return "the Hub couldn't list Apps right now.";
    case "decode":
      return cause.subject === "catalog"
        ? "an App's catalog entry didn't match what Trellis expects."
        : "the Hub's reply didn't match what Trellis expects.";
    case "transport":
      return "couldn't reach the Hub.";
    case "denied":
      return "Trellis doesn't have the access it needs.";
    case "rebuilding":
      return "the Hub is still rebuilding this workflow's copies; try again shortly.";
    case "not-found":
      return cause.subject === "version"
        ? "that published version no longer exists."
        : "this workflow no longer exists.";
    case "unexpected":
      return "Trellis hit an unexpected problem.";
  }
}
