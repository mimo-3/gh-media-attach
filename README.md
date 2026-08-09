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

Authenticate with `gh auth login`, or set `GH_TOKEN` in the environment.

```bash
# Print ready-to-paste Markdown.
gh-video-attach ./demo.mp4 --repo owner/name

# Post the attachment as a pull request or issue comment.
gh-video-attach ./demo.mp4 --repo owner/name --pr 42
gh-video-attach ./screenshot.png --repo owner/name --issue 42

# Print only the uploaded asset URL.
gh-video-attach ./demo.mp4 --repo owner/name --url
```

Run `gh-video-attach --help` for all options. If an upload succeeds but comment
creation fails, the CLI prints the Markdown to stdout before exiting with an
error, so the uploaded asset is not lost.

The CLI resolves authentication in this order:

1. `GH_TOKEN`
2. `GITHUB_TOKEN`
3. `gh auth token`

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

Pass an `AbortSignal` to `attach` or `comment` when the caller needs its own
timeout or cancellation policy. `toMarkdown` renders supported videos as a
`<video controls>` element and supported images as image Markdown.

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
GitHub server failures, missing REST resources, and unknown responses. The
error also preserves HTTP `status`, a sanitised `detail`, and the original
`cause` where available.

## GitHub Actions authentication

The automatic Actions `GITHUB_TOKEN` can read repository metadata but returned
404 from this upload endpoint in testing. A workflow that uploads attachments
therefore needs a separate PAT.

Use a dedicated bot account that can access only the target repositories. Put
its PAT in an Actions secret and expose that secret as `GH_TOKEN` only to a
trusted job. Do not reuse a broad personal PAT, and do not expose the secret to
code from forks or other untrusted sources. Classic PAT `repo` scope is the
only PAT configuration verified so far; fine-grained PATs remain unverified.

The included [canary workflow](.github/workflows/canary.yml) is manual until a
dedicated credential is configured. A missing secret fails the probe instead
of reporting an untested green result.

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
