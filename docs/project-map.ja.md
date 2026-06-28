# ss.ai Project Map

[English](project-map.md) | [简体中文](project-map.zh-CN.md) | 日本語

このドキュメントは、`ss.ai` の保守者向けプロジェクトマップです。
ワークスペース構成、メインチャットフロー、ランタイム設定、そして現在どのファイルが挙動の起点になっているかを、コールドスタートで素早く把握したいときに使ってください。

機能概要、ライブデモ、短いクイックスタートを先に見たい場合は、リポジトリルートの [README](../README.ja.md) を参照してください。

## Workspace Purpose

`ss.ai` は、LLM 駆動のキャラクター会話と TRPG 風インタラクションのための実験的な TypeScript プロジェクトです。中心にあるのは `packages/persona-flow` で、prompt context の構築、prompt template のレンダリング、model-call purpose ごとのモデル選択、注入されたクライアント経由での LLM 呼び出し、そして生成された chat turn の store 経由での永続化を担います。

このプロジェクトは、現在次の領域を扱っています。

- TypeScript と Node.js によるアプリケーション設計
- LLM API 連携
- SSE ベースのストリーミングチャット
- prompt template の構成と管理
- structured output を主軸にしつつ、将来の agent ツール向けに provider-neutral な tool-call 抽象も残した turn-event 設計
- 会話とキャラクターデータの SQLite 永続化
- キャラクター会話と TRPG 風インタラクション設計
- LLM provider abstraction layer

現段階では、汎用 OSS フレームワークとして使うことは意図していません。
API 安定性、後方互換性、本番運用レベルの品質、継続的な外部サポートは保証していません。

## Workspace

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

ローカルのデフォルト HTTP ポートは `apps/server/config/config.default.json` にある `8999` です。

## Install And Deploy

初回セットアップでは、固定された pnpm バージョンをインストールして有効化します。

```bash
npm run setup
```

セットアップ後は pnpm コマンドのみを使います。

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

デプロイ出力ルートは `.deploy-staging` と `.deploy-prod` です。

各デプロイルートには次が含まれます。

- `server`: `config/*` と `schemas/config.schema.json` を含む Node.js サーバーパッケージ
- `web`: `apps/web/dist` からビルドされた静的アセット

デプロイ済みサーバーは、サーバーパッケージルートから設定ファイルを読みます。

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

Lightsail デプロイでは、release activation 中に `server/config/config.local.json` を生成することもできます。現在のフローでは、CI secret `LIGHTSAIL_DEFAULT_API_KEY` と `scripts/activate-lightsail-release.mjs` を使って、対象ホストにマシンローカルの override ファイルを書き込みます。

web のデプロイ出力は以下に配置されます。

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

デプロイ済みサーバーの起動コマンド:

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

ローカル開発コマンドはリポジトリルートから実行する前提です。したがって `pnpm run dev:server`、`pnpm run dev:web`、`pnpm run dev:qq-bot` はリポジトリルートを `process.cwd()` として使い、ランタイムファイルは `./.runtime/` 配下に作られます。デプロイ済みレイアウトでは、`pnpm run start:server:staging`、`pnpm run start:server:prod`、または `pnpm --dir ./.deploy-prod/server start` が `.deploy-*/server` を作業ディレクトリとして実行されるため、ランタイムファイルもそのサーバーパッケージ配下に置かれます。

例:

```bash
pnpm --filter @ss-ai/server start
pnpm --dir ./.deploy-prod/server start
```

ランタイムファイルのルートを上書きしたい場合は `RUNTIME_HOME` を設定してください。

どの workspace package でも、`dependencies`、`devDependencies`、`peerDependencies`、workspace link を含む依存宣言が変わったら、`pnpm-lock.yaml` とデプロイ依存グラフを同期させるために `pnpm install` を再実行してください。

## Packages

### `packages/persona-flow`

コアドメインパッケージです。できるだけフレームワーク非依存・永続化非依存に保つ想定です。

責務:

