/**
 * GitHub owners and repository names only ever use these characters, so
 * anything else is a mistake worth catching before it reaches a URL.
 * `encodeURIComponent` would not help here: it leaves `.` alone, so a segment
 * of `..` would still climb a path.
 */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function splitRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  const owner = parts[0];
  const name = parts[1];

  if (parts.length !== 2 || !isSegment(owner) || !isSegment(name)) {
    throw new Error(`repo must look like "owner/name", got "${repo}"`);
  }

  return { owner, name };
}

function isSegment(segment: string | undefined): segment is string {
  return (
    segment !== undefined && segment !== "." && segment !== ".." && SEGMENT.test(segment)
  );
}
