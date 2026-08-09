# gh-video-attach

Attach videos and images to GitHub issues, PRs and comments with a personal access token — no browser, no session cookie.

> **Status: design phase.** The upload path is verified working (see [docs/design.md](docs/design.md)), but the library itself is not implemented yet.

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

## Planned interface

Three ways in, one core:

```bash
# CLI
gh-video-attach ./demo.mp4 --repo owner/name --pr 42
```

```ts
// library
import { attach, toMarkdown } from "gh-video-attach";
const asset = await attach("./demo.mp4", { repo: "owner/name" });
toMarkdown(asset); // <video src="..." controls></video>
```

```
# MCP server, for coding agents
attach_media(path, repo)  ->  ready-to-paste markdown
attach_and_comment(path, repo, issue)
```

The renderer picks the syntax from the file's MIME type. Videos become `<video>` tags; images become `![alt](url)`. Using `![]()` for a video produces an `<img>` that never plays, and that mistake is the one thing an agent should not be able to make.

## Verified

| Case | Result |
|---|---|
| PNG upload, public repo | 201 |
| MP4 upload, public repo | 201 |
| MP4 upload, private repo | 201 |
| Auth via `gh auth token` (`gho_`, scope `repo`) | works |
| `<video>` with a `user-attachments` URL | renders a player |
| `<video>` with a release / raw / external URL | tag stripped |
| `![](url)` with an MP4 | renders as `<img>`, no playback |

Checked on 2026-08-09 against github.com. Not yet checked: fine-grained PATs, the Actions `GITHUB_TOKEN`, and real size limits.

## License

MIT
