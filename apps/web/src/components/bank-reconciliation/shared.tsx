'use client';
import { Field, Input } from '@factoryos/ui';
export function Text({label,value,onChange,type='text',disabled=false,hint}:{label:string;value:string;onChange:(value:string)=>void;type?:string;disabled?:boolean;hint?:string}){return <Field label={label} hint={hint}>{p=><Input {...p} type={type} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}/>}</Field>;}
