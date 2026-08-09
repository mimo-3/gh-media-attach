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
  ".svg": "image/svg+xml",
};

/**
 * GitHub decides how to render an attachment from the content type we declare
 * at upload time, so a wrong guess here silently produces an unplayable file.
 * Unknown extensions are rejected rather than sent as octet-stream.
 */
export function guessContentType(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  const contentType = BY_EXTENSION[extension];
  if (!contentType) {
    throw new Error(
      `cannot tell the content type of "${fileName}". Pass one explicitly with --content-type.`,
    );
  }
  return contentType;
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
export function ensureExtension(name: string, filePath: string): string {
  const hasExtension = /\.[A-Za-z0-9]+$/.test(name);
  if (hasExtension) return name;

  const source = /\.[A-Za-z0-9]+$/.exec(filePath);
  return source ? `${name}${source[0]}` : name;
}
