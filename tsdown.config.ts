import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, resolve as resolvePath } from "node:path";
import type { UserConfig } from "tsdown";

const CLIENT_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "cordis"];
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const CSS_PREFIX = "\0dsh-sticker-css:";
const CSS_SUFFIX = ".mjs";

const browserPlugin: NonNullable<UserConfig["plugins"]> = {
  name: "dsh-sticker-browser-boundary",
  resolveId(source, importer) {
    if (NODE_BUILTINS.has(source)) throw new Error(`Node builtin cannot enter DSH client bundle: ${source}`);
    if (source.startsWith("@deepseek-ai/")) throw new Error(`Platform value import is forbidden: ${source}`);
    if (!source.endsWith(".css")) return null;
    return `${CSS_PREFIX}${importer ? resolvePath(dirname(importer), source) : resolvePath(source)}${CSS_SUFFIX}`;
  },
  async load(id) {
    if (!id.startsWith(CSS_PREFIX)) return null;
    const file = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length);
    this.addWatchFile(file);
    const css = await readFile(file, "utf8");
    const tagId = `dsh-session-sticker-board/${basename(file)}`;
    return [
      `if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="${tagId}"]')) {`,
      "  const tag = document.createElement('style');",
      `  tag.dataset.pluginCss = ${JSON.stringify(tagId)};`,
      `  tag.textContent = ${JSON.stringify(css)};`,
      "  document.head.appendChild(tag);",
      "}",
      "export default '';",
    ].join("\n");
  },
};

export default [
  {
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    dts: false,
    sourcemap: true,
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (id: string) => CLIENT_EXTERNALS.includes(id) ? undefined : true,
    plugins: [browserPlugin],
    outputOptions: {
      entryFileNames: "client.js",
      banner: 'window.__ModuleLoader__.load({ id: "dsh-session-sticker-board", factory: (require) => {',
      intro: "var module = { exports: {} }; var exports = module.exports;",
      footer: "return module.exports; } });",
      codeSplitting: false,
    },
  },
] satisfies UserConfig[];
