import { describe, expect, it } from "vitest";

import {
  createMessageAnchor,
  dataChatAnchorKey,
  resolveMessageAnchor,
} from "../src/client/anchor.ts";

describe("stable DSH message anchors", () => {
  it("restores the selected occurrence after a message rerender", async () => {
    const anchor = await createMessageAnchor({
      sessionId: "session-demo",
      nodeId: "user-node-42",
      seq: 42,
      role: "user",
      quote: "版本边界",
      occurrence: 1,
    });
    const candidate = {
      nodeId: "user-node-42",
      seq: 42,
      role: "user" as const,
      text: "版本边界需要清楚，最终仍回到版本边界。",
    };

    const result = await resolveMessageAnchor(anchor, [candidate]);

    expect(result).toEqual({
      status: "resolved",
      candidate,
      range: { start: 14, end: 18 },
    });
    expect(dataChatAnchorKey(anchor)).toBe("session-demo:user-node-42:user");
  });

  it("falls back to seq and reports changed or missing quote content", async () => {
    const anchor = await createMessageAnchor({
      sessionId: "session-demo",
      seq: 7,
      role: "assistant",
      quote: "稳定组合",
      occurrence: 0,
    });
    const changed = await resolveMessageAnchor(anchor, [{ seq: 7, role: "assistant", text: "内容已经变化" }]);
    const missing = await resolveMessageAnchor(anchor, [{ seq: 8, role: "assistant", text: "稳定组合" }]);

    expect(changed).toEqual({ status: "content-changed" });
    expect(missing).toEqual({ status: "orphaned" });
  });
});
