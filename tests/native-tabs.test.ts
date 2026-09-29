import { describe, expect, it, vi } from 'vitest'
import type { BetterSidebarService, SidebarTab } from '../src/context-types.ts'
import { NativeTabRegistry } from '../src/client/native-tabs.ts'
function fixture() {
 const opens: { type: string; meta: Record<string, unknown>; sessionId: string }[] = []
 const updateTab = vi.fn(), closeTab = vi.fn()
 const service = { openTab: (seed: any, scope: any) => opens.push({ ...seed, sessionId: scope.sessionId }), updateTab, closeTab } as unknown as BetterSidebarService
 return { registry: new NativeTabRegistry(service), opens, updateTab }
}
const tab = (id: string, meta: unknown): SidebarTab => ({ id, type: 'detail', title: 'Detail', meta })
describe('DSH 0.2 native tab ownership', () => {
 it('waits for a real rendered ID and isolates simultaneous session scopes', async () => {
  const f = fixture(), a = f.registry.open('A', 'detail'), b = f.registry.open('B', 'detail')
  expect(f.registry.open('A', 'detail')).toBe(a)
  expect(f.opens).toHaveLength(2)
  let aDone = false; void a.then(() => { aDone = true })
  const sb = new AbortController(), sa = new AbortController()
  f.registry.register('B', tab('real-B', f.opens[1]!.meta), sb.signal)
  expect((await b).id).toBe('real-B'); expect(aDone).toBe(false)
  f.registry.register('A', tab('real-A', f.opens[0]!.meta), sa.signal)
  expect((await a).id).toBe('real-A')
  expect(f.registry.update('B', 'real-A', { meta: {} })).toBe(false)
  expect(f.registry.update('A', 'real-A', { meta: { childId: 'child' } })).toBe(true)
  expect(f.updateTab).toHaveBeenCalledWith('real-A', { meta: { childId: 'child' } }, { sessionId: 'A' })
  sa.abort(); expect(f.registry.get('A', 'real-A')).toBeUndefined()
  expect(f.registry.get('B', 'real-B')).toBeDefined(); f.registry.dispose()
 })
 it('reattaches restored tabs without opening duplicates and excludes aborted lifetimes', async () => {
  const f = fixture(), life = new AbortController()
  f.registry.register('A', tab('restored', { childId: 'durable-child' }), life.signal)
  expect((await f.registry.open('A', 'detail')).id).toBe('restored')
  expect(f.opens).toHaveLength(0)
  life.abort(); f.registry.register('A', tab('closed', {}), life.signal)
  expect(f.registry.list('A', 'detail')).toEqual([]); f.registry.dispose()
 })
 it('rejects pending opens at unload and ignores late mounts', async () => {
  const f = fixture(), pending = f.registry.open('A', 'detail')
  const rejected = expect(pending).rejects.toThrow('unloaded'); f.registry.dispose(); await rejected
  f.registry.register('A', tab('late', f.opens[0]!.meta), new AbortController().signal)
  expect(f.registry.list('A', 'detail')).toEqual([])
 })
 it('does not satisfy a retried open with an earlier request late mount', async () => {
  vi.useFakeTimers()
  try {
   const f = fixture(), first = f.registry.open('A', 'detail')
   const rejection = expect(first).rejects.toThrow('did not mount'); await vi.advanceTimersByTimeAsync(10000); await rejection
   const second = f.registry.open('A', 'detail'); let resolved = false; void second.then(() => { resolved = true })
   f.registry.register('A', tab('late-first', f.opens[0]!.meta), new AbortController().signal)
   await Promise.resolve(); expect(resolved).toBe(false)
   f.registry.register('A', tab('second', f.opens[1]!.meta), new AbortController().signal)
   expect((await second).id).toBe('second'); f.registry.dispose()
  } finally { vi.useRealTimers() }
 })
})

it('keeps native tab1 in two sessions independent', () => {
 const f = fixture(), a = new AbortController(), b = new AbortController()
 f.registry.register('A', tab('tab1', { childId: 'child-A' }), a.signal)
 f.registry.register('B', tab('tab1', { childId: 'child-B' }), b.signal)
 expect(f.registry.get('A', 'tab1')?.meta).toEqual({ childId: 'child-A' })
 expect(f.registry.get('B', 'tab1')?.meta).toEqual({ childId: 'child-B' })
 f.registry.update('A', 'tab1', { title: 'A updated' })
 expect(f.updateTab).toHaveBeenCalledWith('tab1', { title: 'A updated' }, { sessionId: 'A' })
 a.abort(); expect(f.registry.get('B', 'tab1')).toBeDefined(); f.registry.dispose()
})
