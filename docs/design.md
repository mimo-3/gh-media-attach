# 設計メモ

最終更新: 2026-08-09 / 検証環境: github.com, `gh` CLI 認証済みアカウント

## 動画プレイヤーになるURLは1種類しかない

GitHubのMarkdownサニタイザに `<video>` タグを通したとき、生き残るかどうかはURLのドメインで決まる。`POST /markdown`（`mode: gfm`）で実測した結果:

| 書いたもの | 出力 |
|---|---|
| `<video src="https://github.com/user-attachments/assets/<uuid>">` | `gh:secured-asset-reference` に変換され、折りたたみ付きの `<video controls>` になる |
| `<video src="https://github.com/<owner>/<repo>/releases/download/v1.0.0/demo.mp4">` | タグごと削除 |
| `<video src="https://raw.githubusercontent.com/.../demo.mp4">` | タグごと削除 |
| `<video src="https://cdn.example.com/demo.mp4">` | タグごと削除 |
| `<video><source src="https://cdn.example.com/demo.mp4"></video>` | タグごと削除 |

つまりサニタイザは `<video>` を許可しているのではなく、`user-attachments` の資産参照だけを特別扱いしている。Releases・外部CDN・GitHub Pagesのどれを使っても、issue本文の中で動画は再生できない。

画像は事情が違う。`![alt](url)` はCamoプロキシ経由で任意のホストから表示できるので、画像だけならこのライブラリは要らない。**動画のためだけに存在する**。

`![alt](<mp4のURL>)` と書くと `<img src="...mp4">` になり、再生されないまま壊れた画像として出る。書式を間違えたときに黙って劣化するので、ライブラリ側でMIMEを見て書式を決める。

## アップロードはPATだけで通る

```
POST https://uploads.github.com/user-attachments/assets
  ?name=<filename>&content_type=<mime>&repository_id=<numeric id>
Authorization: Bearer <token>
Accept: application/json
body: ファイルのバイナリ

201 → {"url": "https://github.com/user-attachments/assets/<uuid>"}
```

2026-08-09に確認したこと:

- 8x8のPNGをpublicリポジトリへ → 201
- 320x240 2秒のmp4をpublicリポジトリへ → 201
- 同じmp4をprivateリポジトリへ → 201
- 認証は `gh auth token` が返す `gho_` トークン（scope: `gist`, `read:org`, `repo`, `workflow`）

cookieもauthenticity tokenも要らない。旧来の3段フロー（`POST /upload/policies/assets` → S3へPOST → `asset_upload_url` へPUT）はcookie必須でPATを拒否するが、この新エンドポイントは単発のPOSTで完結する。既存OSS（`atani/gh-attach`, `lisonge/user-attachments` など）は旧フロー前提でPlaywrightやcookie抽出に依存しているので、ここが差別化点になる。

`repository_id` はGraphQLのnode IDではなく数値ID。`GET /repos/{owner}/{repo}` の `.id` を使う。owner/name表記から解決する層をライブラリに持たせる。

## 壊れたときは劣化させる。取り繕わない

`uploads.github.com` は非公開エンドポイントで、GitHubは何も保証していない。規約上は、Acceptable Use PolicyのScraping条項がAPIアクセスを除外しているため明確な違反とは言えないが、予告なく仕様が変わる前提で組む。

主経路が失敗したときのフォールバックは、Releasesにアセットを上げてサムネイル画像とリンクを出す形にする。動画プレイヤーは代替できないので、代替できたふりはしない。フォールバックが発動したことは必ず利用者に伝える。

CIには主経路の疎通テストを置いて、壊れた日にすぐ気づけるようにする。

## 構成

```
core     attach(path, {repo, token}) -> {url, mime, size}
render   toMarkdown(asset) -> <video> か ![]()
cli      gh-video-attach ./demo.mp4 --repo owner/name [--issue N | --pr N]
mcp      attach_media / attach_and_comment
```

トークンの優先順位は 引数 → `GITHUB_TOKEN` → `gh auth token`。

MCPサーバーを入口に置くのは、エージェントに書式を選ばせないため。`attach_media` はそのまま貼れるMarkdownを返し、`attach_and_comment` は投稿まで済ませる。

## サイズ上限は100MB。超過は413ではなく422で返る

実測（2026-08-09）:

- 12MBのmp4 → 201。Web UI添付の「無料プランは10MBまで」はこのエンドポイントには効いていない
- 124MBのmp4 → 422。本文は `errors[0].field === "size"` で、メッセージは `size Yowza that's a big file. <span class='drag-and-drop-error-info'>...` のようにHTMLを含む

422をひとくくりに「認証方式が変わった」と解釈すると誤診するので、`errors[0].field` を見て切り分け、メッセージからHTMLタグを剥がしてから出す。

## 実PRでのレンダリングも確認済み

PR #1 の本文に `<video>` タグを置き、`Accept: application/vnd.github.html+json` で `body_html` を取得したところ、タグは `data-canonical-src` 付きで残っていた。`POST /markdown` の出力と実際のPR本文で挙動は同じ。

## 表示名の拡張子とcontent typeは一致していないと弾かれる

`--name スクショ` のように拡張子のない表示名を渡すと422で、`name has a file extension that does not match the content type: . != image/png` が返る。GitHubは表示名の拡張子とcontent typeを突き合わせている。

表示名を変えたい人は「見出しを変えたい」のであって「形式を変えたい」わけではないので、拡張子がなければ元ファイルのものを補う。拡張子を明示して渡した場合はそのまま送り、食い違えばGitHubが弾く。

## エラーは文字列ではなく `kind` で判別できるようにする

非公開エンドポイントに依存する以上、呼び出し側が知りたいのは「認証が悪いのか、ファイルがデカいのか、エンドポイントが変わったのか」。メッセージの文言は安定した契約にできないので、`GitHubAttachError.kind`（`auth` / `rate-limit` / `too-large` / `not-found` / `endpoint-changed` / `unknown`）で分岐できるようにした。

`endpoint-changed` は、レスポンスがJSONでないとき、または返ってきたURLが `user-attachments` の形式でないときに出る。ここを検証しないと、GitHubが別形式のURLを返し始めた日に「`<video>` が黙って剥がされて何も表示されない」という一番わかりにくい壊れ方をする。

## GitHub Actionsの `GITHUB_TOKEN` では通らない

canaryを実際に走らせて確認した（2026-08-09、run 31309534007）。`GET /repos/...` は成功して数値IDまで取れるのに、`uploads.github.com` へのPOSTだけが404を返す。ワークフローが自動で受け取るトークンでは、このエンドポイントに到達できない。

CIから動画を添付したいなら、PATをsecretに入れる必要がある。canary自体も `CANARY_TOKEN` を読む形にして、未設定なら何もせず成功で抜けるようにした。設定されるまで毎晩赤くなると、本当に壊れた日に誰も見なくなる。

404のメッセージにもこの事実を入れてある。一番ありがちな踏み方がこれなので。

## まだ確認できていないこと

- fine-grained PAT で201が返るか
