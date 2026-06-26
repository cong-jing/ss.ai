# Memory Write Follow-up Roadmap

[English](memory-write-followups.md)

This document tracks the rough plan after the log-only memory write batch in [memory-write-implementation.md](memory-write-implementation.md).

Keep this file high level until each batch is ready to implement. The concrete design for a later batch should be expanded when work on that batch starts, after reviewing the data and behavior collected by the previous batch.

## Batch 2: Candidate Storage

Batch 2 can replace or supplement logs with SQLite candidate storage.

High-level direction:

- Add memory candidate and decision tables.
- Store raw candidate text, scope, type, tags, related entities, source ids, request id, status, and timestamps.
- Keep status as `logged_only` or `pending` until commit logic exists.
- Add a small debug API for reading candidates by user, character, conversation, or message id.
- Keep the chat response fail-soft if candidate storage fails.

Details should be written when batch 2 starts, after evaluating batch 1 logs.

## Batch 3: Simple Commit Service

Batch 3 can create real active memories without an LLM judge.

High-level direction:

- Add a `memories` table and store interface.
- Implement rule-based low-value filtering.
- Implement obvious duplicate avoidance by normalized text within the same user/scope/type area.
- Create new active memories for non-duplicates.
- Record every decision as `create`, `ignore_duplicate`, `ignore_low_value`, or `error`.

Do not attempt complex merge, correction, conflict handling, or archive behavior in this batch unless batch 2 data shows it is necessary.

## Batch 4: LLM Judge

Batch 4 can introduce a dedicated memory judge model call.

High-level direction:

- Use `memory.summarize` initially if avoiding new config, or add a clearer purpose such as `memory.judge`.
- Pass the candidate, source turn summary, and nearby existing memories.
- Let the judge return a conservative decision.
- Keep the system decision layer authoritative; the judge recommends, the commit service applies.

## Batch 5: Memory Read Injection

Batch 5 closes the loop by reading active memories into prompts.

High-level direction:

- Add retrieval by user, character, conversation, relationship, and world scope.
- Keep prompt injection compact and explicitly separated from recent chat history.
- Log which memories were read and injected.
- Evaluate whether memories improve character consistency without drowning current context.