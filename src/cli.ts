#!/usr/bin/env node
import { attach, comment } from "./attach.js";
import { parseArguments, USAGE } from "./cli-args.js";
import { toMarkdown } from "./render.js";
import { resolveToken } from "./token.js";

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

  const token = resolveToken(flags.token);
  const asset = await attach(flags.file, {
    repo: flags.repo,
    token,
    ...(flags.name !== undefined ? { name: flags.name } : {}),
    ...(flags.contentType !== undefined ? { contentType: flags.contentType } : {}),
  });

  const markdown = toMarkdown(asset);

  if (flags.issue !== undefined) {
    try {
      const commentUrl = await comment({
        repo: flags.repo,
        issue: flags.issue,
        body: markdown,
        token,
      });
      process.stdout.write(`${commentUrl}\n`);
    } catch (error) {
      // The file is already on GitHub. Hand back the markdown so a failed
      // comment does not cost the caller another upload.
      process.stdout.write(`${markdown}\n`);
      throw error;
    }
    return;
  }

  process.stdout.write(`${flags.urlOnly ? asset.url : markdown}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
