import { readFile, readdir } from "node:fs/promises";
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

describe("sticker-board 0.6 package boundary", () => {
  it("keeps a standalone single-node patch and declares all ordinary Sticker feature peers", async () => {
    const patch = await text("cordis.patch.yml");
    expect(patch.match(/name:\s*'dsh-session-sticker-board'/g)).toHaveLength(1);
    expect(patch).not.toMatch(/name:\s*['"]?dsh-obsidian|inject:/);
    expect(patch).toContain("bridgeOrigin: 'http://127.0.0.1:18473'");
    const pkg = JSON.parse(await text("package.json"));
    for (const name of ['dsh-obsidian-bridge', 'dsh-annotation-core']) {
      expect(pkg.peerDependencies[name]).toBeTruthy();
      expect(pkg.peerDependenciesMeta[name]?.optional).not.toBe(true);
    }
    expect(pkg.peerDependencies).not.toHaveProperty('dsh-session-maintenance');
    expect(pkg.peerDependenciesMeta['dsh-better-sidebar'].optional).toBe(true);
    expect(pkg.devDependencies['dsh-obsidian-bridge']).toBe('link:../dsh-obsidian-bridge-lifecycle');
  });
  it("emits declarations without retired Bridge or standalone Protocol imports", async () => {
    const files = await readdir(join(repositoryRoot, 'lib/types'), { recursive: true });
    expect(files.some(file => file.endsWith('.d.ts'))).toBe(true);
    for (const file of files.filter(file => file.endsWith('.d.ts'))) {
      expect(await text(`lib/types/${file}`)).not.toMatch(/["']dsh-obsidian-bridge-(?:lifecycle|protocol)(?:\/[^"']*)?["']/);
    }
  });
  it("declares version-open shared Core and host peers", async () => {
    const packageJson = JSON.parse(await text("package.json")) as PackageJson;
    expect(packageJson.version).toBe("0.7.4-rc2.7");
    expect(packageJson.peerDependencies["@deepseek-ai/dsh-typert-protocol"]).toBe("^0.1.5-rc.2");
    expect(packageJson.peerDependencies["dsh-annotation-core"]).toBe("0.3.12-rc2.22");
    expect(packageJson.peerDependencies["dsh-obsidian-bridge"]).toBe("0.4.1-rc2.8");
    expect(packageJson.peerDependencies).not.toHaveProperty("dsh-obsidian-bridge-lifecycle");
    expect(packageJson.peerDependencies).not.toHaveProperty("dsh-obsidian-bridge-protocol");
    expect(packageJson.dshWorkshop.compatibility).toBeUndefined();
    expect(packageJson.exports).toHaveProperty("./typert");
    expect(packageJson.dshKnowledge).toEqual({
      annotationProtocolVersion: 2,
      stickerProtocolVersion: 1,
      bridgeLifecycleProtocolVersion: 3,
    });
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
    expect(source).toContain("export const inject = ['annotationCoreHost', 'obsidianBridgeLifecycle'] as const");
    expect(source).toContain('export const inject = ["sessions", "remote", "uiConversation", "annotationCore", "obsidianBridgeLifecycle"] as const');
    expect(source).not.toContain('registerSourceAdapter("obsidian-note"');
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
    expect(deepLink).toContain('uiConversation.binding(sessionId).target("chat")');
    expect(`${index}\n${deepLink}`).not.toContain("snapshot.chat.nodes");
    expect(index).not.toContain("dshStickerDiagnostic");
  });

  it("inlines only the Core protocol and leaves no runtime Core package import", async () => {
    const host = await text("lib/index.js");
    const client = await text("lib/client.js");
    const bundle = `${host}\n${client}`;
    expect(bundle).not.toMatch(/(?:from\s+|require\()["']dsh-annotation-core(?:\/[^"']*)?["']/);
    expect(bundle).not.toMatch(/(?:from\s+|require\()["']dsh-obsidian-bridge(?:-lifecycle|-protocol)?(?:\/[^"']*)?["']/);
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
