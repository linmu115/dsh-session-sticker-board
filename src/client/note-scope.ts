import type { ExtensionObject, NoteIdentity } from '@linmu/dsh-session-contracts';
import { pinKnowledge, selectedVault, type VaultKnowledgeBridge } from './bridge-channel.ts';
import { knowledgeRequest } from './knowledge.ts';

/** Upgrade legacy scope only after the selected Vault proves the stable note identity. */
export async function scopeLinkedNote(object:ExtensionObject, bridge:VaultKnowledgeBridge, selection?:string) {
 const body=object.content.body as {logicalSessionId:string;note:NoteIdentity};
 const vaultId=selectedVault(bridge,body.note.vaultId||selection);
 const route=pinKnowledge(bridge,vaultId);
 if(!body.note.vaultId && vaultId){
  const note=await route.knowledge('note-resolve',{noteId:body.note.noteId}) as NoteIdentity;
  if(note.vaultId!==vaultId||note.noteId!==body.note.noteId)throw new Error('此 Vault 无法核验旧关联的笔记身份');
  const next=await knowledgeRequest<{status:string;object:ExtensionObject}>('write',{namespace:'obsidian-links',objectId:object.objectId,expectedRevision:object.revision,title:object.content.title,body:{...body,note:{...body.note,...note}},deleted:object.deleted});
  if(next.status==='conflict')throw new Error('关联已改变，请刷新后重试');
  object=next.object;
 }
 return {object,note:(object.content.body as typeof body).note,route,vaultId};
}
