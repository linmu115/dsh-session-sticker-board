import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("declares the native context cohort without altering the supported profile contract", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(manifest.version).toBe("0.7.4-rc2.7");
  expect(manifest.peerDependencies["dsh-annotation-core"]).toBe("0.3.12-rc2.22");
  expect(manifest.peerDependenciesMeta["dsh-annotation-core"]?.optional).not.toBe(true);
  expect(manifest.files).toContain("docs/changes");
});