- `src/stores/**` にドメイン store interface を定義する
- アプリ層で注入する集約依存境界として `AppStores` を定義する
- `PromptContextBuilder` を通じて store から prompt context を構築する
- `modelCallRegistry` で model-call handler を解決する
- 現在の `chat.main/single_character_chat` における prompt 組み立てと structured-output event フローを実装する
- `PersonaFlowChatTurnService` により chat turn orchestration を担う
- `ModelRuntime` によりモデル実行時情報を解決し、注入された `ModelClient` を呼び出す
- `src/llm/modelClient.ts` に provider-neutral な tool 定義、tool choice、任意の embedding call を含む LLM client interface を定義する
- `submit_turn_events` の event schema を定義し、モデルが返した turn event を parse する
- `src/memory/**` に長期記憶 core を定義する。candidate records、active memory records、decision records、ports、normalization、cosine similarity、conservative decision policy、`MemoryCandidateRecorder`、`MemoryCommitService` を含む
- `src/memoryAdapters/**` に `ModelClientEmbeddingProvider` を定義し、memory core の embedding port を注入された `ModelClient` へ接続する。provider / runtime 依存を `src/memory/**` に漏らさないための境界でもある

レイヤ分割は特に重要です。`PersonaFlowChatTurnService` は turn orchestration と永続化を担当しますが、provider の tool call や structured output を直接 parse しません。登録済みの `ModelCall<TParsedOutput>` が、prompt assembly、要求する出力形式（`structuredOutputSchema` および/または `tools`）、その purpose に固有のビジネスレベル parse を担当します。`ModelRuntime` は provider / model / API key に集中し、生の provider-neutral `llmResponse`（`output` / `structuredOutput` / `toolCalls`）を返します。その後 model call がこれを `parsedOutput` に変換します。オプションの `parsedToolCalls` は、呼び出し側が中間ツール結果を確認する必要がある場合だけ使います。現在の `single_character_chat` では、最終的な可視 reply は `response_format: json_schema` で生成され、`parsedOutput` の `{ displayText, events }` に折り畳まれます。Memory write candidates は同じ structured output の任意 top-level field として扱われ、内部処理用に `parsedOutput.memoryWriteCandidates` へ折り畳まれます。

メインチャットフロー:

1. `PersonaFlowChatTurnService.chatTurn()` が user、character、conversation、message 入力を受け取る
2. `prepareChatTurnContext()` が character と conversation を検証し、sender actor を解決し、必要なら user message を追加して `PromptContext` を作る
3. `resolveModelCall()` が要求された purpose と interaction mode に対応する登録済み handler を選ぶ。現在は `chat.main:single_character_chat`
4. handler が LLM messages を組み立て、`submit_turn_events` event schema と任意の `memoryWriteCandidates` field から作った `structuredOutputSchema` で structured output を要求する。`ModelRuntime.chat()` が `userPreferences.modelAssignments[modelCallPurpose]` から provider と model を解決し、`providerCredential` から API key を解決して `ModelClient` を呼び出す
5. model call が `llmResponse.structuredOutput` を `SubmitTurnEventsArgs` として parse し、正規化済み display text と順序付き `TurnEvent[]` を含む chat 用 `parsedOutput` を返す
6. model call は structured output から `memoryWriteCandidates` も抽出する。assistant turn の永続化後、`PersonaFlowChatTurnService` は `MemoryCandidateRecorder` で candidates を記録し、immediate commit が有効なら `MemoryCommitService` で embedding、dedupe、active memories との比較、memory row 作成、decision row 追加を行う
7. `PersonaFlowChatTurnService` は下位の出力形式を知らずにその parsed result を消費する。完全な順序付き turn event 一式が assistant turn と一緒に永続化される
8. assistant turn は会話の self actor として chat store に追加され、timeline message と structured turn events の両方が `appendAssistantTurn()` で書き込まれる

`single_character_chat` の streaming 経路は structured output に移行済みです。`/v1/chat/stream` は `response_format: json_schema` のもとで provider に JSON テキストチャネルを token 単位で流させます。`createSubmitTurnEventsPreviewParser` がその JSON を増分 parse し、`chunk`（`replyText.text` をデコードした文字列）と `turnEventPreview` SSE イベントを発行します。最終 `done` イベントには canonical な `turnEvents` が含まれます。

Memory candidate collection は streaming preview に影響しません。streamed text と `turnEventPreview` は structured-output JSON text channel だけから生成されます。memory candidates は model stream 完了後の最終 parsed structured output からのみ消費されます。

Memory write path は現在 write side のみを実装しています。structured output は `memoryWriteCandidates` を含めることができ、server は candidate を記録し、embedding を生成し、active memories を similarity で scan し、candidate / memory / decision rows を書き込みます。Candidates、active memories、decisions 用の read-only debug API は利用可能です。Active memories はまだ prompt context に read-back されないため、完全な RAG loop ではありません。詳細な boundary、ports、decision policy、pending work は [Project Map - Memory 子系统](project-map-memory.zh-CN.md) にあります。

