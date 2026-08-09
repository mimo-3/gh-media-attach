import { GitHubAttachError, sanitizeTerminalText } from "./errors.js";

const BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const SUPPORTED_CONTENT_TYPES = new Set(Object.values(BY_EXTENSION));

/**
 * GitHub decides how to render an attachment from the content type we declare
 * at upload time, so a wrong guess here silently produces an unplayable file.
 * Unknown extensions are rejected rather than sent as octet-stream.
 */
export function guessContentType(fileName: string): string {
  if (typeof fileName !== "string") {
    throw new GitHubAttachError("file name must be a string", "invalid-input");
  }
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  const contentType = BY_EXTENSION[extension];
  if (!contentType) {
    throw new GitHubAttachError(
      `cannot tell the content type of "${sanitizeTerminalText(fileName)}". ` +
        `Pass one explicitly with --content-type.`,
      "invalid-input",
    );
  }
  return contentType;
}

/** Reject types that GitHub will not render as one of this package's supported assets. */
export function validateContentType(contentType: string): string {
  if (typeof contentType !== "string") {
    throw new GitHubAttachError("content type must be a string", "invalid-input");
  }
  const normalised = contentType.trim().toLowerCase();
  if (!SUPPORTED_CONTENT_TYPES.has(normalised)) {
    throw new GitHubAttachError(
      `unsupported content type "${sanitizeTerminalText(contentType)}". ` +
        `Use a supported image or video type.`,
      "invalid-input",
    );
  }
  return normalised;
}

export function isVideo(contentType: string): boolean {
  return contentType.startsWith("video/");
}

/**
 * GitHub checks the declared content type against the extension of the display
 * name and rejects a mismatch, so a display name of "screenshot" fails where
 * "screenshot.png" works. Callers who rename a file are asking for a nicer
 * label, not for a different format.
 */
export function ensureExtension(name: string, filePath: string, contentType: string): string {
  if (name.trim() === "") {
    throw new GitHubAttachError("attachment name must not be empty", "invalid-input");
  }

  const hasExtension = /\.[A-Za-z0-9]+$/.test(name);
  const source = /\.[A-Za-z0-9]+$/.exec(filePath);
  const result = hasExtension ? name : source ? `${name}${source[0]}` : name;
  const nameContentType = guessContentType(result);

  if (nameContentType !== contentType) {
    throw new GitHubAttachError(
      `attachment name "${sanitizeTerminalText(result)}" does not match content type "${sanitizeTerminalText(contentType)}"`,
      "invalid-input",
    );
  }
  return result;
}
