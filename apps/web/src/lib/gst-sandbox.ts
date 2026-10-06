import type {DocumentSnapshot,TransportDraft,ProviderEvidence} from '@factoryos/gsp';
export type {DocumentSnapshot,TransportDraft};
export interface SandboxConnection{id:string;registrationId:string;capability:'irn'|'ewb';provider:'mock'|'nic_direct';environment:'sandbox';revision:number;scenario:string;credentialConfigured:boolean}
export interface SandboxRegistration{id:string;gstin:string;tradeName:string|null;stateCode:string;address:{line1:string;city:string;pincode:string}|null}
export interface SandboxPreview{id:string;hash:string;payload:{snapshot:DocumentSnapshot;transport?:TransportDraft};issues:{path:string;message:string}[]}
export interface SandboxOperation{id:string;action:string;status:string;parentId:string|null;connectionId:string;detachedAt:string|null;createdAt:string;command:{snapshot:DocumentSnapshot;transport?:TransportDraft};result:{kind:string;evidence?:ProviderEvidence;code?:string}|null;snapshot?:{payload:{snapshot:DocumentSnapshot;transport?:TransportDraft};sourceKind:string;sourceId:string|null};events?:{id:string;kind:string;createdAt:string;evidence:Record<string,unknown>}[]}
