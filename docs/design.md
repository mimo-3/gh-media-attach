# 設計メモ

最終更新: 2026-08-09 / 検証環境: github.com

## 解こうとしている問題

GitHubのissue・pull request・commentで動画プレイヤーとして表示できるのは、
実測上 `https://github.com/user-attachments/assets/<uuid>` のURLだけだった。
Release assets、`raw.githubusercontent.com`、外部CDNのURLを `<video>` に指定すると、
GitHubのMarkdownサニタイザがタグを削除する。

`gh-video-attach` はファイルをGitHubのuser attachmentとしてアップロードし、
画像と動画に合うMarkdownを返す。ブラウザ、cookie、セッション情報は使わない。

## 非公開エンドポイントへの依存

アップロードには、GitHubが公開仕様として案内していない次のエンドポイントを使う。

```text
POST https://uploads.github.com/user-attachments/assets
  ?name=<filename>&content_type=<mime>&repository_id=<numeric id>
Authorization: Bearer <token>
Accept: application/json
body: file bytes
```

2026-08-09時点では、classic PATの `repo` scopeでpublic/private repositoryへの
PNG・MP4アップロードに成功した。Actionsが自動発行する `GITHUB_TOKEN` は、
repository lookupには成功するがuploadだけ404になる。fine-grained PATは未検証。

この経路には互換性の保証がない。404はrepositoryの不存在だけでなく、認証方式が
対象外になった場合やendpointが停止した場合にも起きる。そのためuploadの404は
`upload-unavailable` として扱い、原因を断定しない。

Releasesへの自動フォールバックは実装しない。Release assetのURLではinline videoに
ならず、権限と永続データを追加で変更するためだ。主経路が失敗したら、成功に見せかけず
型付きエラーを返す。

## 公開インターフェース

```text
core     attach(path, { repo, token, name?, contentType?, signal? }) -> Asset
comment  comment({ repo, issue, body, token, signal? }) -> URL
render   toMarkdown(asset) -> video HTML または image Markdown
cli      gh-video-attach <file> --repo owner/name [--issue N | --pr N]
```

callerが `repositoryId` を指定する入口は持たない。`repo` から毎回GitHub APIで
numeric IDを取得し、コメント先とアップロード先が食い違う状態を防ぐ。

トークンは、ライブラリの明示引数、`GH_TOKEN`、`GITHUB_TOKEN`、
`gh auth token` の順に解決する。CLIにはtokenを値として渡すoptionを置かない。
command line argumentは同じ端末の別processから見えるためだ。

## ファイルとMarkdownの境界

ファイルはupload前に次を検証する。

- regular fileであること
- 100 MiB以下であること。`stat` で確認してから読み込み、read後にも再確認する
- 許可した画像・動画のMIME typeであること
- 表示名の拡張子がGitHubへ送るcontent typeと整合すること

GitHubは124 MiBのMP4を413ではなく422で拒否し、
`errors[0].field === "size"` を返した。413とsize起因の422はどちらも
`too-large` に分類する。

動画はescaped attributeを持つ `<video controls>`、画像は検証済みの
user-attachments URLを持つMarkdownにする。手作りの `Asset` を渡されても、
改行や別schemeを含むURLをMarkdownへ埋め込まない。

## エラー契約

rootからexportする関数の失敗は、すべて `GitHubAttachError` で返す。
filesystem、network、abort、不正なresponse bodyを生の例外として漏らさない。

主な `kind` は次のとおり。

- `invalid-input`: repo、issue、MIME typeなどcaller入力の不備
- `file`: fileの不存在、directory、読み込み失敗
- `auth`: token拒否
- `rate-limit`: primary/secondary rate limit
- `too-large`: local上限またはGitHubのsize上限
- `upload-unavailable`: 非公開upload endpointの404
- `endpoint-changed`: response形式または返却URLが契約外
- `network` / `aborted` / `server`: transport、cancel、GitHub 5xx
- `not-found` / `unknown`: 公開REST resourceの404、その他

status、HTMLを除去したdetail、元の `cause` は可能な範囲で保持する。

## 認証とCIの境界

トークンはGitHub APIへのrequestにだけ使い、保存・log出力しない。
CLIの `gh auth token` fallbackにはtimeoutを設ける。

CIでuploadする場合、自動発行の `GITHUB_TOKEN` は使えない。専用bot accountを作り、
対象repositoryだけへアクセスさせ、そのbotのPATをsecretとして `GH_TOKEN` に渡す。
広いrepositoryへアクセスできる個人PATを共有しない。fork由来など信頼できないcodeを
実行するworkflowへsecretを渡さない。

canaryは専用PATを安全に用意できるまで手動実行だけにする。secret未設定なら失敗させ、
未検証のrunをgreenにしない。現在のprobeはupload endpointの疎通確認であり、
動画renderingまで含むE2Eではない。

## 配布

初版はnpmだけで配布する。package名を確保する前にrepositoryをpublicにすると、
第三者に同名を取られる余地があるため、最初のpublishを先に行う。

初回publish後はGitHub Actionsをnpm trusted publisherとして登録する。
以後のreleaseはlong-lived npm tokenを置かず、release workflowのOIDCでpublishする。
具体的な手順は [releasing.md](releasing.md) に記載する。

## 検証済みの挙動

| Case | Result |
|---|---|
| PNG upload, public repository | 201 |
| MP4 upload, public repository | 201 |
| MP4 upload, private repository | 201 |
| classic PAT (`repo` scope) | works |
| 12 MiB video | 201 |
| 124 MiB video | 422, `errors[0].field = "size"` |
| user-attachments URLの `<video>` | PR本文でplayerとして表示 |
| Release / raw / external URLの `<video>` | tagが削除 |
| Actionsの自動 `GITHUB_TOKEN` | uploadのみ404 |

未検証:

- fine-grained PAT
- GitHub Enterprise Server
- user-attachments endpointの将来互換性
