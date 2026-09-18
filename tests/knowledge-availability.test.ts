import { afterEach, expect, it, vi } from 'vitest';
import { knowledgeRequest } from '../src/client/knowledge.ts';
afterEach(() => vi.unstubAllGlobals());
it('preserves an explicit unavailable boundary then recovers without caching or replaying a write', async () => {
 const request = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response(JSON.stringify({ok:true}),{status:200}));
 vi.stubGlobal('fetch',request);
 await expect(knowledgeRequest('write',{operationId:'same-operation'})).rejects.toMatchObject({code:'MAINTENANCE_UNAVAILABLE'});
 expect(request).toHaveBeenCalledOnce();
 await expect(knowledgeRequest('status')).resolves.toEqual({ok:true});
 expect(request).toHaveBeenCalledTimes(2);
});
it('never treats an HTML fallback as a save receipt and preserves conflict codes', async () => {
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('<html>not an API</html>',{status:200})).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'CONFLICT',message:'revision changed'}}),{status:409})));
 await expect(knowledgeRequest('write')).rejects.toMatchObject({code:'MAINTENANCE_UNAVAILABLE'});
 await expect(knowledgeRequest('write')).rejects.toMatchObject({code:'CONFLICT'});
});
