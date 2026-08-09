export type Flags = {
  file: string | undefined;
  repo: string | undefined;
  issue: number | undefined;
  contentType: string | undefined;
  name: string | undefined;
  token: string | undefined;
  urlOnly: boolean;
  help: boolean;
};

export const USAGE = `gh-video-attach <file> --repo owner/name [options]

  --repo owner/name    Repository the attachment belongs to (required)
  --issue N            Post the attachment as a comment on issue N
  --pr N               Post the attachment as a comment on pull request N
  --content-type TYPE  Override the type guessed from the extension
  --name NAME          Override the file name shown on GitHub
  --token TOKEN        Defaults to GH_TOKEN, GITHUB_TOKEN, then \`gh auth token\`
  --url                Print only the asset URL, not the markdown

Prefer GITHUB_TOKEN over --token: arguments are visible to other users in \`ps\`.
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
    token: undefined,
    urlOnly: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) continue;

    const value = (): string => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      return next;
    };

    switch (argument) {
      case "--repo":
        flags.repo = value();
        break;
      case "--issue":
      case "--pr": {
        if (flags.issue !== undefined) {
          throw new Error("give --issue or --pr once, not both");
        }
        const raw = value();
        if (!/^[1-9]\d*$/.test(raw)) {
          throw new Error(`${argument} needs a positive integer, got "${raw}"`);
        }
        flags.issue = Number(raw);
        break;
      }
      case "--content-type":
        flags.contentType = value();
        break;
      case "--name":
        flags.name = value();
        break;
      case "--token":
        flags.token = value();
        break;
      case "--url":
        flags.urlOnly = true;
        break;
      case "-h":
      case "--help":
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

  return flags;
}
