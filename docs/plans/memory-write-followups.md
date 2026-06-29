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

## Batch 3.5: Candidate / Staging Memory / Retained Memory Layering

Detailed design draft: [memory-layered-refactor.zh-CN.md](memory-layered-refactor.zh-CN.md).

Batch 3.5 should refactor the memory write path before adding LLM judge. The new direction is to split the current candidate-to-active-memory pipeline into three layers:

- `memory_candidates`: raw candidate intake from chat, summarize, tools, or future manual sources.
- `staging_memories`: processed, embedded, lightly de-duplicated intermediate memory fragments.
- retained memories: stable, consolidated memories suitable for prompt injection.

High-level direction:

- Keep candidate intake simple: write pending rows and preserve source metadata.
- Move normalization, embedding, rule-based filtering, and lightweight duplicate handling into a candidate-to-staging-memory processor.
- Let the processor pull pending candidates from storage by default so inline, manual, and future scheduled processing share the same path.
- Stop writing retained memories directly from candidate processing.
- Add staging-memory storage and debug listing.
- Do not implement staging-to-retained processing or LLM judge in this batch.

## Batch 4: Staging-to-Retained LLM Consolidation Judge

The previous candidate-level LLM judge plan is superseded by Batch 3.5's layered memory design. The old draft remains as historical reference: [memory-write-batch4-llm-judge.zh-CN.md](memory-write-batch4-llm-judge.zh-CN.md).

Batch 4 should be rewritten after Batch 3.5 is implemented and real staging-memory data has been observed.

High-level direction:

- Pull unprocessed staging memories.
- Retrieve related retained memories.
- Let an LLM consolidation judge recommend create, update, merge, ignore, archive, or importance changes.
- Keep the system layer authoritative; the judge recommends, the consolidation service applies.
- Mark processed staging memories so they are not repeatedly considered.

## Batch 5: Memory Read Injection

Batch 5 closes the loop by reading active memories into prompts.

High-level direction:

- Add retrieval by user, character, conversation, relationship, and world scope.
- Keep prompt injection compact and explicitly separated from recent chat history.
- Log which memories were read and injected.
- Evaluate whether memories improve character consistency without drowning current context.