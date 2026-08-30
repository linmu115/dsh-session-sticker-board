import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

interface PackageJson {
  version: string;
  exports: Record<string, unknown>;
  peerDependencies: Record<string, string>;
  dshKnowledge: { annotationProtocolVersion: number; stickerProtocolVersion: number };
  dshWorkshop: { compatibility?: unknown };
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function text(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), "utf8");
}

describe("sticker-board 0.4 package boundary", () => {
  it("declares version-open shared Core and host peers", async () => {
    const packageJson = JSON.parse(await text("package.json")) as PackageJson;
    expect(packageJson.version).toBe("0.4.18");
    expect(new Set(Object.values(packageJson.peerDependencies))).toEqual(new Set(["*"]));
    expect(packageJson.peerDependencies["dsh-annotation-core"]).toBe("*");
    expect(packageJson.dshWorkshop.compatibility).toBeUndefined();
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
      "[data-dsh-toggle-cluster]",
      "data-dsh-sidebar-collapsed",
      "panelToggle.click",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('export const inject = [] as const');
    expect(source).toContain('export const inject = ["sessions", "remote", "uiConversation"] as const');
  });

  it("uses a native shared-toolbar action for Web Viewer selections", async () => {
    const source = await text("src/client/overlay.tsx");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain('[data-dsh-sidechat] [role="toolbar"]');
    expect(source).not.toContain("if (!selection || editor || menu || !sharedSelectionToolbar)");
    expect(source).toContain("mountNativeSelectionAction");
    expect(source).toContain("resolveSelectionForStickerAction");
    expect(source).toContain("sharedSelectionToolbar.appendChild(button)");
  });

  it("reads alpha.1 Chat nodes from the Conversation target without visible diagnostics", async () => {
    const index = await text("src/client/index.tsx");
    const deepLink = await text("src/client/deep-link.ts");
    expect(index).toContain('uiConversation.binding(sessionId).target("chat")');
    expect(deepLink).toContain('uiConversation.binding(action.sessionId).target("chat")');
    expect(`${index}\n${deepLink}`).not.toContain("snapshot.chat.nodes");
    expect(index).not.toContain("dshStickerDiagnostic");
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
