import type { BetterSidebarService, SidebarTab } from '../context-types.ts'

/** Tracks only rendered native tabs; synthetic onOpen IDs are never accepted. */
export class NativeTabRegistry {
  private tabs = new Map<string, { sessionId: string; tab: SidebarTab; signal: AbortSignal; remove: () => void }>()
  private pending = new Map<string, { requestId: string; promise: Promise<SidebarTab>; resolve(tab: SidebarTab): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private rejectedRequests = new Set<string>()
  private closed = false
  constructor(private service: BetterSidebarService) {}
  list(sessionId: string, type: string) { return [...this.tabs.values()].filter(row => row.sessionId === sessionId && row.tab.type === type && !row.signal.aborted).map(row => row.tab) }
  get(sessionId: string, id: string) { const row = this.tabs.get(JSON.stringify([sessionId, id])); return row?.sessionId === sessionId && !row.signal.aborted ? row.tab : undefined }
  register(sessionId: string, tab: SidebarTab, signal: AbortSignal) {
    if (this.closed || signal.aborted) return
    const request = (tab.meta as { nativeOpenRequest?: string } | undefined)?.nativeOpenRequest
    if (request && this.rejectedRequests.has(request)) { this.service.closeTab(tab.id, { sessionId }); return }
    const tabKey = JSON.stringify([sessionId, tab.id])
    const old = this.tabs.get(tabKey)
    if (old && (old.sessionId !== sessionId || old.signal !== signal)) { old.remove(); this.tabs.delete(tabKey) }
    if (!this.tabs.has(tabKey)) {
      const drop = () => { this.tabs.delete(tabKey); signal.removeEventListener('abort', drop) }
      signal.addEventListener('abort', drop, { once: true })
      this.tabs.set(tabKey, { sessionId, tab, signal, remove: () => signal.removeEventListener('abort', drop) })
    } else this.tabs.get(tabKey)!.tab = tab
    const key = JSON.stringify([sessionId, tab.type])
    const pending = this.pending.get(key)
    if (pending && request === pending.requestId) { clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(tab) }
  }
  update(sessionId: string, id: string, patch: { title?: string; meta?: unknown }) {
    const tab = this.get(sessionId, id)
    if (!tab) return false
    this.tabs.get(JSON.stringify([sessionId, id]))!.tab = { ...tab, ...patch }
    this.service.updateTab(id, patch, { sessionId })
    return true
  }
  open(sessionId: string, type: string, meta: Record<string, unknown> = {}): Promise<SidebarTab> {
    if (this.closed) return Promise.reject(new Error('Sidebar consumer was unloaded'))
    const existing = this.list(sessionId, type).at(-1)
    if (existing) return Promise.resolve(existing)
    const key = JSON.stringify([sessionId, type])
    const prior = this.pending.get(key)
    if (prior) return prior.promise
    let resolve!: (tab: SidebarTab) => void, reject!: (error: Error) => void
    const promise = new Promise<SidebarTab>((yes, no) => { resolve = yes; reject = no })
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => { this.pending.delete(key); this.rejectedRequests.add(requestId); reject(new Error('Sidebar tab did not mount')) }, 10000)
    this.pending.set(key, { requestId, promise, resolve, reject, timer })
    try { this.service.openTab({ type, meta: { ...meta, nativeOpenRequest: requestId } }, { sessionId }) }
    catch (error) { clearTimeout(timer); this.pending.delete(key); reject(error instanceof Error ? error : new Error(String(error))) }
    return promise
  }
  dispose() {
    this.closed = true
    for (const row of this.tabs.values()) row.remove()
    this.tabs.clear()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Sidebar consumer was unloaded')) }
    this.pending.clear()
  }
}
const registries = new WeakMap<BetterSidebarService, NativeTabRegistry>()
export function nativeTabs(service: BetterSidebarService) {
  let registry = registries.get(service)
  if (!registry) { registry = new NativeTabRegistry(service); registries.set(service, registry) }
  return registry
}
export function disposeNativeTabs(service: BetterSidebarService) { registries.get(service)?.dispose(); registries.delete(service) }
export const usesNativeTabs = (service: BetterSidebarService) => service.features?.includes('nativeTabLifetime') === true
