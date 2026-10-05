'use client';
import {Alert,Badge,Card,PageHeader,Table,Td,Th,buttonClass} from '@factoryos/ui';
import {useQuery} from '@tanstack/react-query';
import Link from 'next/link';
import {api} from '@/lib/api';
import type {ReturnClaim} from '@/lib/supplier-returns';
import {useWorkspace} from './workspace';
import {EntityGate} from './entity-gate';
export function SupplierReturnClaimList(){const ws=useWorkspace();const q=useQuery({queryKey:['supplier-return-claims',ws.tenantId,ws.entityId],queryFn:()=>api<ReturnClaim[]>('/buying/return-claims',{scope:ws.scope}),enabled:!!ws.entityId&&ws.can('buying.return_claim.read'),staleTime:0});return <><PageHeader title="Purchase return claims" description="Request supplier acceptance and track physical goods separately from payable adjustments."/><EntityGate what="return claims">{ws.can('buying.return_claim.create')&&<Link className={buttonClass('secondary','md')} href="/app/buying/return-claims/new">New return claim</Link>}{q.error&&<Alert tone="danger">{q.error.message}</Alert>}<Card className="mt-4"><Table><thead><tr><Th>Claim</Th><Th>Date</Th><Th>Reason</Th><Th>Status</Th><Th>Approval</Th></tr></thead><tbody>{q.data?.map(c=><tr key={c.id}><Td><Link className="text-accent" href={`/app/buying/return-claims/${c.id}`}>{c.number??'Draft'}</Link></Td><Td>{c.postingDate}</Td><Td>{c.reason}</Td><Td><Badge>{c.status}</Badge></Td><Td>{c.approvedBy?'Approved':'Awaiting approval'}</Td></tr>)}</tbody></Table>{q.data?.length===0&&<p className="p-5 text-muted">Start from an original submitted purchase invoice.</p>}</Card></EntityGate></>;}
