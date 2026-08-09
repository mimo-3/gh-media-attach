import { GitHubAttachError, sanitizeTerminalText, wrapFailure } from "./errors.js";
import { isVideo, validateContentType } from "./mime.js";
import { isGitHubAssetUrl } from "./attach.js";
import type { Asset } from "./attach.js";

/**
 * Markdown that GitHub renders as a player for videos and an image for
 * everything else.
 *
 * Videos must go in a `<video>` tag: `![alt](url)` on an .mp4 produces an
 * `<img>` that never plays. GitHub only keeps the tag when the URL is one of
 * its own `user-attachments` assets — a release asset or an external CDN gets
 * the whole tag stripped by the sanitizer.
 */
export function toMarkdown(asset: Asset): string {
  try {
    if (typeof asset !== "object" || asset === null || Array.isArray(asset)) {
      throw new GitHubAttachError("asset must be an object", "invalid-input");
    }
    if (typeof asset.url !== "string" || !isGitHubAssetUrl(asset.url)) {
      throw new GitHubAttachError(
        "asset URL must be a GitHub user-attachments URL",
        "invalid-input",
      );
    }
    if (typeof asset.name !== "string") {
      throw new GitHubAttachError("asset name must be a string", "invalid-input");
    }
    if (typeof asset.contentType !== "string") {
      throw new GitHubAttachError("asset content type must be a string", "invalid-input");
    }

    const contentType = validateContentType(asset.contentType);
    if (isVideo(contentType)) {
      return `<video src="${escapeAttribute(asset.url)}" controls></video>`;
    }
    return `![${escapeAltText(asset.name)}](${asset.url})`;
  } catch (error) {
    throw wrapFailure(error, "could not render the attachment", "invalid-input");
  }
}

/**
 * `attach` only ever returns a validated asset URL, but `Asset` is a plain type
 * that callers can build by hand, so the tag closes what it opens either way.
 */
function escapeAttribute(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * A trailing backslash would escape the closing bracket and swallow the rest of
 * the document, so the backslash is escaped first — hence one pass over a
 * character class that includes it.
 */
function escapeAltText(name: string): string {
  return sanitizeTerminalText(name)
    .replace(/[\\[\]]/g, "\\$&")
    .trim();
}
