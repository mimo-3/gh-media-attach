/**
 * What went wrong, in a form callers can branch on.
 *
 * `uploads.github.com` is undocumented, so the wording of a message is not a
 * stable interface — this is. `endpoint-changed` means GitHub answered in a
 * shape this library does not recognise, which is the signal that the
 * unofficial path has moved. `conflict` means GitHub answered in a shape this
 * library understands, but someone else changed the target in the meantime.
 */
export type AttachFailureKind =
  | "auth"
  | "rate-limit"
  | "too-large"
  | "not-found"
  | "upload-unavailable"
  | "endpoint-changed"
  | "invalid-input"
  | "conflict"
  | "file"
  | "network"
  | "aborted"
  | "server"
  | "unknown";

export class GitHubAttachError extends Error {
  readonly kind: AttachFailureKind;
  readonly status: number | undefined;
  /** A short, sanitised detail from GitHub or the underlying failure. */
  readonly detail: string | undefined;

  constructor(
    message: string,
    kind: AttachFailureKind,
    status?: number,
    detail?: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GitHubAttachError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Keep every public failure inside the package's stable error contract. */
export function wrapFailure(
  error: unknown,
  message: string,
  kind: AttachFailureKind,
): GitHubAttachError {
  if (error instanceof GitHubAttachError) return error;

  const detail = sanitizeTerminalText(
    error instanceof Error ? error.message : safeString(error),
  ).slice(0, 300);
  return new GitHubAttachError(message, kind, undefined, detail, error);
}

export function isAbortFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError" || error.message === "The operation was aborted")
  );
}

/** Neutralise terminal escapes, log rewriting and bidirectional text spoofing. */
export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeString(value: unknown): string {
  try {
    return String(value).slice(0, 300);
  } catch {
    return "unprintable failure";
  }
}
