export interface StickerDiagnosticSurface {
  readonly element: HTMLElement;
  mark(stage: string, detail?: string): void;
  fail(stage: string, error: unknown): void;
  dispose(): void;
}

type DiagnosticDocument = Pick<Document, "createElement" | "body" | "documentElement">;

const MAX_VISIBLE_STAGES = 10;

export function diagnosticErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 180) || "unknown error";
}

export function createStickerDiagnosticSurface(
  documentLike: DiagnosticDocument = document,
): StickerDiagnosticSurface {
  const element = documentLike.createElement("aside");
  const stages: string[] = [];
  element.dataset.dshStickerDiagnostic = "";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.style.cssText = [
    "position:fixed",
    "left:8px",
    "bottom:8px",
    "z-index:2147483647",
    "max-width:420px",
    "max-height:46vh",
    "overflow:hidden",
    "pointer-events:none",
    "border:1px solid #718096",
    "border-radius:6px",
    "background:rgba(17,24,39,.94)",
    "color:#f7fafc",
    "box-shadow:0 5px 18px rgba(0,0,0,.28)",
    "padding:7px 9px",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
  ].join(";");

  const render = (): void => {
    element.textContent = `Sticker Board 临时诊断\n${stages.slice(-MAX_VISIBLE_STAGES).join("\n")}`;
  };
  const mark = (stage: string, detail?: string): void => {
    const line = detail ? `${stage} — ${detail}` : stage;
    stages.push(line);
    element.dataset.dshStickerDiagnosticStage = stage;
    render();
  };

  (documentLike.body ?? documentLike.documentElement).appendChild(element);

  return {
    element,
    mark,
    fail(stage, error) {
      element.dataset.dshStickerDiagnosticFailed = "true";
      element.style.borderColor = "#f56565";
      mark(stage, diagnosticErrorMessage(error));
    },
    dispose() {
      element.remove();
    },
  };
}