interaction mode は `@ss-ai/contracts` に共有定義されており、全体アーキテクチャとしても将来的に複数 mode を支える前提で設計されています。実行時に実際に登録されているのは現在 `single_character_chat` だけです。他の mode も contracts と UI には将来計画のプレースホルダーとして存在しますが、prompt と model-call dispatch にはまだ接続されていません。

### `packages/contracts`

フロントエンドとバックエンドで共有する contract パッケージです。

責務:

- `ApiDefine` による HTTP API 定義
- `src/apis/*.api.ts` による API request / response type 定義
- `INTERACTION_MODES`、`DEFAULT_INTERACTION_MODE`、`InteractionMode`
- `MODEL_CALL_PURPOSES`、`ModelCallPurpose`、モデル割り当て関連の型
- `TurnEvent`、`SubmitTurnEventsArgs`、`MessageKind`、およびモデルが返した turn event を検証する Zod schema
- `MemoryWriteCandidate`、memory scope/type literal、およびモデルが返した memory write candidates を検証する Zod schema

model-call 設定では `MODEL_CALL_PURPOSES` / `ModelCallPurpose` と `ModelAssignment` / `ModelAssignmentMap` を使います。

Turn event の純粋な型とリテラル定数は `packages/contracts/src/turnEvents.ts` にあります。ランタイム用 Zod schema は `packages/contracts/src/turnEvents.schema.ts` にあり、`@ss-ai/contracts/turnEvents.schema` サブエントリとして公開されています。これにより web 側は Zod をメインバンドルへ取り込まずに純粋な contracts だけを import できます。新しい event type を追加するときは contracts から始めて、ランタイム schema 検証、storage、prompt history assembly、UI 表示へと広げていきます。

Memory candidate の純粋な型は `packages/contracts/src/memoryCandidates.ts` にあります。ランタイム用 Zod schema は `packages/contracts/src/memoryCandidates.schema.ts` にあり、`@ss-ai/contracts/memoryCandidates.schema` サブエントリとして公開されています。`SubmitTurnEventsArgs` は top-level `memoryWriteCandidates` を含められます。現在の chat-turn wiring はそれらを記録し、設定に応じて即時 commit し、candidates、active memories、decisions 用の read-only debug API を公開します。

### `packages/persona-flow-sqlite`

`AppStores` の SQLite 実装です。

責務:

- Drizzle で `better-sqlite3` データベースを開く
- `src/db/schema.ts` で schema を定義する
- characters、conversations、actors、messages、user profiles、preferences、provider credentials、memory candidates、active memories、memory decisions などの具体 store を実装する
- `createSqliteStores()` で完全に配線済みの `AppStores` を生成する

重要なテーブル:

