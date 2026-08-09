import { execFileSync } from "node:child_process";

/**
 * Explicit argument, then `GITHUB_TOKEN`, then whatever `gh` is logged in as.
 */
export function resolveToken(explicit?: string): string {
  if (explicit) return explicit;

  const fromEnvironment = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"];
  if (fromEnvironment) return fromEnvironment;

  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      'no token found. Set GITHUB_TOKEN, pass --token, or run "gh auth login".',
    );
  }
}
