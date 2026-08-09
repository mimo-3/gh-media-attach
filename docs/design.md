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

## まだ確認できていないこと

- fine-grained PAT とGitHub Actionsの `GITHUB_TOKEN`（`ghs_`）で201が返るか。CIで使えるかがこれで決まる
- 拡張子とcontent_typeが食い違うときの挙動
