# ss.ai

[English](README.md) | [简体中文](README.zh-CN.md) | 日本語

`ss.ai` は、LLM を用いたキャラクター会話・TRPG 風対話を制御するための TypeScript 製実験プロジェクトです。中心となるのは `packages/persona-flow` で、prompt context の組み立て、prompt template の描画、model-call purpose ごとのモデル選択、注入された client 経由での LLM 呼び出し、そして chat turn の永続化を担当します。

この README は、今後の保守作業に向けたプロジェクトマップです。初めてこのリポジトリを開く場合は、まずここを読み、その後で "Key Files" に挙げたファイルを追ってください。

## プロジェクトの状態

本リポジトリは、個人開発によるポートフォリオ・研究用プロジェクトです。

主な目的は、以下の技術・設計経験を示すことです。

- TypeScript / Node.js によるアプリケーション設計
- LLM API 連携
- SSE によるストリーミングチャット
- prompt template の構成・管理
- structured output / tool-call 風 event 設計
- SQLite を用いた会話・キャラクター情報の永続化
- キャラクター会話 / TRPG 風インタラクション設計
- LLM プロバイダー抽象化レイヤー設計

現時点では、汎用的な OSS フレームワークとしての利用を目的としたものではありません。
API の安定性、後方互換性、本番運用レベルの品質、継続的な外部サポートは保証していません。

## ワークスペース

このリポジトリは `pnpm-workspace.yaml` で定義された pnpm workspace を使っています。

- `packages/*`
- `apps/*`

よく使うコマンド:

```bash
npm run setup
pnpm install
pnpm run dev:server
pnpm run dev:web
pnpm run build
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run start:server:staging
pnpm run start:server:prod
pnpm run test
pnpm run prompt:debug -- --help
```

ローカルのデフォルト HTTP ポートは `apps/server/config/config.default.json` で定義されている `8999` です。

## インストールとデプロイ

初回セットアップでは、固定された pnpm バージョンをインストールして有効化します。

```bash
npm run setup
```

セットアップ後は pnpm コマンドのみを使ってください。

```bash
pnpm install
pnpm run build:server
pnpm run build:web
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run deploy:server:staging
pnpm run deploy:server:prod
pnpm run deploy:web:staging
pnpm run deploy:web:prod
```

デプロイ出力のルートは `.deploy-staging` と `.deploy-prod` です。

各デプロイルートには次の内容が含まれます。

- `server`: `config/*` と `schemas/config.schema.json` を含む Node.js サーバーパッケージ
- `web`: `apps/web/dist` から生成される静的アセット

デプロイ済みサーバーは、server パッケージのルートから設定ファイルを読み込みます。

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

Lightsail デプロイでは、release activation のタイミングで `server/config/config.local.json` を生成することもできます。現在のフローでは、CI secret `LIGHTSAIL_DEFAULT_API_KEY` と `scripts/activate-lightsail-release.mjs` を使って、対象ホストにマシン固有の上書きファイルを書き込みます。

web のデプロイ出力先:

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

デプロイ済みサーバーの起動コマンド:

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

ローカル開発コマンドは、リポジトリルートから起動する前提です。つまり `pnpm run dev:server`、`pnpm run dev:web`、`pnpm run dev:qq-bot` はリポジトリルートを `process.cwd()` として動作するため、実行時ファイルは `./.runtime/` 配下に作成されます。デプロイ済みレイアウトでは、`pnpm run start:server:staging`、`pnpm run start:server:prod`、または `pnpm --dir ./.deploy-prod/server start` を実行すると `.deploy-*/server` が作業ディレクトリになるため、実行時ファイルはその server パッケージ配下に作成されます。

例:

```bash
pnpm --filter @ss-ai/server start
pnpm --dir ./.deploy-prod/server start
```

実行時ファイルのルートを明示的に変えたい場合は `RUNTIME_HOME` を設定してください。

workspace パッケージの依存関係宣言、つまり `dependencies`、`devDependencies`、`peerDependencies`、または workspace link を変更した場合は、`pnpm-lock.yaml` とデプロイ依存グラフを同期させるために `pnpm install` を再実行してください。

## Packages

### `packages/persona-flow`

中核となるドメインパッケージです。できるだけフレームワークや永続化実装に依存しない形を保つ想定です。

主な責務:

