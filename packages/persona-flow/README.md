# @ss-ai/persona-flow

Package-local note for the current prompt path.

For the overall project map, runtime behavior, and cross-package notes, start with the repo root [`README.md`](../../README.md).

## Current Entry Points

- `src/chatTurn/chatTurnService.ts`
- `src/chatTurn/chatTurnPreparation.ts`
- `src/modelCall/modelRuntime.ts`
- `src/modelCall/modelCallRegistry.ts`
- `src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `src/modelCall/chat.main/singleCharacterChat/promptViewModel.ts`
- `src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs`

## Current Status

- The active runtime path is `chat.main:single_character_chat`.
- True `single_character_chat` streaming is not finished yet; the app-layer SSE route currently falls back to one full reply chunk.
- Speaker-tag helpers exist in `src/prompt/speakerTag.ts`, but the current `single_character_chat` prompt path does not inject speaker tags into outgoing LLM messages.

## Package TODO

- Add true `single_character_chat` streaming.
- Register and implement additional interaction modes beyond `single_character_chat`.
- Decide when and how speaker tags and richer multi-actor context should enter prompt assembly.
