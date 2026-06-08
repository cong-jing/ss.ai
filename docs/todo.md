# TODO

## Higher priority follow-ups

- Character-level `modelConfig` is stored and editable, but chat model selection still does not consume it. Decide whether to implement that priority chain or hide the field until it becomes real.
- Richer streaming UX for `single_character_chat`: sync character avatar expression to `expression` events, sync scene background/overlay to `sceneAtmosphere` events, and add a side debug panel that renders the live `turnEvents` stream as it arrives (currently inline marker chips in the bubble + post-stream debug block are the only surfaces).

## Lower priority follow-ups

- API key at-rest protection is still a no-op encrypt/decrypt layer. Revisit once deployment and key-management expectations are stable.
- Prompt log tool-call output is still hard to read when arguments are logged as one-line strings. Reformat tool-call arguments into a more readable structured block when revisiting prompt-log UX.
- `PromptLogger` and `DefaultModelClient` are still created per chat request by design for now. The SDK client promise is intentionally not reused across requests. Current prompt logs append to one file rather than recreating files, so this is a maintainability/perf note, not an active correctness bug.