- `src/stores/**` にドメイン store interface を定義する
- アプリから使う集約依存境界として `AppStores` を定義する
- `PromptContextBuilder` を使って stores から prompt context を構築する
- `modelCallRegistry` を通じて model-call handler を解決する
- 現在の `chat.main/single_character_chat` の prompt 組み立てと出力正規化を実装する
- `PersonaFlowChatTurnService` で chat turn をオーケストレーションする
- `ModelRuntime` でモデル実行時設定を解決し、注入された `ModelClient` を呼び出す
- `src/llm/modelClient.ts` で LLM client interface を定義する

主な chat フロー:

1. `PersonaFlowChatTurnService.chatTurn()` が user、character、conversation、message の入力を受け取る
2. `prepareChatTurnContext()` が character と conversation を検証し、sender actor を解決し、必要に応じて user message を追加し、`PromptContext` を構築する
3. `resolveModelCall()` が purpose と interaction mode に応じて登録済み handler を選ぶ。現在は `chat.main:single_character_chat` が使われている
4. handler が LLM messages を組み立て、`ModelRuntime.chat()` が `userPreferences.modelAssignments[modelCallPurpose]` から provider と model を、`providerCredential` から API key を解決して `ModelClient` を呼び出す
5. structured reply は正規化される。structured 出力が空なら assistant message は追加しない
6. スキップされなかった reply は conversation の self actor message として chat store に追加される

`single_character_chat` の本当の streaming はまだ未完成です。`/v1/chat/stream` エンドポイントとフロントエンドの SSE 経路は存在しますが、現在の実装は structured model call にフォールバックし、完全な reply を 1 つの SSE chunk として返します。

interaction mode は `@ss-ai/contracts` で共有されています。現在ランタイムで登録されているのは `single_character_chat` だけで、その他の mode は contracts と UI にプレースホルダーとして存在するものの、prompt や model-call dispatch にはまだ接続されていません。

### `packages/contracts`

フロントエンドとバックエンドで共有する契約パッケージです。

主な責務:

- `ApiDefine` を使って HTTP API を定義する
- `src/apis/*.api.ts` に request と response の型を定義する
- `INTERACTION_MODES`、`DEFAULT_INTERACTION_MODE`、`InteractionMode` を提供する
- `MODEL_CALL_PURPOSES`、`ModelCallPurpose`、モデル割り当て関連の型を提供する

model-call 設定では `MODEL_CALL_PURPOSES` / `ModelCallPurpose` と `ModelAssignment` / `ModelAssignmentMap` を使います。

### `packages/persona-flow-sqlite`

`AppStores` の SQLite 実装です。

主な責務:

- Drizzle を使って `better-sqlite3` データベースを開く
- `src/db/schema.ts` に schema を定義する
- character、conversation、actor、message、user profile、preferences、provider credential などの store を実装する
- `createSqliteStores()` で完全に配線された `AppStores` を作る

重要なテーブル:

