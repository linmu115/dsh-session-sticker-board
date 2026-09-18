import { useEffect, useState } from 'react';
import type { VaultKnowledgeBridge } from './bridge-channel.ts';
export function VaultChoice({bridge,value,onChange,label='目标 Vault'}:{bridge:VaultKnowledgeBridge;value:string;onChange:(value:string)=>void;label?:string}) {
 const [vaults,setVaults]=useState(()=>bridge.listVaults?.()??[]);
 useEffect(()=>{const timer=setInterval(()=>setVaults(bridge.listVaults?.()??[]),2000);return()=>clearInterval(timer);},[bridge]);
 if(!bridge.listVaults)return null;
 return <label className="dsh-vault-choice"><span>{label}</span><select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}><option value="">请选择 Vault</option>{vaults.filter(vault=>vault.state==='bound').map(vault=><option key={vault.vaultId} value={vault.vaultId}>{vault.displayName}</option>)}</select></label>;
}
