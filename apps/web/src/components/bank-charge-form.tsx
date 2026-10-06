'use client';
import { Alert, Badge, Button, Card, Field, Input, Select, Table, Td, Th, buttonClass } from '@factoryos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {bankPath,useCurrentReview,type Adjustment} from '@/lib/bank-reconciliation';
import { api } from '@/lib/api';
import { formatDate, formatMoney, today } from '@/lib/format';
import type { AccountGroup } from '@/lib/accounting';
import { AccountingPage, useAccounts } from './accounting-shared';
import { useWorkspace } from './workspace';
import { FormDialog } from './form-dialog';
type Split={cgst:string;sgst:string;igst:string;cess:string};
type InputData={postingDate:string;bankAccountId:string;expenseAccountId:string;baseAmount:string;gst:Split;reference:string;evidence:{document:string;reason:string};itcEligible:boolean;gstInvoice?:{number:string;date:string;supplierGstin:string;registrationId:string;reason:string}};
type Preview={totalAmount:string;inputTax:string;gstAmount:string;lines:{accountId:string;debit:string;credit:string}[]};
type Charge={id:string;postingDate:string;status:string;totalAmount:string;gstAmount:string;referenceKey:string;settlementId:string|null;voucherId:string|null;snapshot:{input?:InputData;inputTax?:string}|null};
export default function BankCharges(){
 const ws=useWorkspace();return <AccountingPage title="Bank charges" permission="accounts.bank_charge.read"><ChargeList key={`${ws.tenantId}:${ws.entityId}`}/></AccountingPage>;
}
function ChargeList(){
 const ws=useWorkspace(),cache=useQueryClient(),[reverse,setReverse]=useState<Charge|null>(null),[reason,setReason]=useState('');
 const q=useQuery({queryKey:['bank-charges',ws.tenantId,ws.entityId],queryFn:()=>api<Charge[]>('/accounts/bank-charges',{scope:ws.scope})});
 const mutation=useMutation({mutationFn:(row:Charge)=>api(`/accounts/bank-charges/${row.id}/cancel`,{method:'POST',body:{reason},scope:ws.scope}),onSuccess:async()=>{setReverse(null);setReason('');await cache.invalidateQueries({queryKey:['bank-charges',ws.tenantId,ws.entityId]});}});
 return <>
  {ws.can('accounts.bank_charge.create')&&ws.can('accounts.bank_charge.submit')&&<div className="mb-4"><Link className={buttonClass()} href="/app/accounts/bank-charges/new">New bank charge</Link></div>}
  {q.error&&<Alert tone="danger">{q.error.message}</Alert>}
  <Card><Table><thead><tr><Th>Reference</Th><Th>Date</Th><Th>Total charge</Th><Th>GST credit</Th><Th>Status</Th><Th>Source</Th><Th>Actions</Th></tr></thead><tbody>{q.data?.map(row=><tr key={row.id}>
   <Td>{row.snapshot?.input?.reference??row.referenceKey}</Td><Td>{formatDate(row.postingDate)}</Td><Td>{formatMoney(row.totalAmount)}</Td><Td>{formatMoney(row.snapshot?.inputTax??'0')}</Td><Td><Badge>{row.status}</Badge></Td>
   <Td>{row.settlementId?<Link className="text-accent" href={`/app/accounts/settlements/${row.settlementId}`}>Receipt or payment</Link>:row.voucherId?<Link className="text-accent" href={`/app/accounts/journals/${row.voucherId}`}>Bank voucher</Link>:'—'}</Td>
   <Td>{ws.can('accounts.bank_charge.cancel')&&row.status==='submitted'&&!row.settlementId&&<Button variant="ghost" onClick={()=>setReverse(row)}>Reverse charge</Button>}</Td>
  </tr>)}</tbody></Table>{q.isLoading&&<p className="p-4">Loading charges…</p>}{q.data?.length===0&&<p className="p-4 text-muted">No bank charges recorded for this entity.</p>}</Card>
  {reverse&&<FormDialog title="Reverse bank charge" description="This records the exact reversal of the original bank voucher." onClose={()=>setReverse(null)} onSubmit={()=>mutation.mutate(reverse)} pending={mutation.isPending} error={mutation.error} submitLabel="Record reversal"><Field label="Reversal reason">{props=><Input {...props} value={reason} onChange={e=>setReason(e.target.value)} required minLength={5}/>}</Field></FormDialog>}
 </>;
}
type ChargeLink={profileId:string;statementRowId:string;replacementOf?:string;preview:Adjustment};
export function BankChargeEditor(){return <AccountingPage title="New bank charge" permission="accounts.bank_charge.create"><Suspense fallback={<p>Loading bank evidence…</p>}><ChargeLoad/></Suspense></AccountingPage>;}
function ChargeLoad(){const ws=useWorkspace(),params=useSearchParams(),profileId=params.get('profile'),statementRowId=params.get('statementRow'),replacementOf=params.get('replacement')??undefined,linked=!!(profileId||statementRowId),allowed=ws.can('accounts.bank_reconciliation.read')&&ws.can('accounts.bank_reconciliation.submit');const q=useQuery({queryKey:['bank',ws.tenantId,ws.entityId,profileId,'charge-prefill',statementRowId],queryFn:()=>api<Adjustment>(`${bankPath(profileId!)}/adjustments/preview`,{method:'POST',body:{statementRowId},scope:ws.scope}),enabled:linked&&!!profileId&&!!statementRowId&&allowed,retry:false});if(linked&&(!allowed||!profileId||!statementRowId))return <Alert tone="danger">Reconciliation access and the original statement row are required.</Alert>;if(q.error)return <Alert tone="danger">{q.error.message}</Alert>;if(linked&&(!q.data||q.isFetching))return <p>Reviewing statement residual…</p>;const link=q.data&&profileId&&statementRowId?{profileId,statementRowId,replacementOf,preview:q.data}:undefined;return <ChargeForm key={`${ws.tenantId}:${ws.entityId}:${profileId??'standalone'}:${statementRowId??''}:${q.data?.previewHash??''}`} link={link}/>;}
function ChargeForm({link}:{link?:ChargeLink}){
 const ws=useWorkspace(),router=useRouter(),cache=useQueryClient(),accounts=useAccounts();
 const groups=useQuery({queryKey:['account-groups',ws.tenantId,ws.entityId],queryFn:()=>api<AccountGroup[]>('/accounts/groups',{scope:ws.scope})});
 const entities=useQuery({queryKey:['charge-gst-registrations',ws.tenantId],queryFn:()=>api<{id:string;gstRegistrations:{id:string;gstin:string}[]}[]>('/entities',{scope:ws.tenantScope}),enabled:ws.can('settings.entity.read')});
 const [input,setInput]=useState<InputData>({postingDate:link?.preview.row.date??today(),bankAccountId:link?.preview.bankAccountId??'',expenseAccountId:'',baseAmount:link?.preview.row.remaining.replace(/^-/,'')??'0',gst:{cgst:'0',sgst:'0',igst:'0',cess:'0'},reference:link?.preview.row.reference??'',evidence:{document:link?'Bank statement row':'' ,reason:link?'Documented bank statement exception':''},itcEligible:false});
 const [invoice,setInvoice]=useState({number:'',date:today(),supplierGstin:'',registrationId:'',reason:''});
 const [withInvoice,setWithInvoice]=useState(false),[preview,setPreview]=useState<{value:Preview;input:InputData;key:string}|null>(null);
 const fullInput={...input,...withInvoice?{gstInvoice:invoice}:{}};
 const fingerprint=JSON.stringify({fullInput,linkHash:link?.preview.previewHash}),live=useCurrentReview(fingerprint),current=useRef(fingerprint);current.current=fingerprint;
 useEffect(()=>{if(accounts.data)setInput(old=>({...old,bankAccountId:old.bankAccountId||accounts.data.find(a=>a.role==='bank')?.id||'',expenseAccountId:old.expenseAccountId||accounts.data.find(a=>a.role==='bank_charges')?.id||''}));},[accounts.data]);
 const review=useMutation({mutationFn:({value}:{value:InputData;key:string})=>api<Preview>('/accounts/bank-charges/preview',{method:'POST',body:value,scope:ws.scope}),onSuccess:(value,variables)=>{if(live(variables.key)&&current.current===variables.key)setPreview({value,input:variables.value,key:variables.key});}});
 const post=useMutation({mutationFn:({value}:{value:InputData;key:string})=>api(link?`${bankPath(link.profileId)}/adjustments/charge`:'/accounts/bank-charges',{method:'POST',body:link?{statementRowId:link.statementRowId,reviewedHash:link.preview.previewHash,replacementOf:link.replacementOf,charge:value}:value,scope:ws.scope}),onSuccess:async(_,variables)=>{if(!live(variables.key))return;await cache.invalidateQueries({queryKey:['bank-charges',ws.tenantId,ws.entityId]});await cache.invalidateQueries({queryKey:['bank',ws.tenantId,ws.entityId]});router.push(link?'/app/accounts/bank-reconciliation':'/app/accounts/bank-charges');}});
 const root=(groupId:string)=>groups.data?.find(g=>g.id===groupId)?.root;
 const bankGroup=(groupId:string)=>{for(let depth=0;depth<20;depth++){const group=groups.data?.find(g=>g.id===groupId);if(!group)return false;if(group.name==='Bank Accounts')return true;if(!group.parentId)return false;groupId=group.parentId;}return false;};
 const edit=(key:'postingDate'|'bankAccountId'|'expenseAccountId'|'baseAmount'|'reference',value:string)=>setInput(old=>({...old,[key]:value}));
 const validPreview=preview?.key===fingerprint;
 return <div className="space-y-4">
  {link&&<Alert>Linked statement {link.preview.row.date} · {link.preview.row.reference} · Signed remaining {link.preview.row.remaining}. Post the source, then explicitly match its bank entry.</Alert>}
  <p className="text-sm text-muted">Record a bank-only charge in INR. Fees deducted with a receipt or added to a payment retain their linked source voucher. GST stays in expense until Finance confirms a qualifying invoice.</p>
  {(accounts.error||groups.error)&&<Alert tone="danger">{accounts.error?.message??groups.error?.message}</Alert>}
  <Card className="p-4"><div className="grid gap-4 md:grid-cols-2">
   <Field label="Posting date">{props=><Input {...props} type="date" disabled={!!link} value={input.postingDate} onChange={e=>edit('postingDate',e.target.value)}/>}</Field>
   <Field label="Bank account">{props=><Select {...props} disabled={!!link} value={input.bankAccountId} onChange={e=>edit('bankAccountId',e.target.value)}><option value="">Choose bank</option>{accounts.data?.filter(a=>a.isActive&&bankGroup(a.groupId)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
   <Field label="Expense account">{props=><Select {...props} value={input.expenseAccountId} onChange={e=>edit('expenseAccountId',e.target.value)}><option value="">Choose expense</option>{accounts.data?.filter(a=>a.isActive&&root(a.groupId)==='expense').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
   <Field label="Base charge">{props=><Input {...props} inputMode="decimal" value={input.baseAmount} onChange={e=>edit('baseAmount',e.target.value)}/>}</Field>
   {(['cgst','sgst','igst','cess'] as const).map(kind=><Field key={kind} label={kind.toUpperCase()}>{props=><Input {...props} inputMode="decimal" value={input.gst[kind]} onChange={e=>setInput(old=>({...old,gst:{...old.gst,[kind]:e.target.value}}))}/>}</Field>)}
   <Field label="Charge reference">{props=><Input {...props} value={input.reference} onChange={e=>edit('reference',e.target.value)}/>}</Field>
   <Field label="Documentary reference">{props=><Input {...props} value={input.evidence.document} onChange={e=>setInput(old=>({...old,evidence:{...old.evidence,document:e.target.value}}))}/>}</Field>
   <Field label="Reason">{props=><Input {...props} value={input.evidence.reason} onChange={e=>setInput(old=>({...old,evidence:{...old.evidence,reason:e.target.value}}))}/>}</Field>
   <Field label="Record bank GST invoice">{props=><Input {...props} type="checkbox" checked={withInvoice} onChange={e=>{setWithInvoice(e.target.checked);if(!e.target.checked)setInput(old=>({...old,itcEligible:false}));}}/>}</Field>
   {withInvoice&&<>
    <Field label="Bank GST invoice number">{props=><Input {...props} value={invoice.number} onChange={e=>setInvoice(old=>({...old,number:e.target.value}))}/>}</Field>
    <Field label="Bank GST invoice date">{props=><Input {...props} type="date" value={invoice.date} onChange={e=>setInvoice(old=>({...old,date:e.target.value}))}/>}</Field>
    <Field label="Bank supplier GSTIN">{props=><Input {...props} value={invoice.supplierGstin} onChange={e=>setInvoice(old=>({...old,supplierGstin:e.target.value.toUpperCase()}))}/>}</Field>
    <Field label="Our GST registration">{props=><Select {...props} value={invoice.registrationId} onChange={e=>setInvoice(old=>({...old,registrationId:e.target.value}))}><option value="">Choose registration</option>{entities.data?.find(e=>e.id===ws.entityId)?.gstRegistrations.map(reg=><option key={reg.id} value={reg.id}>{reg.gstin}</option>)}</Select>}</Field>
    <Field label="GST eligibility reason">{props=><Input {...props} value={invoice.reason} onChange={e=>setInvoice(old=>({...old,reason:e.target.value}))}/>}</Field>
    {ws.can('accounts.withholding.approve')&&<Field label="Confirm documented GST credit eligibility">{props=><Input {...props} type="checkbox" checked={input.itcEligible} onChange={e=>setInput(old=>({...old,itcEligible:e.target.checked}))}/>}</Field>}
   </>}
  </div></Card>
  {(review.error||post.error)&&<Alert tone="danger">{review.error?.message??post.error?.message}</Alert>}
  <Button disabled={review.isPending||post.isPending} onClick={()=>review.mutate({value:fullInput,key:fingerprint})}>Review charge</Button>
  {validPreview&&preview&&<Card className="p-4 space-y-3"><p>Bank debit: {formatMoney(preview.value.totalAmount)}</p><p>GST credit: {formatMoney(preview.value.inputTax)}</p><p>Expense: {formatMoney(preview.value.lines.find(l=>l.accountId===input.expenseAccountId)?.debit??'0')}</p><Button disabled={post.isPending||!ws.can('accounts.bank_charge.submit')} onClick={()=>post.mutate({value:preview.input,key:fingerprint})}>Post bank charge</Button></Card>}
 </div>;
}
