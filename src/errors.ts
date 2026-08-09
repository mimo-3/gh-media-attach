/**
 * What went wrong, in a form callers can branch on.
 *
 * `uploads.github.com` is undocumented, so the wording of a message is not a
 * stable interface — this is. `endpoint-changed` means GitHub answered in a
 * shape this library does not recognise, which is the signal that the
 * unofficial path has moved.
 */
export type AttachFailureKind =
  | "auth"
  | "rate-limit"
  | "too-large"
  | "not-found"
  | "endpoint-changed"
  | "unknown";

export class GitHubAttachError extends Error {
  readonly kind: AttachFailureKind;
  readonly status: number | undefined;
  /** Whatever GitHub said, with HTML stripped. */
  readonly detail: string | undefined;

  constructor(message: string, kind: AttachFailureKind, status?: number, detail?: string) {
    super(message);
    this.name = "GitHubAttachError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}
