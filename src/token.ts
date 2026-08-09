import { execFileSync } from "node:child_process";
import { GitHubAttachError } from "./errors.js";

const GH_TOKEN_TIMEOUT_MS = 10_000;
const GH_ENV_KEYS = ["PATH", "HOME", "GH_CONFIG_DIR", "XDG_CONFIG_HOME"] as const;

/**
 * Explicit argument, then the environment, then whatever `gh` is logged in as.
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

  const { token: fromCli, cause } = readGhToken();
  if (fromCli) return validateToken(fromCli);

  throw new GitHubAttachError(
    'no token found. Set GH_TOKEN or GITHUB_TOKEN, or run "gh auth login".',
    "auth",
    undefined,
    undefined,
    cause,
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

function readGhToken(): { token?: string; cause?: unknown } {
  try {
    const output = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      // Keep gh's own "not logged in" noise out of our stderr.
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GH_TOKEN_TIMEOUT_MS,
      env: ghEnvironment(),
    }).trim();
    return output ? { token: output } : {};
  } catch (error) {
    const timedOut =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ETIMEDOUT";
    return {
      cause: new Error(
        timedOut
          ? `gh auth token timed out after ${GH_TOKEN_TIMEOUT_MS / 1000} seconds`
          : "gh auth token failed",
      ),
    };
  }
}

/** Do not hand unrelated credentials to a PATH-resolved helper process. */
function ghEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
  };

  for (const key of GH_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }

  return environment;
}
