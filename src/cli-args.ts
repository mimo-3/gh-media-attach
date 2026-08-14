export type Flags = {
  file: string | undefined;
  repo: string | undefined;
  issue: number | undefined;
  contentType: string | undefined;
  name: string | undefined;
  appendBody: boolean;
  urlOnly: boolean;
  help: boolean;
};

export const USAGE = `gh-video-attach <file> --repo owner/name [options]

  --repo owner/name    Repository the attachment belongs to (required)
  --issue N            Post the attachment as a comment on issue N
  --pr N               Post the attachment as a comment on pull request N
  --append-body        Append to the issue or pull request body instead of commenting
  --content-type TYPE  Override the type guessed from the extension
  --name NAME          Override the file name shown on GitHub
  --url                Print only the asset URL, not the markdown

Tokens come from GH_TOKEN or GITHUB_TOKEN.
`;

/**
 * Parsing lives apart from the entry point so it can be tested without the
 * module running `main()` on import.
 */
export function parseArguments(argv: string[]): Flags {
  const flags: Flags = {
    file: undefined,
    repo: undefined,
    issue: undefined,
    contentType: undefined,
    name: undefined,
    appendBody: false,
    urlOnly: false,
    help: false,
  };
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) continue;

    const value = (allowNegativeNumber = false): string => {
      const next = argv[++index];
      const isNegativeNumber = allowNegativeNumber && next !== undefined && /^-\d/.test(next);
      if (next === undefined || (next.startsWith("-") && !isNegativeNumber)) {
        throw new Error(`${argument} needs a value`);
      }
      return next;
    };

    const once = (key: string): void => {
      if (seen.has(key)) throw new Error(`${argument} may only be given once`);
      seen.add(key);
    };

    switch (argument) {
      case "--repo":
        once("repo");
        flags.repo = value();
        break;
      case "--issue":
      case "--pr": {
        if (flags.issue !== undefined) {
          throw new Error("give --issue or --pr once, not both");
        }
        const raw = value(true);
        if (!/^[1-9]\d*$/.test(raw)) {
          throw new Error(`${argument} needs a positive integer, got "${raw}"`);
        }
        const issue = Number(raw);
        if (!Number.isSafeInteger(issue)) {
          throw new Error(`${argument} needs a safe integer, got "${raw}"`);
        }
        flags.issue = issue;
        break;
      }
      case "--content-type":
        once("content-type");
        flags.contentType = value();
        break;
      case "--name":
        once("name");
        flags.name = value();
        break;
      case "--append-body":
        once("append-body");
        flags.appendBody = true;
        break;
      case "--url":
        once("url");
        flags.urlOnly = true;
        break;
      case "-h":
      case "--help":
        once("help");
        flags.help = true;
        break;
      default:
        if (argument.startsWith("-")) {
          throw new Error(`unknown option ${argument}`);
        }
        if (flags.file !== undefined) {
          throw new Error("only one file at a time for now");
        }
        flags.file = argument;
    }
  }

  if (flags.urlOnly && flags.issue !== undefined) {
    throw new Error("--url and --issue/--pr do different things; pick one");
  }
  if (flags.appendBody && flags.urlOnly) {
    throw new Error("--append-body and --url do different things; pick one");
  }
  if (flags.appendBody && flags.issue === undefined) {
    throw new Error("--append-body needs --issue or --pr");
  }

  return flags;
}
