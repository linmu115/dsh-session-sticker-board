import { expect, it, vi } from 'vitest';
import { cleanSourceMarkerBubble, groupSourceMarkers, loadSourceMarkers, resolveSourceMarkerAnchorKey, revokeSourceMarker } from '../src/client/source-markers.ts';
import type { SourceMarker } from '../src/client/source-markers.ts';

const marker: SourceMarker = { objectId:'sticker-a', referenceId:'ref-a', sourceVersionId:'v1', sourceAnchorId:'reply-id', messageId:'reply-id', selectedText:'引用段落', occurrence:1, targetLogicalSessionId:'logical-y', targetTitle:'目标Y' };

it('resolves the recorded message ID after the renderer assigns new keys', () => {
  const snapshot={order:['new-render-key'],nodes:new Map([['new-render-key',{id:'step-42',kind:'assistant-step',data:{status:'settled',finalNode:{messageId:'reply-id'}}}]])};
  expect(resolveSourceMarkerAnchorKey(snapshot,'reply-id')).toBe('new-render-key');
  expect(resolveSourceMarkerAnchorKey(snapshot,'step-42')).toBeUndefined();
  expect(resolveSourceMarkerAnchorKey(snapshot,'old-render-key')).toBeUndefined();
  expect(resolveSourceMarkerAnchorKey(undefined,'reply-id')).toBeUndefined();
});

it('groups shared highlights, deduplicates target choices and preserves independent references after revocation', () => {
  const second={...marker,objectId:'sticker-b',referenceId:'ref-b',targetLogicalSessionId:'logical-z',targetTitle:'目标Z'};
  const duplicate={...marker,objectId:'sticker-c',referenceId:'ref-c'};
  const groups=groupSourceMarkers([marker,second,duplicate]);
  expect(groups).toHaveLength(1);expect(groups[0]!.targets).toHaveLength(2);
  expect(groups[0]!.references.map(item=>item.referenceId)).toEqual(['ref-a','ref-b','ref-c']);
  const remaining=groupSourceMarkers([second,duplicate]);
  expect(remaining[0]!.key).toBe(groups[0]!.key);expect(remaining[0]!.targets).toHaveLength(2);
  expect(groupSourceMarkers([second])[0]!.targets.map(target=>target.targetLogicalSessionId)).toEqual(['logical-z']);
  expect(groupSourceMarkers([marker,{...second,occurrence:0}])).toHaveLength(2);
});

it('loads all source-scoped pages and discards incomplete or excessive locators', async () => {
  const request=vi.fn().mockResolvedValueOnce({items:[marker],nextCursor:'next'}).mockResolvedValueOnce({items:[marker,{...marker,referenceId:'ref-b',selectedText:'x'.repeat(4001)}],nextCursor:null});
  expect(await loadSourceMarkers('native-x',request)).toEqual([marker]);
  expect(request.mock.calls).toEqual([['source-markers',{nativeSessionId:'native-x'}],['source-markers',{nativeSessionId:'native-x',after:'next'}]]);
});

it('rejects repeated cursors without exposing a partially verified list', async () => {
  const request=vi.fn().mockResolvedValue({items:[marker],nextCursor:'repeat'});
  await expect(loadSourceMarkers('native-x',request)).rejects.toThrow('分页');
  expect(request).toHaveBeenCalledTimes(2);
});

it('revokes only the selected reference through the source-scoped authority', async () => {
  const request=vi.fn().mockResolvedValue({state:'revoked'});
  await revokeSourceMarker('native-x','ref-c',request);
  expect(request.mock.calls).toEqual([['revoke-source-reference',{nativeSessionId:'native-x',referenceId:'ref-c'}]]);
  request.mockRejectedValueOnce(new Error('transaction failed'));
  await expect(revokeSourceMarker('native-x','ref-a',request)).rejects.toThrow('transaction failed');
});

it('cleans only the exact native target/set/reference after authority has revoked it', async () => {
  const request=vi.fn().mockResolvedValue({logicalSessionId:'logical-y',nativeSessionId:'native-y'});
  const core={resolveReferenceLink:vi.fn().mockResolvedValue({setId:'set-c',referenceId:'ref-c',state:'sent'}),deleteReferenceLink:vi.fn().mockResolvedValue({deleted:true,scope:'sent'})};
  expect(await cleanSourceMarkerBubble({...marker,referenceId:'ref-c'},core,request)).toBe(true);
  expect(core.resolveReferenceLink).toHaveBeenCalledWith('native-y','ref-c');
  expect(core.deleteReferenceLink).toHaveBeenCalledWith('native-y','set-c','ref-c');
  expect(request).toHaveBeenCalledWith('resolve',{logicalSessionId:'logical-y'});
});

it('accepts absent or already deleted local bubbles without creating or removing another reference', async () => {
  const request=vi.fn().mockResolvedValue({logicalSessionId:'logical-y',nativeSessionId:'native-y'});
  const core={resolveReferenceLink:vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({setId:'set-a',referenceId:'ref-a',state:'deleted'}),deleteReferenceLink:vi.fn()};
  expect(await cleanSourceMarkerBubble(marker,core,request)).toBe(true);
  expect(await cleanSourceMarkerBubble(marker,core,request)).toBe(true);
  expect(core.deleteReferenceLink).not.toHaveBeenCalled();
});

it('reports local cleanup failure without issuing another authoritative mutation', async () => {
  const request=vi.fn().mockResolvedValue({logicalSessionId:'logical-y',nativeSessionId:'native-y'});
  const core={resolveReferenceLink:vi.fn().mockResolvedValue({setId:'set-a',referenceId:'ref-a',state:'sent'}),deleteReferenceLink:vi.fn().mockRejectedValue(new Error('offline'))};
  expect(await cleanSourceMarkerBubble(marker,core,request)).toBe(false);
  expect(await cleanSourceMarkerBubble(marker,undefined,request)).toBe(false);
  expect(request.mock.calls.map(([operation])=>operation)).toEqual(['resolve']);
  core.resolveReferenceLink.mockResolvedValueOnce({setId:'wrong-set',referenceId:'another-ref',state:'sent'});
  expect(await cleanSourceMarkerBubble(marker,core,request)).toBe(false);
  expect(core.deleteReferenceLink).toHaveBeenCalledTimes(1);
});
