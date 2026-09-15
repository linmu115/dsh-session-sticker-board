import type { StickerChatSnapshotLike } from './overlay.tsx';
import type { GraphSourceMarker, GraphSourceMarkerPage } from '@linmu/dsh-session-contracts';
import type { GraphSessionIdentity } from '@linmu/dsh-session-contracts';
import type { AnnotationCoreClient } from 'dsh-annotation-core/client-api';
import { knowledgeRequest } from './knowledge.ts';

export const SOURCE_MARKERS_CHANGED = 'dsh-session-references-changed';

/** Server-projected active references, never a second store of source transcripts. */
export type SourceMarker = GraphSourceMarker;
export type SourceMarkerPage = GraphSourceMarkerPage;
export interface SourceMarkerGroup {
  key: string;
  messageId: string;
  selectedText: string;
  occurrence: number;
  /** Navigation deduplicates targets; deletion must retain every independent relation. */
  references: SourceMarker[];
  targets: SourceMarker[];
}

export type SourceMarkerLocalReferences = Pick<AnnotationCoreClient, 'resolveReferenceLink' | 'deleteReferenceLink'>;

/** The source-scoped authority also updates the graph before acknowledging removal. */
export async function revokeSourceMarker(nativeSessionId: string, referenceId: string, request = knowledgeRequest): Promise<void> {
  await request('revoke-source-reference', { nativeSessionId, referenceId });
}

/** Local bubbles may be absent after import. Their cleanup never reverses an authoritative revoke. */
export async function cleanSourceMarkerBubble(marker: SourceMarker, core: SourceMarkerLocalReferences | undefined, request = knowledgeRequest): Promise<boolean> {
  if (!core?.resolveReferenceLink || !core.deleteReferenceLink) return false;
  try {
    const target = await request<GraphSessionIdentity>('resolve', { logicalSessionId: marker.targetLogicalSessionId });
    if (target.logicalSessionId !== marker.targetLogicalSessionId || !target.nativeSessionId) return false;
    const link = await core.resolveReferenceLink(target.nativeSessionId, marker.referenceId);
    if (!link || link.state === 'deleted') return true;
    if (link.referenceId !== marker.referenceId || !link.setId) return false;
    await core.deleteReferenceLink(target.nativeSessionId, link.setId, marker.referenceId);
    return true;
  } catch { return false; }
}

export async function loadSourceMarkers(nativeSessionId: string, request = knowledgeRequest): Promise<SourceMarker[]> {
  const items = new Map<string, SourceMarker>();
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const page: SourceMarkerPage = await request('source-markers', { nativeSessionId, ...(after ? { after } : {}) });
    for (const row of page.items) {
      if (row.messageId && row.selectedText?.trim() && row.selectedText.length <= 4000 &&
        Number.isSafeInteger(row.occurrence) && row.occurrence >= 0 && row.referenceId && row.targetLogicalSessionId)
        items.set(row.referenceId, row);
    }
    after = page.nextCursor;
    if (after && seen.has(after)) throw new Error('来源引用分页发生变化，请重新打开来源');
    if (after) seen.add(after);
  } while (after);
  return [...items.values()];
}

export function groupSourceMarkers(markers: readonly SourceMarker[]): SourceMarkerGroup[] {
  const groups = new Map<string, SourceMarkerGroup>();
  for (const marker of markers) {
    const key = JSON.stringify([marker.messageId, marker.selectedText, marker.occurrence]);
    let group = groups.get(key);
    if (!group) {
      group = { key, messageId: marker.messageId, selectedText: marker.selectedText, occurrence: marker.occurrence, references: [], targets: [] };
      groups.set(key, group);
    }
    if (!group.references.some(reference => reference.referenceId === marker.referenceId)) group.references.push(marker);
    // Two independent references to one target need only one navigation choice.
    if (!group.targets.some(target => target.targetLogicalSessionId === marker.targetLogicalSessionId)) group.targets.push(marker);
  }
  return [...groups.values()];
}

/** Saved message IDs are resolved against the current render, never used as step IDs. */
export function resolveSourceMarkerAnchorKey(snapshot: StickerChatSnapshotLike | undefined, messageId: string): string | undefined {
  return snapshot?.order.find(key => {
    const node = snapshot.nodes.get(key);
    const data = node?.data as { status?: string; finalNode?: { messageId?: string } } | undefined;
    return node?.kind === 'assistant-step' && data?.status === 'settled' && data.finalNode?.messageId === messageId;
  });
}
