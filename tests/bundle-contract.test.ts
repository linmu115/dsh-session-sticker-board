import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageJson {
  version: string;
  exports: Record<string, unknown>;
  peerDependencies: Record<string, string>;
  dshKnowledge: { annotationProtocolVersion: number; stickerProtocolVersion: number };
}

async function text(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), "utf8");
}

describe("sticker-board 0.2 package boundary", () => {
  it("declares the shared Core and typert release contract", async () => {
    const packageJson = JSON.parse(await text("package.json")) as PackageJson;
    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson.peerDependencies["dsh-annotation-core"]).toBe(">=0.1.0 <0.2.0");
    expect(packageJson.exports).toHaveProperty("./typert");
    expect(packageJson.dshKnowledge).toEqual({ annotationProtocolVersion: 2, stickerProtocolVersion: 1 });
  });

  it("contains no old citation composer surface", async () => {
    const source = [
      await text("src/client/index.tsx"),
      await text("src/client/styles.css"),
      await text("src/context-types.ts"),
      await text("src/index.ts"),
    ].join("\n");
    for (const forbidden of [
      "<obsidian-citations>",
      "dsh-sticker-board-hidden",
      "dsh-sticker-board-citation-dock",
      "dsh-sticker-board-citation-card",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('export const inject = [] as const');
    expect(source).toContain('export const inject = ["sessions", "remote"] as const');
  });

  it("inlines only the Core protocol and leaves no runtime Core package import", async () => {
    const host = await text("lib/index.js");
    const client = await text("lib/client.js");
    const bundle = `${host}\n${client}`;
    expect(bundle).not.toMatch(/(?:from\s+|require\()["']dsh-annotation-core(?:\/[^"']*)?["']/);
    for (const forbidden of [
      "AnnotationStore",
      "AnnotationCoreRemoteService",
      "AnnotationSubmissionCoordinator",
      "HostSourceRegistry",
      "ReferenceDialog",
      "dsh_annotation_core_v1",
    ]) {
      expect(bundle).not.toContain(forbidden);
    }
    expect(bundle).toContain("reference-capture");
  });
});
