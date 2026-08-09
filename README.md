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

`uploads.github.com` is undocumented and unsupported by GitHub. It can change or disappear without notice. This project's job is to wrap it honestly: one small surface to call, a clear error when it breaks, and a degraded fallback that never pretends to be a video player.

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

The token comes from `--token`, then `GITHUB_TOKEN`, then `gh auth token`.

`toMarkdown` picks the syntax from the file's content type. Videos become `<video>` tags; images become `![alt](url)`. Writing `![](demo.mp4)` yields an `<img>` that never plays, and that is the one mistake this library exists to prevent — so the caller never chooses the syntax.

An MCP server (`attach_media`, `attach_and_comment`) is the next thing to build, so agents get the same guarantee.

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

Checked on 2026-08-09 against github.com. Not yet checked: fine-grained PATs and the Actions `GITHUB_TOKEN`.

## License

MIT
