# Memory Write Follow-up Roadmap

[English](memory-write-followups.md)

This document tracks the rough plan after the log-only memory write batch in [memory-write-implementation.md](memory-write-implementation.md).

Keep this file high level until each batch is ready to implement. The concrete design for a later batch should be expanded when work on that batch starts, after reviewing the data and behavior collected by the previous batch.

## Batch 2/3: Independent Memory Module And SQLite Embedding Commit Prototype

Batch 2 and Batch 3 are merged because candidate storage and early commit logic share the same persistence, debug, and decision boundaries.

Detailed implementation plan: [memory-write-batch2.zh-CN.md](memory-write-batch2.zh-CN.md).

High-level direction:

- Put core memory code under `packages/persona-flow/src/memory/**` as a future package boundary.
- Keep memory core independent from chat turn, model call, server, and SQLite implementation details.
- Define injected ports for candidate storage, active memory storage, decision storage, embedding generation, time, ids, and logging.
- Store candidates, active memories, decisions, and embedding metadata in SQLite.
- Save embeddings in SQLite columns and perform brute-force cosine similarity in application code while the data set is small.
- Automatically create only low-risk new memories; route similar, ambiguous, or conflict-prone candidates to `needs_judge`.
- Keep similarity thresholds, scan limits, immediate commit behavior, and embedding provider/model configurable at the backend layer first.
- Emit verbose structured debug logs for each candidate decision so the future frontend debug window can display the full reasoning trace.
- Add debug APIs for candidates, active memories, and decisions.
- Keep chat responses fail-soft if candidate storage, embedding, or commit fails.

Do not attempt complex merge, correction, conflict handling, archive behavior, or prompt injection in this batch.

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