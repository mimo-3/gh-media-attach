#!/usr/bin/env node
import { attach, appendToBody, comment } from "./attach.js";
import { parseArguments, USAGE } from "./cli-args.js";
import { toMarkdown } from "./render.js";
import { resolveToken } from "./token.js";
import { sanitizeTerminalText } from "./errors.js";

const NETWORK_TIMEOUT_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  const flags = parseArguments(process.argv.slice(2));

  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (flags.file === undefined || flags.repo === undefined) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const token = resolveToken();
  const signal = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  const asset = await attach(flags.file, {
    repo: flags.repo,
    token,
    signal,
    ...(flags.name !== undefined ? { name: flags.name } : {}),
    ...(flags.contentType !== undefined ? { contentType: flags.contentType } : {}),
  });

  const markdown = toMarkdown(asset);

  if (flags.issue !== undefined) {
    const target = { repo: flags.repo, issue: flags.issue, body: markdown, token, signal };
    try {
      // Appending answers with the issue or pull request URL, commenting with
      // the comment anchor, so the printed URL already names what was written.
      const writtenUrl = flags.appendBody
        ? await appendToBody({
            ...target,
            // Refuse to rewrite an issue body when --pr was asked for, and
            // the other way round.
            ...(flags.targetIsPullRequest !== undefined
              ? { expectPullRequest: flags.targetIsPullRequest }
              : {}),
          })
        : await comment(target);
      process.stdout.write(`${writtenUrl}\n`);
    } catch (error) {
      // The file is already on GitHub. Hand back the markdown so a failed
      // write does not cost the caller another upload.
      process.stdout.write(`${markdown}\n`);
      throw error;
    }
    return;
  }

  process.stdout.write(`${flags.urlOnly ? asset.url : markdown}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${sanitizeTerminalText(message)}\n`);
  process.exitCode = 1;
});
