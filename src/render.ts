import { isVideo } from "./mime.js";
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
  if (isVideo(asset.contentType)) {
    return `<video src="${escapeAttribute(asset.url)}" controls></video>`;
  }
  return `![${escapeAltText(asset.name)}](${asset.url})`;
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
  return name
    .replace(/[\\[\]]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
}
