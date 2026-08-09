import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ensureExtension, guessContentType } from "./mime.js";
import { splitRepo } from "./repo.js";
import { GitHubAttachError } from "./errors.js";
import type { AttachFailureKind } from "./errors.js";

const UPLOAD_ORIGIN = "https://uploads.github.com";
const API_ORIGIN = "https://api.github.com";

/**
 * The only URL shape GitHub renders as an inline player. Checking it is how we
 * notice the unofficial endpoint changing, instead of handing back a URL that
 * silently renders as nothing.
 */
const ASSET_URL =
  /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Asset = {
  /** `https://github.com/user-attachments/assets/<uuid>` */
  url: string;
  name: string;
  contentType: string;
  size: number;
};

export type AttachOptions = {
  /** `owner/name` */
  repo: string;
  token: string;
  /** Overrides the file name shown on GitHub. Does not affect the content type. */
  name?: string;
  /** Overrides the content type guessed from the file's extension. */
  contentType?: string;
  /** Skips the `GET /repos/...` lookup when you already know the numeric id. */
  repositoryId?: number;
  signal?: AbortSignal;
};

export type CommentOptions = {
  /** `owner/name` */
  repo: string;
  /** Issue or pull request number. */
  issue: number;
  /** Markdown body. */
  body: string;
  token: string;
  signal?: AbortSignal;
};

/**
 * Uploads a file and returns the attachment URL GitHub renders inline.
 *
 * This calls `uploads.github.com`, which GitHub does not document or support.
 * It works with a plain PAT today; a sudden failure is more likely the endpoint
 * moving than a bug in the caller, and {@link GitHubAttachError.kind} says
 * which.
 */
export async function attach(filePath: string, options: AttachOptions): Promise<Asset> {
  const bytes = await readFile(filePath);
  const name = ensureExtension(options.name ?? basename(filePath), filePath);
  const contentType = options.contentType ?? guessContentType(filePath);
  const repositoryId =
    options.repositoryId ??
    (await resolveRepositoryId(options.repo, options.token, options.signal));

  const query = new URLSearchParams({
    name,
    content_type: contentType,
    repository_id: String(repositoryId),
  });

  const response = await fetch(`${UPLOAD_ORIGIN}/user-attachments/assets?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body: bytes,
    signal: options.signal ?? null,
  });

  if (!response.ok) {
    throw await uploadFailure(response, bytes.byteLength);
  }

  const body = await readJson<{ url?: unknown }>(response, "the upload endpoint");

  if (typeof body.url !== "string" || !ASSET_URL.test(body.url)) {
    throw new GitHubAttachError(
      `the upload succeeded but returned a URL this library does not recognise. ` +
        `GitHub would not render it as a player, so uploads.github.com has probably changed.`,
      "endpoint-changed",
      response.status,
      JSON.stringify(body.url).slice(0, 200),
    );
  }

  return { url: body.url, name, contentType, size: bytes.byteLength };
}

/** Posts a comment on an issue or a pull request, and returns its URL. */
export async function comment(options: CommentOptions): Promise<string> {
  const { owner, name } = splitRepo(options.repo);

  if (!Number.isInteger(options.issue) || options.issue <= 0) {
    throw new Error(`issue must be a positive integer, got ${options.issue}`);
  }

  const response = await fetch(
    `${API_ORIGIN}/repos/${owner}/${name}/issues/${options.issue}/comments`,
    {
      method: "POST",
      headers: {
        ...apiHeaders(options.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: options.body }),
      signal: options.signal ?? null,
    },
  );

  if (!response.ok) {
    const detail = stripHtml(await response.text());
    throw new GitHubAttachError(
      `could not comment on ${options.repo}#${options.issue} (HTTP ${response.status}). ${detail}`,
      response.status === 401 || response.status === 403 ? "auth" : "unknown",
      response.status,
      detail,
    );
  }

  const created = await readJson<{ html_url?: unknown }>(response, "the comments API");
  if (typeof created.html_url !== "string") {
    throw new GitHubAttachError(
      "the comment was created but GitHub returned no URL for it.",
      "endpoint-changed",
      response.status,
    );
  }
  return created.html_url;
}

/** The upload endpoint wants the numeric repository id, not the GraphQL node id. */
async function resolveRepositoryId(
  repo: string,
  token: string,
  signal: AbortSignal | undefined,
): Promise<number> {
  const { owner, name } = splitRepo(repo);

  const response = await fetch(`${API_ORIGIN}/repos/${owner}/${name}`, {
    headers: apiHeaders(token),
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new GitHubAttachError(
      `cannot read ${repo} (HTTP ${response.status}). Check that the token has access to it.`,
      response.status === 404 ? "not-found" : "auth",
      response.status,
    );
  }

  const body = await readJson<{ id?: unknown }>(response, `GET /repos/${owner}/${name}`);
  if (typeof body.id !== "number") {
    throw new GitHubAttachError(
      `GitHub returned no numeric id for ${repo}.`,
      "endpoint-changed",
      response.status,
    );
  }
  return body.id;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * A non-JSON body from an endpoint that always returned JSON is worth naming,
 * rather than letting a raw `SyntaxError` reach the caller.
 */
async function readJson<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GitHubAttachError(
      `${what} answered HTTP ${response.status} with a body that is not JSON. ` +
        `The endpoint has probably changed.`,
      "endpoint-changed",
      response.status,
      stripHtml(text),
    );
  }
}

type UploadError = { message: string; field?: string };

/** Error bodies use GitHub's REST shape, and carry HTML meant for the web editor. */
function readUploadError(raw: string): UploadError {
  try {
    const body = JSON.parse(raw) as {
      message?: string;
      errors?: { field?: string; message?: string }[];
    };
    const first = body.errors?.[0];
    const message = stripHtml(first?.message ?? body.message ?? raw);
    return first?.field !== undefined ? { message, field: first.field } : { message };
  } catch {
    return { message: stripHtml(raw) };
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

async function uploadFailure(response: Response, size: number): Promise<GitHubAttachError> {
  const { message, field } = readUploadError(await response.text());
  const status = response.status;
  const megabytes = (size / 1024 / 1024).toFixed(1);
  const fail = (text: string, kind: AttachFailureKind): GitHubAttachError =>
    new GitHubAttachError(text, kind, status, message);

  if (status === 401) {
    return fail(`the token was rejected (HTTP 401). ${message}`, "auth");
  }

  if (status === 403) {
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      const reset = response.headers.get("x-ratelimit-reset");
      const at = reset ? ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.` : "";
      return fail(`GitHub rate limited the upload (HTTP 403).${at}`, "rate-limit");
    }
    return fail(
      `upload rejected (HTTP 403). The token needs the "repo" scope and write access to this repository. ${message}`,
      "auth",
    );
  }

  if (status === 404) {
    return fail(
      `the upload endpoint answered 404. The Actions GITHUB_TOKEN always gets a 404 here, ` +
        `so use a personal access token; otherwise the repository id is wrong, or ` +
        `uploads.github.com/user-attachments/assets no longer exists. ${message}`,
      "not-found",
    );
  }

  // Oversized uploads come back as 422 with a "size" field, not as 413.
  if (status === 422 && field === "size") {
    return fail(`file too large at ${megabytes} MB. GitHub caps attachments at 100 MB.`, "too-large");
  }

  if (status === 413) {
    return fail(`file too large at ${megabytes} MB (HTTP 413). ${message}`, "too-large");
  }

  if (status === 422) {
    return fail(`GitHub refused the upload (HTTP 422). ${message}`, "unknown");
  }

  return fail(`upload failed (HTTP ${status}). ${message}`, "unknown");
}
