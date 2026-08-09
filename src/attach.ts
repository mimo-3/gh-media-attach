import { open } from "node:fs/promises";
import { basename } from "node:path";
import { ensureExtension, guessContentType, validateContentType } from "./mime.js";
import { splitRepo } from "./repo.js";
import {
  GitHubAttachError,
  isAbortFailure,
  sanitizeTerminalText,
  wrapFailure,
} from "./errors.js";
import type { AttachFailureKind } from "./errors.js";

const UPLOAD_ORIGIN = "https://uploads.github.com";
const API_ORIGIN = "https://api.github.com";
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const FILE_READ_CHUNK_BYTES = 1024 * 1024;

/** The only URL shape GitHub currently renders as an inline attachment. */
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
 * Every failure crossing this public boundary is a {@link GitHubAttachError}.
 */
export async function attach(filePath: string, options: AttachOptions): Promise<Asset> {
  try {
    return await attachFile(filePath, options);
  } catch (error) {
    if (isAbortFailure(error) || options?.signal?.aborted) {
      throw wrapFailure(error, "attachment upload was aborted", "aborted");
    }
    throw wrapFailure(error, "could not attach the file", "unknown");
  }
}

async function attachFile(filePath: string, options: AttachOptions): Promise<Asset> {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new GitHubAttachError("file path must not be empty", "invalid-input");
  }
  if (!isRecord(options)) {
    throw new GitHubAttachError("attach options are required", "invalid-input");
  }
  if (typeof options.repo !== "string") {
    throw new GitHubAttachError("repo must be an owner/name string", "invalid-input");
  }

  splitRepo(options.repo);
  const token = requireToken(options.token);
  const { bytes, contentType, name } = await prepareAttachmentFile(filePath, options);

  // Always resolve from owner/name so the id cannot disagree with the public target.
  const repositoryId = await resolveRepositoryId(options.repo, token, options.signal);

  const query = new URLSearchParams({
    name,
    content_type: contentType,
    repository_id: String(repositoryId),
  });
  const response = await githubFetch(
    `${UPLOAD_ORIGIN}/user-attachments/assets?${query}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": contentType,
      },
      body: bytes,
      signal: options.signal ?? null,
    },
    options.signal,
    "upload the attachment",
  );

  if (!response.ok) {
    throw await responseFailure(response, "upload", bytes.byteLength, options.signal);
  }

  const body = await readJson(response, "the upload endpoint", options.signal);
  if (!isRecord(body) || typeof body.url !== "string" || !isGitHubAssetUrl(body.url)) {
    throw new GitHubAttachError(
      `the upload succeeded but returned a URL this library does not recognise. ` +
        `GitHub would not render it as a player, so uploads.github.com has probably changed.`,
      "endpoint-changed",
      response.status,
      safeDetail(body),
    );
  }

  return { url: body.url, name, contentType, size: bytes.byteLength };
}

/** Posts a comment on an issue or a pull request, and returns its URL. */
export async function comment(options: CommentOptions): Promise<string> {
  try {
    return await postComment(options);
  } catch (error) {
    if (isAbortFailure(error) || options?.signal?.aborted) {
      throw wrapFailure(error, "comment creation was aborted", "aborted");
    }
    throw wrapFailure(error, "could not create the comment", "unknown");
  }
}

async function postComment(options: CommentOptions): Promise<string> {
  if (!isRecord(options)) {
    throw new GitHubAttachError("comment options are required", "invalid-input");
  }
  if (typeof options.repo !== "string") {
    throw new GitHubAttachError("repo must be an owner/name string", "invalid-input");
  }
  const { owner, name } = splitRepo(options.repo);
  const token = requireToken(options.token);

  if (!Number.isSafeInteger(options.issue) || options.issue <= 0) {
    throw new GitHubAttachError(
      `issue must be a positive safe integer, got ${String(options.issue)}`,
      "invalid-input",
    );
  }
  if (typeof options.body !== "string") {
    throw new GitHubAttachError("comment body must be a string", "invalid-input");
  }

  const response = await githubFetch(
    `${API_ORIGIN}/repos/${owner}/${name}/issues/${options.issue}/comments`,
    {
      method: "POST",
      headers: {
        ...apiHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: options.body }),
      signal: options.signal ?? null,
    },
    options.signal,
    "create the comment",
  );

  if (!response.ok) {
    throw await responseFailure(response, "comment", undefined, options.signal);
  }

  const created = await readJson(response, "the comments API", options.signal);
  if (
    !isRecord(created) ||
    typeof created.html_url !== "string" ||
    !isSafeGitHubWebUrl(created.html_url)
  ) {
    throw new GitHubAttachError(
      "the comment was created but GitHub returned no URL for it.",
      "endpoint-changed",
      response.status,
      safeDetail(created),
    );
  }
  return created.html_url;
}

/** Used by the renderer as a second trust boundary for caller-built Assets. */
export function isGitHubAssetUrl(url: string): boolean {
  return ASSET_URL.test(url);
}

/** The upload endpoint wants the numeric repository id, not the GraphQL node id. */
async function resolveRepositoryId(
  repo: string,
  token: string,
  signal: AbortSignal | undefined,
): Promise<number> {
  const { owner, name } = splitRepo(repo);
  const response = await githubFetch(
    `${API_ORIGIN}/repos/${owner}/${name}`,
    { headers: apiHeaders(token), signal: signal ?? null },
    signal,
    `read ${repo}`,
  );

  if (!response.ok) {
    throw await responseFailure(response, "repository", undefined, signal);
  }

  const body = await readJson(response, `GET /repos/${owner}/${name}`, signal);
  if (!isRecord(body) || !Number.isSafeInteger(body.id) || (body.id as number) <= 0) {
    throw new GitHubAttachError(
      `GitHub returned no positive numeric id for ${repo}.`,
      "endpoint-changed",
      response.status,
      safeDetail(body),
    );
  }
  return body.id as number;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubFetch(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  action: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isAbortFailure(error) || signal?.aborted) {
      throw wrapFailure(error, `${action} was aborted`, "aborted");
    }
    throw wrapFailure(error, `could not ${action} because the network request failed`, "network");
  }
}

async function readJson(
  response: Response,
  what: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const text = await readResponseText(response, signal);
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new GitHubAttachError(
      `${what} answered HTTP ${response.status} with a body that is not JSON. ` +
        `The endpoint has probably changed.`,
      "endpoint-changed",
      response.status,
      stripHtml(text),
      cause,
    );
  }
}

type Operation = "repository" | "upload" | "comment";
type UploadError = { message: string; field?: string };

async function responseFailure(
  response: Response,
  operation: Operation,
  size: number | undefined,
  signal: AbortSignal | undefined,
): Promise<GitHubAttachError> {
  const raw = await readResponseText(response, signal);
  const uploadError = readUploadError(raw);
  const detail = operation === "upload" ? uploadError.message : readApiError(raw);
  const status = response.status;
  const kind = classifyResponse(response, operation, uploadError.field, detail);
  const label = operation === "repository" ? "repository lookup" : operation;
  const fail = (message: string): GitHubAttachError =>
    new GitHubAttachError(message, kind, status, detail);

  if (kind === "rate-limit") {
    return fail(`GitHub rate limited the ${label} (HTTP ${status}).${rateLimitReset(response)}`);
  }
  if (kind === "auth") {
    return fail(`GitHub rejected the token or its permissions for the ${label} (HTTP ${status}). ${detail}`);
  }
  if (kind === "upload-unavailable") {
    return fail(
      `the private upload endpoint is unavailable (HTTP 404). The automatic Actions ` +
        `GITHUB_TOKEN is unsupported here; otherwise GitHub may have changed the endpoint. ${detail}`,
    );
  }
  if (kind === "not-found") {
    return fail(`the target for the ${label} was not found (HTTP 404). ${detail}`);
  }
  if (kind === "too-large") {
    const measured = size === undefined ? "" : ` at ${formatMegabytes(size)} MB`;
    return fail(`file too large${measured}. GitHub caps attachments at 100 MB (HTTP ${status}).`);
  }
  if (kind === "invalid-input") {
    return fail(`GitHub refused the ${label} as invalid (HTTP 422). ${detail}`);
  }
  if (kind === "server") {
    return fail(`GitHub could not complete the ${label} (HTTP ${status}). ${detail}`);
  }
  return fail(`${label} failed (HTTP ${status}). ${detail}`);
}

function classifyResponse(
  response: Response,
  operation: Operation,
  uploadField: string | undefined,
  detail: string,
): AttachFailureKind {
  const status = response.status;
  if (
    status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0" ||
    (status === 403 && /(?:rate limit|abuse detection)/i.test(detail))
  ) {
    return "rate-limit";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return operation === "upload" ? "upload-unavailable" : "not-found";
  if (status === 413 || (status === 422 && uploadField === "size")) return "too-large";
  if (status === 422) return "invalid-input";
  if (status >= 500 && status <= 599) return "server";
  return "unknown";
}

/** Error bodies use GitHub's REST shape and may contain HTML for the web editor. */
function readUploadError(raw: string): UploadError {
  try {
    const body = JSON.parse(raw) as unknown;
    if (!isRecord(body)) return { message: stripHtml(raw) };
    const errors = Array.isArray(body.errors) ? body.errors : [];
    const first = errors[0];
    const field = isRecord(first) && typeof first.field === "string" ? first.field : undefined;
    const firstMessage = isRecord(first) && typeof first.message === "string" ? first.message : undefined;
    const bodyMessage = typeof body.message === "string" ? body.message : undefined;
    const message = stripHtml(firstMessage ?? bodyMessage ?? raw);
    return field === undefined ? { message } : { message, field };
  } catch {
    return { message: stripHtml(raw) };
  }
}

function readApiError(raw: string): string {
  try {
    const body = JSON.parse(raw) as unknown;
    if (isRecord(body) && typeof body.message === "string") return stripHtml(body.message);
  } catch {
    // Plain text and HTML error bodies are still useful once neutralised.
  }
  return stripHtml(raw);
}

async function readResponseText(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    const detail = sanitizeTerminalText(
      error instanceof Error ? error.message : safeDetail(error),
    ).slice(0, 300);
    if (isAbortFailure(error) || signal?.aborted) {
      throw new GitHubAttachError(
        "reading the GitHub response was aborted",
        "aborted",
        response.status,
        detail,
        error,
      );
    }
    throw new GitHubAttachError(
      "could not read the GitHub response",
      "network",
      response.status,
      detail,
      error,
    );
  }
}

async function prepareAttachmentFile(
  filePath: string,
  options: AttachOptions,
): Promise<{ bytes: Buffer; contentType: string; name: string }> {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    throw wrapFailure(
      error,
      `could not open file "${sanitizeTerminalText(filePath)}"`,
      "file",
    );
  }

  try {
    const fileInfo = await handle.stat();
    if (!fileInfo.isFile()) {
      throw new GitHubAttachError(
        `"${sanitizeTerminalText(filePath)}" is not a regular file`,
        "file",
      );
    }
    rejectOversized(fileInfo.size);

    const contentType = validateContentType(
      options.contentType === undefined
        ? guessContentType(filePath)
        : requireString(options.contentType, "content type"),
    );
    const displayName =
      options.name === undefined ? basename(filePath) : requireString(options.name, "name");
    const name = ensureExtension(displayName, filePath, contentType);

    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(
        Math.min(FILE_READ_CHUNK_BYTES, MAX_ATTACHMENT_BYTES + 1 - size),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;

      size += bytesRead;
      rejectOversized(size);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { bytes: Buffer.concat(chunks, size), contentType, name };
  } catch (error) {
    if (error instanceof GitHubAttachError) throw error;
    throw wrapFailure(error, `could not read file "${sanitizeTerminalText(filePath)}"`, "file");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function rejectOversized(size: number): void {
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new GitHubAttachError(
      `file too large at ${formatMegabytes(size)} MB. GitHub caps attachments at 100 MB.`,
      "too-large",
    );
  }
}

function requireToken(token: unknown): string {
  if (typeof token !== "string" || token.trim() === "") {
    throw new GitHubAttachError("token must not be empty", "invalid-input");
  }
  const trimmed = token.trim();
  if (/\s/.test(trimmed)) {
    throw new GitHubAttachError("token must not contain whitespace", "invalid-input");
  }
  return trimmed;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new GitHubAttachError(`${label} must be a string`, "invalid-input");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDetail(value: unknown): string {
  try {
    const serialised = JSON.stringify(value);
    return sanitizeTerminalText(serialised ?? String(value)).slice(0, 300);
  } catch {
    return "unserialisable response";
  }
}

function stripHtml(text: string): string {
  return sanitizeTerminalText(text.replace(/<[^>]*>/g, " ")).slice(0, 300);
}

function isSafeGitHubWebUrl(value: string): boolean {
  if (sanitizeTerminalText(value) !== value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function rateLimitReset(response: Response): string {
  const raw = response.headers.get("x-ratelimit-reset");
  if (raw === null) return "";
  const milliseconds = Number(raw) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) return "";
  return ` Resets at ${new Date(milliseconds).toISOString()}.`;
}

function formatMegabytes(size: number): string {
  return (size / 1024 / 1024).toFixed(1);
}