- `characters`
- `conversations`
- `conversation_actors`
- `messages`
- `turn_events`
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`
- `memory_candidates`
- `memories`
- `memory_decisions`

`user_preferences.model_assignments_json` は model-call purpose から `{ provider, model }` へのマップを保存します。

`messages` は会話 timeline テーブルで、`kind`、`display_text`、sender actor、conversation id、timestamp を保存します。structured event を伴う assistant turn は `kind = "assistant_turn_events"` で保存されます。

`turn_events` はモデルが発した順序付き event payload を保存します。歴史的には `submit_turn_events` と呼んでいたものですが、現在は structured JSON output として生成されます。各行は 1 つの assistant message に属し、`seq`、`type`、JSON payload、schema version、timestamp を保持します。`SQLiteChatStore.appendAssistantTurn()` は message とその turn events をまとめて書き込み、recent-message 読み出しでは assistant message に `turnEvents` を再構築します。

### `packages/persona-flow-model-client`

モデル provider 統合パッケージです。

責務:

- `persona-flow` の `ModelClient` interface を実装する
- `DefaultModelClient` が provider ごとに分配する
- 現在の具体 provider は `MistralModelClient` 経由の Mistral
- 非 structured 生成、structured 生成（`response_format: json_schema`。非 streaming / streaming の両方）、tool call、モデル一覧取得、そして text channel 上での structured-output streaming をサポートする。structured streaming では preview 用に raw JSON text を蓄積し、最終 parse 済みオブジェクトを `ModelStreamResult.structuredOutput` として公開する
- `src/mistral/mistralToolAdapter.ts` で provider-neutral `ModelToolDefinition` を Mistral function tools に変換する。これは将来の query 系 tool-call 用に残している

provider 一覧と API URL は runtime config から来ます。API key は user ごと / provider ごとに credential store に保存されます。SQLite 側は現在 no-op の encrypt/decrypt helper を通すだけなので、本物の暗号化が入るまでは平文のまま保存されます。

### `packages/persona-flow-logger`

server と bot runtime で使う小さなファイル logger です。

責務:

- ログレベル: `verbose`、`debug`、`info`、`warn`、`error`
- ソース位置と stack trace の任意出力
- グローバル logger helper

## Apps

### `apps/server`

Express HTTP サーバーです。

責務:

- `apps/server/config/config.default.json`、任意の `apps/server/config/config.{APP_ENV}.json`、任意の `apps/server/config/config.local.json` を読み込む
- `runtimeFiles.userDataDir/app.db` 配下の SQLite DB を開く
- `createSqliteStores` で `AppStores` を生成する
- chat、user preferences、profiles、characters、conversations、conversation actors 用の HTTP route を登録する
- 各 chat request ごとに stores、logger、prompt logger、`DefaultModelClient` を注入した `PersonaFlowChatTurnService` を作る

重要な挙動:

- 現状このアプリは実質 single-user に近く、選択された chat path を除けば API は `DEFAULT_USER_ID = "default"` を使う
- auth は `config.auth.mode` を通じて `default-user` と `local-password` の 2 モードをサポートする
- `default-user` は実際の sign-in をスキップし、すべての request を設定済み default user と見なす
- `local-password` は小さな username/password + session-cookie auth フローを有効にする
- `/v1/chat` は内部で `response_format: json_schema` structured output を使い、統一された `output + turnEvents` chat contract を返す
- `/v1/chat/stream` は SSE のレスポンス形状を保ったまま、structured-output JSON text channel を provider が流すのに合わせて `chunk` / `turnEventPreview` を token 単位で送る。最終 `done` event には `turnEvents` が入る
- `/v1/chat/dry-run` は prompt messages を組み立てるだけで、LLM 呼び出しや永続化はしない
- prompt log は `promptLog` 設定で制御される

### `apps/web`

Vue 3 + Vite フロントエンドです。

責務:

- 左に workspace sidebar、中央に chat panel、右に context inspector と settings panel を持つ 3 ペイン UI
- `@ss-ai/contracts` の API type と定数を使う
- provider API key と model assignment をユーザーが設定できる
- chat request、stream request、dry-run request、message delete request を送る
- `TurnEvent[]` から assistant 出力を描画する。`replyText` は text segment に、`expression` と `sceneAtmosphere` は inline marker chip になり、完全な `turnEvents` payload は debug block でも見られる

重要な UI 状態:

- `src/shared/state/appState.ts` の `contextVersion` が、character または conversation context 変更時に chat history reload を発火する
- active な character、conversation、actor の状態は panel view-model module 群にある
- chat は non-streaming / streaming の両 UI モードで動作する。両パスとも `turnEvents` があればそれから表示を導出する。streaming では structured-output JSON preview parser 由来の token-level `chunk` を受け取り、小さな render queue で text を段階表示し、到着した `turnEventPreview` marker を inline 適用し、最後に `done.turnEvents` から構築した canonical `displaySegments` に snap する

現在の設定挙動:

- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts` が purpose ごとの `modelAssignments` を読み書きする
- API endpoint は `/v1/user-preference/model-assignment`

### `apps/prompt-debug-cli`

prompt 実験用 CLI です。

責務:

- YAML の prompt-debug config を読む
- Handlebars prompt template を render する
- render-only モードと、設定済みモデルを実際に呼ぶモードを持つ
- 最終的に組み上がった messages を出力できる

