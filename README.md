# gh-video-attach

Upload a video or image as a GitHub user attachment and get ready-to-paste
Markdown. It works from a CLI or an ESM library without a browser, cookie, or
GitHub web session.

> **Experimental:** this package uses an undocumented GitHub upload endpoint.
> GitHub can change or remove it without notice. Treat `0.x` releases as an
> unstable compatibility line and handle `GitHubAttachError` in automation.

## Install

Node.js 20 or later is required.

```bash
npm install --global gh-video-attach
```

For library use:

```bash
npm install gh-video-attach
```

Update or remove the global CLI with `npm update --global gh-video-attach` or
`npm uninstall --global gh-video-attach`.

## CLI

Set `GH_TOKEN` or `GITHUB_TOKEN` in the environment. To use an existing GitHub
CLI login without letting this package execute a helper from `PATH`, pass the
token explicitly through the environment:

```bash
GH_TOKEN="$(gh auth token)" gh-video-attach ./demo.mp4 --repo owner/name
```

```bash
# Print ready-to-paste Markdown.
gh-video-attach ./demo.mp4 --repo owner/name

# Post the attachment as a pull request or issue comment.
gh-video-attach ./demo.mp4 --repo owner/name --pr 42
gh-video-attach ./screenshot.png --repo owner/name --issue 42

# Append the attachment to the pull request or issue body itself.
gh-video-attach ./demo.mp4 --repo owner/name --pr 42 --append-body

# Print only the uploaded asset URL.
gh-video-attach ./demo.mp4 --repo owner/name --url
```

`--append-body` reads the current body and writes it back with the Markdown
added at the end. An edit someone else makes between that read and the write is
overwritten, so prefer a comment on a body several people are editing. The
write is checked afterwards: if the stored body no longer ends with the
appended Markdown, the CLI reports a `conflict` instead of a success.

A body is capped at 65,536 characters, which repeated appends can reach. GitHub
answers with HTTP 422 at that point and the reason is included in the error.

Run `gh-video-attach --help` for all options. If an upload succeeds but the
comment or body update fails, the CLI prints the Markdown to stdout before
exiting with an error, so the uploaded asset is not lost.

The CLI resolves authentication in this order and never runs another program:

1. `GH_TOKEN`
2. `GITHUB_TOKEN`

There is intentionally no `--token` option. Command-line arguments can be read
by other processes on the same machine.

## Library

```ts
import {
  attach,
  comment,
  resolveToken,
  toMarkdown,
} from "gh-video-attach";

const token = resolveToken();
const asset = await attach("./demo.mp4", {
  repo: "owner/name",
  token,
});

const markdown = toMarkdown(asset);

await comment({
  repo: "owner/name",
  issue: 42,
  body: markdown,
  token,
});
```

`appendToBody` writes to the body of the issue or pull request instead of
adding a comment, and returns its URL:

```ts
import { appendToBody } from "gh-video-attach";

await appendToBody({
  repo: "owner/name",
  issue: 42,
  body: markdown,
  token,
  expectPullRequest: true,
});
```

It reads the body and writes the combined text back, so an edit made by someone
else in between is lost. Existing text is separated from the addition by a
blank line, and an empty body is replaced by the addition alone. If the stored
body does not end with the addition afterwards, it throws `kind: "conflict"`
rather than reporting success.

Issue 42 and pull request 42 address the same REST endpoint, so a number naming
the wrong kind of object would rewrite an unrelated body. Pass
`expectPullRequest` to refuse that: the call stops with `kind: "invalid-input"`
before writing when the target is not what the caller expected. The CLI sets it
from whichever of `--pr` or `--issue` was given.

Pass an `AbortSignal` to `attach`, `comment`, or `appendToBody` when the caller
needs its own timeout or cancellation policy. `toMarkdown` renders supported
videos as a `<video controls>` element and supported images as image Markdown.

Supported file extensions:

- Video: `.mp4`, `.mov`, `.webm`, `.m4v`
- Image: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`

Files must be regular files no larger than 100 MiB. An explicit content type
must still be one of the supported image or video types.

## Error contract

All failures from the public API throw `GitHubAttachError`. Branch on `kind`,
not message text:

```ts
import { attach, GitHubAttachError } from "gh-video-attach";

try {
  await attach("./demo.mp4", { repo: "owner/name", token });
} catch (error) {
  if (
    error instanceof GitHubAttachError &&
    error.kind === "upload-unavailable"
  ) {
    // The undocumented upload path rejected or no longer exposes this route.
  }
}
```

Kinds cover invalid input, local file failures, authentication, rate limits,
size limits, unavailable or changed upload behavior, networking, cancellation,
GitHub server failures, missing REST resources, concurrent edits, and unknown
responses. The error also preserves HTTP `status`, a sanitised `detail`, and
the original `cause` where available.

## GitHub Actions authentication

The automatic Actions `GITHUB_TOKEN` can read repository metadata but returned
404 from this upload endpoint in testing. A workflow that uploads attachments
therefore needs a separate PAT.

Use a dedicated bot account that can access only the target repositories. Put
its PAT in the protected `canary` Actions environment as `CANARY_TOKEN`, never
as a repository-level secret, and expose it as `GH_TOKEN` only to that job.
Restrict the environment to the default branch. Do not reuse a broad personal
PAT, and do not expose the secret to code from forks or other untrusted sources.
Classic PAT `repo` scope is the only PAT configuration verified so far;
fine-grained PATs remain unverified.

The included [canary workflow](.github/workflows/canary.yml) is manual and
default-branch-only until a dedicated credential is configured. A missing
secret fails the probe instead of reporting an untested green result.

## Why this exists

In tests against github.com, GitHub rendered an inline video player only for
URLs shaped like:

```text
https://github.com/user-attachments/assets/<uuid>
```

Release assets, raw repository files, and external CDN URLs were removed from
`<video>` elements by GitHub's Markdown sanitiser. The user-attachment URL was
obtained through an undocumented `uploads.github.com` endpoint that accepts a
PAT. This package keeps that unstable dependency behind one small, validated
surface. It does not silently fall back to a URL that GitHub will not play.

Verified on 2026-08-09:

| Case | Result |
|---|---|
| PNG upload to a public repository | 201 |
| MP4 upload to public and private repositories | 201 |
| Classic PAT with `repo` scope | works |
| 12 MiB video | 201 |
| 124 MiB video | 422 size error |
| Automatic Actions `GITHUB_TOKEN` | upload returns 404 |
| user-attachments URL in a PR `<video>` | renders a player |
| Release, raw, or external URL in `<video>` | tag removed |

Verified on 2026-08-14:

| Case | Result |
|---|---|
| `PATCH /issues/{N}` on a pull request body | 200, body updated |
| `--issue N` pointing at a pull request | stops before the write |

Not yet verified: fine-grained PATs, GitHub Enterprise Server, or future
compatibility of the upload endpoint. Uploading to a private repository was
verified, but attachment access control outside the uploader's session was not.

## Development

```bash
npm ci
npm run verify
```

`verify` compiles with strict type checking and runs the tests. The test suite
does not contact GitHub. The manual canary is the separate live
endpoint probe. Release instructions are in [docs/releasing.md](docs/releasing.md).

Report vulnerabilities through [GitHub Security Advisories](.github/SECURITY.md),
not a public issue.

## License

MIT