- `characters`
- `conversations`
- `conversation_actors`
- `messages`
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`

`user_preferences.model_assignments_json` には model-call purpose から `{ provider, model }` へのマッピングが保存されます。

### `packages/persona-flow-model-client`

モデルプロバイダー統合パッケージです。

主な責務:

- `persona-flow` の `ModelClient` interface を実装する
- `DefaultModelClient` が provider ごとに処理を振り分ける
- 現在の実プロバイダーは `MistralModelClient` による Mistral
- 非 structured 生成、非 structured streaming、structured 生成、モデル一覧取得をサポートする

provider 一覧と API URL は runtime config から取得します。API key は user と provider ごとに credential store に保存されます。SQLite では現状、encrypt/decrypt helper が no-op のため、実データは本格的な暗号化を追加するまでは平文のまま保存されます。

### `packages/persona-flow-logger`

server と bot のランタイムで使う小さなファイルロガーです。

主な責務:

- `verbose`、`debug`、`info`、`warn`、`error` の各ログレベル
- ソース位置とスタックトレースの付与
- グローバル logger helper

## Apps

### `apps/server`

Express ベースの HTTP サーバーです。

主な責務:

- `apps/server/config/config.default.json`、必要に応じて `apps/server/config/config.{APP_ENV}.json`、`apps/server/config/config.local.json` を読み込む
- `runtimeFiles.userDataDir/app.db` 配下の SQLite DB を開く
- `createSqliteStores` を通じて `AppStores` を作る
- chat、user preferences、profiles、characters、conversations、conversation actors の HTTP ルートを登録する
- chat request ごとに stores、logger、prompt logger、`DefaultModelClient` を注入した `PersonaFlowChatTurnService` を生成する

重要な挙動:

- 現状は実質 single-user アプリで、選択された chat path で `userId` を明示しない限り API コードは `DEFAULT_USER_ID = "default"` を使う
- Auth は `config.auth.mode` により `default-user` と `local-password` の 2 モードを持つ
- `default-user` は実際のサインインを行わず、すべての request を設定済み default user として扱う
- `local-password` はシンプルな username/password と session-cookie ベースの auth フローを提供する
- `/v1/chat` は structured output をデフォルトにする
- `/v1/chat/stream` は SSE のレスポンス形状を保ち、HTTP レイヤーでは structured mode を拒否するが、現在の `single_character_chat` 実装はまだ完全 reply を一度に返す
- `/v1/chat/dry-run` は prompt message を組み立てるだけで、LLM 呼び出しも永続化も行わない
- prompt log は `promptLog` config で制御される

### `apps/web`

Vue 3 と Vite のフロントエンドです。

主な責務:

- 左に workspace sidebar、中央に chat panel、右に context inspector と settings を持つ 3 ペイン UI
- `@ss-ai/contracts` の API 型と定数を利用する
- provider API key と model assignment を設定できるようにする
- chat request、stream request、dry-run request、message deletion request を送る

重要な UI 状態:

- `src/shared/state/appState.ts` の `contextVersion` は character または conversation context が変わったときに chat history の再読み込みを促す
- active な character、conversation、actor の状態は panel ごとの view-model module にある
- structured の非 streaming chat は動作する。非 structured streaming の UI 経路はあるが、現在の `single_character_chat` バックエンドは依然として 1 つの完全 reply chunk を返す

現在の設定まわり:

- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts` が purpose ごとの `modelAssignments` を読み書きする
- 対応 API は `/v1/user-preference/model-assignment`

### `apps/prompt-debug-cli`

prompt 実験用の CLI です。

主な責務:

- YAML の prompt-debug 設定を読む
- Handlebars prompt template を描画する
- render-only モードでも、設定モデル呼び出しモードでも使える
- 最終的に組み立てられた messages を出力できる

