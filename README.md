# gh-video-attach

Attach videos and images to GitHub issues, PRs and comments with a personal access token — no browser, no session cookie.

> **Status: working, not published.** The CLI and the library run today. The MCP server is not built yet, and nothing is on npm.

## GitHub plays videos only from its own attachment URLs

GitHub's Markdown sanitizer renders an inline `<video>` player for exactly one kind of URL: `https://github.com/user-attachments/assets/<uuid>`. Point a `<video>` tag at a release asset, at `raw.githubusercontent.com`, or at your own CDN, and the tag is stripped from the output entirely.

Those attachment URLs are normally produced by dragging a file into the web editor. There is no documented API for it, so existing tools drive a real browser through Playwright and a logged-in session — which breaks under SSO re-auth and is painful in CI.

## One authenticated POST is enough

```bash
curl -X POST "https://uploads.github.com/user-attachments/assets\
?name=demo.mp4&content_type=video/mp4&repository_id=1187874337" \
  -H "Authorization: Bearer $(gh auth token)" \
  -H "Accept: application/json" \
  --data-binary @demo.mp4

# 201 {"url":"https://github.com/user-attachments/assets/9a34c7bd-..."}
```

Drop that URL into a `<video>` tag and GitHub renders a player:

```html
<video src="https://github.com/user-attachments/assets/9a34c7bd-..." controls></video>
```

`uploads.github.com` is undocumented and unsupported by GitHub. It can change or disappear without notice. This project's job is to wrap it honestly: one small surface to call, an error that says which way it broke, and a nightly canary run so a change gets noticed by the repo rather than by your users.

## Usage

```bash
npm install && npm run build

# print ready-to-paste markdown
node dist/cli.js ./demo.mp4 --repo owner/name
# <video src="https://github.com/user-attachments/assets/..." controls></video>

# post it as a comment instead
node dist/cli.js ./demo.mp4 --repo owner/name --pr 42

# just the URL
node dist/cli.js ./demo.mp4 --repo owner/name --url
```

```ts
import { attach, toMarkdown, resolveToken } from "gh-video-attach";

const asset = await attach("./demo.mp4", {
  repo: "owner/name",
  token: resolveToken(),
});
toMarkdown(asset); // <video src="..." controls></video>
```

The token comes from `--token`, then `GH_TOKEN`, then `GITHUB_TOKEN`, then `gh auth token` — the same order `gh` itself uses. In CI, set `GITHUB_TOKEN`: arguments passed as `--token` are visible to other users through `ps`.

`toMarkdown` picks the syntax from the file's content type. Videos become `<video>` tags; images become `![alt](url)`. Writing `![](demo.mp4)` yields an `<img>` that never plays, and that is the one mistake this library exists to prevent — so the caller never chooses the syntax.

An MCP server (`attach_media`, `attach_and_comment`) is the next thing to build, so agents get the same guarantee.

## Failures say which way they broke

Every failure throws a `GitHubAttachError` with a `kind` you can branch on, because the wording of an undocumented endpoint's errors is not something to match on:

```ts
import { attach, GitHubAttachError } from "gh-video-attach";

try {
  await attach("./demo.mp4", { repo: "owner/name", token });
} catch (error) {
  if (error instanceof GitHubAttachError && error.kind === "endpoint-changed") {
    // GitHub answered in a shape this library does not recognise.
  }
}
```

`kind` is one of `auth`, `rate-limit`, `too-large`, `not-found`, `endpoint-changed`, `unknown`. `endpoint-changed` is the one that matters: it fires when the response is not JSON, or when the returned URL is not a `user-attachments` asset — the case where a naive wrapper would hand back a URL that renders as nothing at all.

## Development

```bash
npm install
npm run verify   # typecheck + tests, no network
```

A nightly [canary workflow](.github/workflows/canary.yml) uploads a 1px image against the real endpoint. It is the only thing that catches GitHub changing the path out from under this library.

## Verified

| Case | Result |
|---|---|
| PNG upload, public repo | 201 |
| MP4 upload, public repo | 201 |
| MP4 upload, private repo | 201 |
| Auth via `gh auth token` (`gho_`, scope `repo`) | works |
| 12 MB video | 201 — the 10 MB free-plan cap does not apply here |
| 124 MB video | 422 with `errors[0].field = "size"`, not 413 |
| `<video>` with a `user-attachments` URL | renders a player, in a real PR body |
| `<video>` with a release / raw / external URL | tag stripped |
| `![](url)` with an MP4 | renders as `<img>`, no playback |
| display name without an extension | 422 — GitHub matches the name's extension against the content type |
| the Actions `GITHUB_TOKEN` | **404** — it cannot use this endpoint at all |

Checked on 2026-08-09 against github.com. Not yet checked: fine-grained PATs.

The Actions token result matters for CI: a workflow that attaches a video needs a PAT in a secret, not the `GITHUB_TOKEN` it gets for free.

## License

MIT
