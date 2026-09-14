import type { ExtensionObject, GraphSessionIdentity } from '@linmu/dsh-session-contracts';
import { knowledgeRequest } from './knowledge.ts';

/** Save the Companion deletion intent first so interrupted cross-store writes can recover. */
export async function unlinkNote(objectId: string, target: GraphSessionIdentity, bridge: { knowledge(operation: string, input: Record<string, unknown>): Promise<unknown> }): Promise<void> {
  let object = await knowledgeRequest<ExtensionObject>('get', { namespace: 'obsidian-links', objectId });
  const owned = (value: ExtensionObject) => {
    const body = value.content.body as { logicalSessionId: string; note: { notePath: string } };
    if (body.logicalSessionId !== target.logicalSessionId) throw new Error('关联不属于当前会话');
    return body;
  };
  const body = owned(object);
  await bridge.knowledge('link-delete', { objectId, notePath: body.note.notePath, ...target, title: object.content.title });
  // Companion background sync may finish the same deletion before this write.
  for (let attempt = 0; attempt < 3; attempt++) {
    object = await knowledgeRequest<ExtensionObject>('get', { namespace: 'obsidian-links', objectId });
    owned(object);
    if (object.deleted) return;
    const result = await knowledgeRequest<{ status: string }>('write', { namespace: 'obsidian-links', objectId, expectedRevision: object.revision, title: object.content.title, body: object.content.body, deleted: true });
    if (result.status !== 'conflict') return;
  }
  throw new Error('关联正在被其他操作更新，解除请求已保存，请稍后重试');
}
