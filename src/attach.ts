import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { guessContentType } from "./mime.js";

const UPLOAD_ORIGIN = "https://uploads.github.com";
const API_ORIGIN = "https://api.github.com";

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
  /** Overrides the file name shown in GitHub's UI. */
  name?: string;
  /** Overrides the content type guessed from the extension. */
  contentType?: string;
};

/**
 * The upload endpoint wants the numeric repository id, not the GraphQL node id.
 */
export async function resolveRepositoryId(repo: string, token: string): Promise<number> {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) {
    throw new Error(`repo must look like "owner/name", got "${repo}"`);
  }

  const response = await fetch(`${API_ORIGIN}/repos/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(
      `cannot read ${repo} (HTTP ${response.status}). ` +
        `Check that the token has access to it.`,
    );
  }

  const body = (await response.json()) as { id?: number };
  if (typeof body.id !== "number") {
    throw new Error(`GitHub returned no numeric id for ${repo}`);
  }
  return body.id;
}

/**
 * Uploads a file and returns the attachment URL GitHub renders inline.
 *
 * This calls `uploads.github.com`, which GitHub does not document or support.
 * It works with a plain PAT today; treat a sudden 4xx as the endpoint changing
 * rather than as a bug in the caller.
 */
export async function attach(filePath: string, options: AttachOptions): Promise<Asset> {
  const bytes = await readFile(filePath);
  const name = options.name ?? basename(filePath);
  const contentType = options.contentType ?? guessContentType(name);
  const repositoryId = await resolveRepositoryId(options.repo, options.token);

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
  });

  if (!response.ok) {
    throw new Error(await describeUploadFailure(response, bytes.byteLength));
  }

  const body = (await response.json()) as { url?: string };
  if (!body.url) {
    throw new Error("upload succeeded but GitHub returned no URL");
  }

  return { url: body.url, name, contentType, size: bytes.byteLength };
}

type UploadError = { message: string; field?: string };

/**
 * Error bodies come back as GitHub's REST shape, and the messages inside can
 * carry HTML meant for the web editor.
 */
function readUploadError(raw: string): UploadError {
  try {
    const body = JSON.parse(raw) as {
      message?: string;
      errors?: { field?: string; message?: string }[];
    };
    const first = body.errors?.[0];
    const message = first?.message ?? body.message ?? raw;
    return first?.field !== undefined
      ? { message: stripHtml(message), field: first.field }
      : { message: stripHtml(message) };
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

async function describeUploadFailure(response: Response, size: number): Promise<string> {
  const { message, field } = readUploadError(await response.text());
  const megabytes = (size / 1024 / 1024).toFixed(1);

  if (response.status === 401 || response.status === 403) {
    return `upload rejected (HTTP ${response.status}). The token needs the "repo" scope and write access to this repository. ${message}`;
  }

  // Oversized uploads come back as 422 with a "size" field, not as 413.
  if (response.status === 422 && field === "size") {
    return `file too large at ${megabytes} MB. GitHub caps attachments at 100 MB. ${message}`;
  }

  if (response.status === 422) {
    return `GitHub refused the upload (HTTP 422). ${message}`;
  }

  return `upload failed (HTTP ${response.status}). ${message}`;
}

/** Posts a comment on an issue or a pull request. */
export async function comment(
  repo: string,
  issueNumber: number,
  body: string,
  token: string,
): Promise<string> {
  const response = await fetch(`${API_ORIGIN}/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    throw new Error(
      `could not comment on ${repo}#${issueNumber} (HTTP ${response.status}). ` +
        (await response.text()).slice(0, 300),
    );
  }

  const created = (await response.json()) as { html_url?: string };
  return created.html_url ?? `https://github.com/${repo}/issues/${issueNumber}`;
}
