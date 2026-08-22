import { describe, expect, it, vi } from "vitest";

import {
  CITATION_REFERENCE_APPEARANCE,
  createCitationReferenceSource,
  createPendingCitationStore,
  createSubmissionResolver,
  referenceForSession,
  syncSessionReference,
  withoutCitationReferences,
} from "../src/client/composer.tsx";
import type { PendingCitation, ResolvedCitation } from "../src/protocol.ts";

function citation(citationId: string, text: string): PendingCitation {
  return {
    protocolVersion: 1,
    type: "pending-citation",
    citationId,
    notePath: "架构/DSH维护引擎.md",
    blockId: "generation-definition",
    heading: "Generation",
    text,
    contentHash: "sha256:note",
  };
}

const first = citation("76213b70-7f6e-41be-b2e3-1b195cbf1268", "Generation 保存完整组合。 ");
const second = citation("95956074-a1fb-4eb0-ad0b-a6bd22c039fa", "插件版本独立维护。 ");

function snapshot(entries: Array<{ key: string; seq: number; text: string }>) {
  const byKey = new Map(entries.map((entry) => [entry.key, {
    key: entry.key,
    kind: "user",
    data: { seq: entry.seq, content: [{ type: "text", text: entry.text }] },
  }]));
  return {
    chat: {
      order: entries.map((entry) => entry.key),
      nodes: { get: (key: string) => byKey.get(key) },
    },
  };
}

describe("Obsidian citation composer integration", () => {
  it("keeps one invisible native reference and removes its complete draft range", () => {
    const store = createPendingCitationStore();
    store.add("session-demo", first);
    const snapshot = {
      draft: "问题",
      draftRev: 7,
      phase: "plain",
      occurrences: [],
    };
    const input = {
      state: { getSnapshot: () => snapshot, subscribe: () => () => undefined },
      insertReference: vi.fn(() => true),
      setDraft: vi.fn(),
    };
    const ctx = {
      sessions: { scope: () => ({}) },
      get: () => ({ input: { for: () => input } }),
    };

    expect(syncSessionReference(ctx as never, store, "session-demo")).toBe("inserted");
    expect(input.insertReference).toHaveBeenCalledWith(expect.objectContaining({
      appearance: CITATION_REFERENCE_APPEARANCE,
      label: "",
    }), { start: 0, end: 0, draftRev: 7 });

    const next = withoutCitationReferences({
      ...snapshot,
      draft: "@ 问题",
      occurrences: [{
        occurrenceId: 1,
        source: "dsh-session-sticker-board-citations",
        ref: `${referenceForSession("session-demo")}|1`,
        offset: 0,
        length: 1,
        label: "",
        clipboardText: "引用",
      }],
    }, "session-demo");
    expect(next).toBe("问题");
  });

  it("retains the emptied session long enough to remove stale model context", () => {
    const store = createPendingCitationStore();
    store.add("session-demo", first);
    store.remove("session-demo", first.citationId);

    expect(store.sessions()).toContain("session-demo");
    expect(store.list("session-demo")).toEqual([]);
  });

  it("reflows citation card numbers and serializes hidden model context", async () => {
    const store = createPendingCitationStore();
    store.add("session-demo", first);
    store.add("session-demo", second);
    store.remove("session-demo", first.citationId);

    expect(store.list("session-demo").map((item) => [item.citation.citationId, item.displayNumber])).toEqual([
      [second.citationId, 1],
    ]);
    const source = createCitationReferenceSource(store);
    const serialized = await source.codec.serialize(referenceForSession("session-demo"));
    expect(serialized).toContain("来源：架构/DSH维护引擎.md#^generation-definition");
    expect(serialized).toContain(second.text.trim());
    expect(serialized).not.toContain(first.text.trim());
  });

  it("binds sent citations to the first real new user node exactly once", async () => {
    const store = createPendingCitationStore();
    store.add("session-demo", first);
    store.add("session-demo", second);
    const resolveCitation = vi.fn<(citation: ResolvedCitation) => Promise<{ notePath: string; blockId: string }>>(
      async () => ({ notePath: "note.md", blockId: "dsh-ref-a17" }),
    );
    const resolver = createSubmissionResolver({ store, resolveCitation });
    const baseline = snapshot([{ key: "message:user-1", seq: 1, text: "旧问题" }]);
    const afterSend = snapshot([
      { key: "message:user-1", seq: 1, text: "旧问题" },
      { key: "message:user-2", seq: 9, text: "请解释 generation" },
    ]);

    resolver.begin("session-demo", baseline);
    expect(await resolver.observe("session-demo", baseline)).toBe(false);
    expect(await resolver.observe("session-demo", afterSend)).toBe(true);
    expect(await resolver.observe("session-demo", afterSend)).toBe(false);

    expect(resolveCitation).toHaveBeenCalledTimes(2);
    expect(resolveCitation.mock.calls[0]?.[0]).toMatchObject({
      citationId: first.citationId,
      sessionId: "session-demo",
      anchorId: "message:user-2",
      role: "user",
    });
    expect(store.list("session-demo")).toEqual([]);
  });
});