例:

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only
```

### `apps/qq-bot`

QQ bot 統合です。

責務:

- QQ の private / group message を受け取る
- server 側 conversation を解決または作成する
- server chat API を呼び、server 出力に応じて返信するかスキップするかを決める

動作には HTTP server が起動済みで、設定も済んでいる必要があります。

## Runtime Config

config 読み込みは `apps/server/src/util/config.ts` に実装されています。

読み込み順:

1. `apps/server/config/config.default.json`
2. `APP_ENV` が設定され、対応ファイルが存在する場合は `apps/server/config/config.{APP_ENV}.json`
3. 存在すれば `apps/server/config/config.local.json`

マージ後の config は `apps/server/schemas/config.schema.json` で検証されます。

config file は source mode では `apps/server/config`、deploy 版では `server/config` から必ず読みます。`logger.logFilePath`、`runtimeFiles.tempDir`、`runtimeFiles.userDataDir`、`promptLog.filePath` のような相対 runtime path は、デフォルトでは現在の作業ディレクトリから解決されます。上書きしたい場合は `RUNTIME_HOME` を設定してください。

`apps/server/config/config.local.json` はマシンローカルの override 用で、commit しません。`apps/server/config/config.local.json.example` はローカル開発時にコピーするテンプレートです。

現在の Lightsail deploy フローでは、`config.local.json` は release archive に最初から含まれている必要はありません。release activation 中にサーバーで生成され、最優先の runtime override として使われます。

commit 済みの environment overlay は現在 `apps/server/config/config.staging.json` と `apps/server/config/config.prod.json` にあります。

`apps/qq-bot` はデフォルトで `apps/qq-bot/.env` から bot 環境変数を読み込みます。`pnpm run dev:qq-bot` を repo root から起動した場合、ランタイム出力も repo root の `.runtime/` に置かれます。

重要なセクション:

- `http`: host と port
- `logger`: file path、level、source / stack option
- `runtimeFiles`: temp directory と user data directory
- `agent`: model client の timeout と retry 設定
- `promptLog`: prompt logging の有効化と出力 path
- `models`: provider 設定、API URL、任意の default API key、default model、任意の静的 `availableModels`
- `defaultModelAssignments`: `ModelCallPurpose` ごとの fallback provider / model mapping
- `auth`: auth mode、default user id、registration 可否、session lifetime、cookie 設定

デフォルト config には provider key `mistral.ai` と、それに対応する Mistral API URL、および静的 model list が入っています。

## Data And Actor Model

conversation は単なる user / assistant transcript ではなく、明示的な actor を持ちます。

- `self`: 会話内で返信する AI キャラクター
- `other`: ログイン中 user または local actor
- `system`: 予約済みの system actor role

messages は `senderActorId`、`conversationId`、`kind`、`displayText`、任意の `turnEvents`、timestamp を持ちます。prompt render 時には actor が LLM role へ次のように変換されます。

- `self` -> `assistant`
- `system` -> `system`
- それ以外 -> `user`

`packages/persona-flow/src/prompt/speakerTag.ts` には共有の speaker-tag helper があり、よりリッチな interaction mode に備えています。現在の `single_character_chat` prompt path は LLM へ送る message に speaker tag を付けません。assistant history に `turnEvents` がある場合、現状 prompt history に再利用されるのは `replyText` event だけです。expression や scene atmosphere のような非テキスト event は永続化されますが、将来の prompt / state 設計までは prompt history へ注入されません。出力正規化時には assistant 風の name prefix を取り除き、返信中でラベルが重複しないようにしています。

## Model Assignment

model assignment は purpose ベースです。共有識別子は `packages/contracts/src/modelCallPurpose.ts` にあります。

現在の purpose:

- `chat.main`
- `memory.summarize`

chat path は現在 `modelCallPurpose: "chat.main"` でモデルを呼びます。

解決順は user 優先、config fallback です。

1. user model assignment
2. `defaultModelAssignments[modelCallPurpose]`
3. error

API key の解決も user 優先です。

1. user provider credential
2. `models[provider].apiKey`
3. error

呼び出しを成功させるには、現在の user が以下を満たす必要があります。

1. 要求された purpose に対する model assignment を user preferences に持つか、対応する `defaultModelAssignments` が存在する
2. その assignment の provider に対する user credential を持つか、runtime config に default API key がある
3. その provider の runtime config が存在する

## Key Files

挙動を review したり変更したりするときは、まず次のファイルから見始めるのがよいです。

- `packages/contracts/src/modelCallPurpose.ts`
- `packages/contracts/src/interactionMode.ts`
- `packages/contracts/src/turnEvents.ts`
- `packages/contracts/src/turnEvents.schema.ts`
- `packages/contracts/src/apis/*.api.ts`
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/persona-flow/src/chatTurn/chatTurnPreparation.ts`
- `packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts`
- `packages/persona-flow/src/chatTurn/events/turnEventText.ts`
- `packages/persona-flow/src/llm/tools/modelTool.ts`
- `packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts`
- `packages/persona-flow/src/modelCall/modelRuntime.ts`
- `packages/persona-flow/src/modelCall/modelCallRegistry.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/promptViewModel.ts`
- `packages/persona-flow/src/stores/appStores.ts`
- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts`
- `packages/persona-flow-sqlite/src/db/CharacterDbRouter.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`
- `packages/persona-flow-model-client/src/defaultModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts`
- `apps/server/src/http/apis/chat/*.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`
- `apps/web/src/panels/chat/turnEventDisplay.ts`
- `apps/web/src/panels/chat/chatTypes.ts`
- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts`

## Current Maintenance Notes

- `AI_FUNCTIONS` / `AiFunction` から `MODEL_CALL_PURPOSES` / `ModelCallPurpose` への rename は contracts、web、server、store 全体で完了している
- SQLite の model assignment column は `model_assignments_json`。旧 model-assignment storage 互換は削除済み
- single-character chat の model output path は現在、可視 turn events と任意の `memoryWriteCandidates` のために `response_format: json_schema` structured output を使う（event schema の source は依然 `submitTurnEventsTool.argsSchema`）。この path では memory candidate tool は登録しない
- Chat-turn memory write は durable になっている。Candidates は structured output から parse され、assistant turn 永続化後に記録され、runtime memory config に応じて `MemoryCommitService` により即時 commit される
- Memory pipeline は candidate recording、embedding-port driven commit service、text normalization、cosine similarity ranking、conservative decision policy、SQLite-backed `memory_candidates` / `memories` / `memory_decisions` stores、chat-turn integration を含む
- Memory write path TODO: `createMemory + candidate status + decision` を transaction-safe にし、その後 debug events と prompt memory read-back を追加する
- similarity thresholds に依存する前の TODO: より多くの実 `mistral-embed` samples を収集する。現在の probe は 1024-dimensional vectors を返し、短い中国語 user facts は baseline cosine similarity が高めになり得ることを示した
- chat-turn / model-call のレイヤ境界は意図的に分離している。chat service は model-call の `parsedOutput` を消費し、各 model call が provider response（structured output または tool argument）の parse を自分で担当する。これにより、将来別の interaction mode が別の出力形式を使っても chat-turn persistence code を変えなくてよい
- `messages` は現在 timeline / display table であり、structured assistant fact は `turn_events` に保存される
- prompt history は現在 assistant turn から `replyText` event だけを再利用する。TODO: expression や scene atmosphere のような最新非テキスト状態も、prompt format と UI needs が固まったら選択的に含める
- SQLite credential store には API key 暗号化 hook があるが、現状は入力をそのまま返す
- 低優先度 TODO: deploy と key-management の前提が固まったら、現在の no-op API key encrypt/decrypt を実際の保存時保護へ置き換える
- `single_character_chat` streaming は provider の structured-output JSON text channel から token ごとに流れる。SSE `chunk` event は増分 JSON preview parser が `replyText.text` を抽出して作る
- web chat UI は canonical `TurnEvent[]` を `displaySegments` として描画する。stream 中の text / inline marker preview はあくまで speculative で、最終 `done.turnEvents` で置き換えられる
- `single_character_chat` 以外の interaction mode は宣言されているが、runtime model-call dispatch にはまだ登録されていない
- speaker-tag helper と、より豊かな multi-actor prompt shaping は後続の interaction mode 用に温存してあり、現在の `single_character_chat` path は意図的にシンプルにしている
- TODO: web component の i18n access は現状 module-level helper に依存している。SSR、app ごとの i18n instance、より厳密な test isolation が必要になったら `useI18n` 風の hook / provider へ移行する

## Quick Smoke Paths

便利な確認コマンド:

```bash
pnpm run build
pnpm run test
pnpm run dev:server
pnpm run dev:web
```

HTTP health check:

```bash
curl http://127.0.0.1:8999/health
```

モデル挙動を調べる前に、まず dry-run で prompt assembly を確認できます。

```bash
curl -X POST http://127.0.0.1:8999/v1/chat/dry-run \
  -H "Content-Type: application/json" \
  -d '{"characterId":"<character-id>","conversationId":"<conversation-id>","userMessageText":"hello"}'
```