例:

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only
```

### `apps/qq-bot`

QQ bot 統合です。

主な責務:

- QQ の private/group message を受け取る
- server conversation を解決または新規作成する
- server chat API を呼び出し、サーバー出力に応じて reply を記録またはスキップする

このアプリは HTTP サーバーが利用可能で、正しく設定されていることを前提とします。

## Runtime Config

config の読み込みは `apps/server/src/util/config.ts` に実装されています。

読み込み順:

1. `apps/server/config/config.default.json`
2. `APP_ENV` が設定され、対応ファイルが存在する場合は `apps/server/config/config.{APP_ENV}.json`
3. `apps/server/config/config.local.json` があればそれも読む

マージ後の config は `apps/server/schemas/config.schema.json` で検証されます。

config ファイルは source mode では常に `apps/server/config` から、deploy 済み package では `server/config` から読まれます。`logger.logFilePath`、`runtimeFiles.tempDir`、`runtimeFiles.userDataDir`、`promptLog.filePath` のような相対 runtime path は、デフォルトでは現在の作業ディレクトリ基準で解決されます。必要なら `RUNTIME_HOME` で上書きできます。

`apps/server/config/config.local.json` はマシン固有の上書き用で、コミットしません。ローカル開発用の上書きが必要なら `apps/server/config/config.local.json.example` をコピーして使います。

現在の Lightsail デプロイフローでは、`config.local.json` はリリースアーカイブに最初から含まれている必要はありません。release activation のタイミングでサーバー上に生成し、最優先の runtime override として扱えます。

コミット済みの環境別 overlay は `apps/server/config/config.staging.json` と `apps/server/config/config.prod.json` にあります。

`apps/qq-bot` はデフォルトで `apps/qq-bot/.env` から bot 用環境変数を読み込みます。リポジトリルートから `pnpm run dev:qq-bot` を起動した場合、その runtime output もリポジトリルートの `.runtime/` に出ます。

重要な設定セクション:

- `http`: host と port
- `logger`: ファイルパス、ログレベル、ソース位置とスタックオプション
- `runtimeFiles`: temp ディレクトリと user data ディレクトリ
- `agent`: モデル client の timeout と retry 設定
- `promptLog`: prompt logging の有効化と出力先
- `models`: provider 設定、API URL、任意の default API key、default model、任意の静的 `availableModels`
- `defaultModelAssignments`: `ModelCallPurpose` ごとの provider/model フォールバック定義
- `auth`: auth mode、default user id、registration フラグ、session lifetime、cookie 設定

デフォルト config では provider key `mistral.ai` が定義されており、Mistral API URL と静的なモデル一覧を持ちます。

## Data And Actor Model

Conversation は単なる user/assistant transcript ではなく、明示的な actor を持ちます。

- `self`: 会話で返答する AI character
- `other`: ログインユーザーまたはローカル actor
- `system`: 予約済みの system actor

message に保存されるのは `senderActorId`、`conversationId`、content、timestamp だけです。prompt 描画時に actor が LLM role に変換されます。

- `self` -> `assistant`
- `system` -> `system`
- それ以外 -> `user`

`packages/persona-flow/src/prompt/speakerTag.ts` には共有 speaker-tag helper がありますが、これはより豊かな interaction mode 用です。現在の `single_character_chat` prompt path では、speaker tag を LLM に送る message の先頭に付けません。reply 内で名前が重複するのを避けるため、assistant 風の name prefix は出力正規化時に除去されます。

## Model Assignment

model assignment は purpose ベースです。共有識別子は `packages/contracts/src/modelCallPurpose.ts` にあります。

現在の purpose:

- `chat.main`
- `memory.summarize`

chat path は現在 `modelCallPurpose: "chat.main"` でモデルを呼び出します。

解決順は user 優先、config フォールバックです。

1. user model assignment
2. `defaultModelAssignments[modelCallPurpose]`
3. error

API key の解決順も user 優先です。

1. user provider credential
2. `models[provider].apiKey`
3. error

呼び出しを成功させるには、現在の user が次の条件を満たす必要があります。

1. 対象 purpose について user preference に model assignment があるか、対応する `defaultModelAssignments` がある
2. その provider に対する user credential があるか、runtime config に default API key がある
3. その provider の runtime config が存在する

## Key Files

挙動をレビューまたは変更するなら、まずここから見てください。

- `packages/contracts/src/modelCallPurpose.ts`
- `packages/contracts/src/interactionMode.ts`
- `packages/contracts/src/apis/*.api.ts`
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/persona-flow/src/chatTurn/chatTurnPreparation.ts`
- `packages/persona-flow/src/modelCall/modelRuntime.ts`
- `packages/persona-flow/src/modelCall/modelCallRegistry.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/promptViewModel.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatOutput.ts`
- `packages/persona-flow/src/stores/appStores.ts`
- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/CharacterDbRouter.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`
- `packages/persona-flow-model-client/src/defaultModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `apps/server/src/http/apis/chat/*.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`
- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts`

## 現在のメンテナンスメモ

- `AI_FUNCTIONS` / `AiFunction` から `MODEL_CALL_PURPOSES` / `ModelCallPurpose` への rename は contracts、web、server、store の各層で完了している
- SQLite の model assignment カラムは `model_assignments_json` で、旧ストレージ互換は削除済み
- SQLite credential store には API key 暗号化 hook があるが、現状は入力をそのまま返す
- 低優先 TODO: デプロイと鍵管理の前提が固まったら、現在の no-op API key 暗号化/復号を実際の保護方式に置き換える
- tool call は検知して TODO として記録するだけで、まだ実行しない
- `single_character_chat` の streaming は未完成で、SSE route はあるが現在は 1 つの完全 reply chunk にフォールバックしている
- `single_character_chat` 以外の interaction mode は宣言済みだが、runtime model-call dispatch には未登録
- speaker-tag helper と、より豊かな multi-actor prompt shaping は後続の interaction mode 用に残してあり、現在の `single_character_chat` path は意図的に単純化している
- TODO: web component の i18n は現在 module-level helper に依存している。SSR、app ごとの instance、より厳密な test isolation が必要になったら `useI18n` 風の hook/provider に移行する

## クイックスモークパス

有用なチェック:

```bash
pnpm run build
pnpm run test
pnpm run dev:server
pnpm run dev:web
```

HTTP ヘルスチェック:

```bash
curl http://127.0.0.1:8999/health
```

モデル挙動を調べる前に、dry-run で prompt 組み立て結果を確認できます。

```bash
curl -X POST http://127.0.0.1:8999/v1/chat/dry-run \
  -H "Content-Type: application/json" \
  -d '{"characterId":"<character-id>","conversationId":"<conversation-id>","userMessageText":"hello","llmResponseMode":"structured"}'
```