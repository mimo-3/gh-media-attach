#!/usr/bin/env node
import { attach, comment } from "./attach.js";
import { toMarkdown } from "./render.js";
import { resolveToken } from "./token.js";

const USAGE = `gh-video-attach <file> --repo owner/name [options]

  --repo owner/name    Repository the attachment belongs to (required)
  --issue N            Post the attachment as a comment on issue N
  --pr N               Post the attachment as a comment on pull request N
  --content-type TYPE  Override the type guessed from the extension
  --name NAME          Override the file name shown on GitHub
  --token TOKEN        Defaults to GITHUB_TOKEN, then \`gh auth token\`
  --url                Print only the asset URL, not the markdown
`;

type Flags = {
  file?: string;
  repo?: string;
  issue?: number;
  contentType?: string;
  name?: string;
  token?: string;
  urlOnly: boolean;
};

function parseArguments(argv: string[]): Flags {
  const flags: Flags = { urlOnly: false };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = (): string => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      return value;
    };

    switch (argument) {
      case "--repo":
        flags.repo = next();
        break;
      case "--issue":
      case "--pr":
        flags.issue = Number(next());
        break;
      case "--content-type":
        flags.contentType = next();
        break;
      case "--name":
        flags.name = next();
        break;
      case "--token":
        flags.token = next();
        break;
      case "--url":
        flags.urlOnly = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        if (argument !== undefined && argument.startsWith("-")) {
          throw new Error(`unknown option ${argument}`);
        }
        if (flags.file) throw new Error("only one file at a time for now");
        flags.file = argument;
    }
  }

  return flags;
}

async function main(): Promise<void> {
  const flags = parseArguments(process.argv.slice(2));

  if (!flags.file || !flags.repo) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  if (flags.issue !== undefined && !Number.isInteger(flags.issue)) {
    throw new Error("--issue / --pr needs a number");
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
    const commentUrl = await comment(flags.repo, flags.issue, markdown, token);
    process.stdout.write(`${commentUrl}\n`);
    return;
  }

  process.stdout.write(`${flags.urlOnly ? asset.url : markdown}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
