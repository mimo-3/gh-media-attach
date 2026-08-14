# 設計メモ

最終更新: 2026-08-09 / 検証環境: github.com

## 解こうとしている問題

GitHubのissue・pull request・commentで動画プレイヤーとして表示できるのは、
実測上 `https://github.com/user-attachments/assets/<uuid>` のURLだけだった。
Release assets、`raw.githubusercontent.com`、外部CDNのURLを `<video>` に指定すると、
GitHubのMarkdownサニタイザがタグを削除する。

`gh-media-attach` はファイルをGitHubのuser attachmentとしてアップロードし、
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
append   appendToBody({ repo, issue, body, token, expectPullRequest?, signal? }) -> URL
render   toMarkdown(asset) -> video HTML または image Markdown
cli      gh-media-attach <file> --repo owner/name [--issue N | --pr N] [--append-body]
```

callerが `repositoryId` を指定する入口は持たない。`repo` から毎回GitHub APIで
numeric IDを取得し、コメント先とアップロード先が食い違う状態を防ぐ。

## 本文への追記

`appendToBody` はGETで本文を読み、末尾に追記してPATCHで書き戻す。GitHubの
issue bodyにはETagもversion番号もないため、read-modify-writeの後勝ちになる。
読み取りと書き込みの間に入った他人の編集は消える。これは既知の制約として
受け入れ、隠さずREADMEにも書く。複数人が編集する本文にはcommentを使う。

代わりに、書き込んだ結果は検証する。PATCHのresponseに含まれる更新後bodyが
追記したmarkdownで終わっていなければ `conflict` で失敗させる。追加requestは
要らず、同時編集を黙って踏み潰したまま成功を返す状態をなくせる。

`--pr N` と `--issue N` はどちらも `/issues/{N}` に落ちる。commentなら取り違えても
コメントが1件増えるだけだが、本文追記では無関係なobjectを書き換えてしまう。
GETのresponseの `pull_request` fieldの有無で種別を判定し、`expectPullRequest` と
食い違えば書き込む前に `invalid-input` で止める。CLIは `--pr` / `--issue` の
どちらで指定されたかを保持して渡す。

破壊的なPATCHでは `redirect: "error"` にする。repositoryのrename・移管後は
3xxが返り、fetchはmethodとbodyを保ったまま移管先へ追従するためだ。

トークンは、ライブラリの明示引数、`GH_TOKEN`、`GITHUB_TOKEN`の順に解決する。
PATH上のhelper programは自動実行しない。CLIにはtokenを値として渡すoptionを置かない。
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
- `conflict`: responseは読めたが、本文が追記した内容で終わっていない（同時編集）
- `network` / `aborted` / `server`: transport、cancel、GitHub 5xx
- `not-found` / `unknown`: 公開REST resourceの404、その他

status、HTMLを除去したdetail、元の `cause` は可能な範囲で保持する。

## 認証とCIの境界

トークンはGitHub APIへのrequestにだけ使い、保存・log出力しない。

CIでuploadする場合、自動発行の `GITHUB_TOKEN` は使えない。専用bot accountを作り、
対象repositoryだけへアクセスさせ、そのbotのPATをsecretとして `GH_TOKEN` に渡す。
広いrepositoryへアクセスできる個人PATを共有しない。fork由来など信頼できないcodeを
実行するworkflowへsecretを渡さない。

canaryは専用PATを安全に用意できるまで手動実行だけにする。PATはrepository secretでは
なく、default branchだけに制限した `canary` environmentへ置く。workflowもdefault branch
以外では失敗させる。secret未設定なら失敗させ、未検証のrunをgreenにしない。現在の
probeはupload endpointの疎通確認であり、動画renderingまで含むE2Eではない。

## 配布

初版はnpmだけで配布する。package名を確保する前にrepositoryをpublicにすると、
第三者に同名を取られる余地があるため、最初のpublishを先に行う。

初回publish後はGitHub Actionsをnpm trusted publisherとして登録する。
以後のreleaseはlong-lived npm tokenを置かず、`npm` environmentへ束縛したrelease
workflowのOIDCで、package versionと一致するtagだけをpublishする。
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
| PR本文への `PATCH /repos/{owner}/{name}/issues/{N}` | 200、本文が更新される |
| PRに `--issue N` を指定 | PATCH前に `invalid-input` で中断 |

2026-08-14に mimo-3/gh-media-attach#9 で確認した。`--pr N --append-body` で
`<video>` がPR本文に入り、playerとして表示された。

未検証:

- fine-grained PAT
- GitHub Enterprise Server
- user-attachments endpointの将来互換性
- issue本文への `PATCH /issues/{N}`（PR本文でのみ確認した）
- 同時編集による `conflict`（レースを実機で起こしていない）
- 本文の65,536文字上限に到達したときの422 payloadの実際の形
