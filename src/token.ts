import { GitHubAttachError } from "./errors.js";

/**
 * Explicit argument, then the environment.
 *
 * `GH_TOKEN` comes before `GITHUB_TOKEN` because that is the order the `gh` CLI
 * itself uses; picking the other order would make this tool disagree with `gh`
 * on machines that set both.
 */
export function resolveToken(explicit?: string): string {
  if (explicit !== undefined) {
    if (typeof explicit !== "string") {
      throw new GitHubAttachError("token must be a string", "invalid-input");
    }
    return validateToken(explicit);
  }

  const fromGhEnvironment = process.env["GH_TOKEN"]?.trim();
  if (fromGhEnvironment) return validateToken(fromGhEnvironment);
  const fromGitHubEnvironment = process.env["GITHUB_TOKEN"]?.trim();
  if (fromGitHubEnvironment) return validateToken(fromGitHubEnvironment);

  throw new GitHubAttachError(
    "no token found. Set GH_TOKEN or GITHUB_TOKEN.",
    "auth",
  );
}

function validateToken(value: string): string {
  const token = value.trim();
  if (!token) throw new GitHubAttachError("token must not be empty", "invalid-input");
  if (/\s/.test(token)) {
    throw new GitHubAttachError("token must not contain whitespace", "invalid-input");
  }
  return token;
}
