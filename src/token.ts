import { execFileSync } from "node:child_process";

/**
 * Explicit argument, then the environment, then whatever `gh` is logged in as.
 *
 * `GH_TOKEN` comes before `GITHUB_TOKEN` because that is the order the `gh` CLI
 * itself uses; picking the other order would make this tool disagree with `gh`
 * on machines that set both.
 */
export function resolveToken(explicit?: string): string {
  const fromArgument = explicit?.trim();
  if (fromArgument) return fromArgument;

  const fromEnvironment = (process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"])?.trim();
  if (fromEnvironment) return fromEnvironment;

  const fromCli = readGhToken();
  if (fromCli) return fromCli;

  throw new Error('no token found. Set GITHUB_TOKEN, pass --token, or run "gh auth login".');
}

function readGhToken(): string | undefined {
  try {
    const output = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      // Keep gh's own "not logged in" noise out of our stderr.
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
