import { isVideo } from "./mime.js";
import type { Asset } from "./attach.js";

/**
 * Markdown that GitHub will render as a player for videos and an image for
 * everything else.
 *
 * Videos must go in a `<video>` tag: `![alt](url)` on an .mp4 produces an
 * `<img>` that never plays. GitHub only keeps the tag when the URL is one of
 * its own `user-attachments` assets — a release asset or an external CDN gets
 * the whole tag stripped by the sanitizer.
 */
export function toMarkdown(asset: Asset): string {
  if (isVideo(asset.contentType)) {
    return `<video src="${asset.url}" controls></video>`;
  }
  return `![${escapeAltText(asset.name)}](${asset.url})`;
}

function escapeAltText(name: string): string {
  return name.replace(/[[\]]/g, "\\$&");
}
