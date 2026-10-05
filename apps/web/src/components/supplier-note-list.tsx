'use client';
import {Alert,Badge,Card,PageHeader,Table,Td,Th,buttonClass} from '@factoryos/ui';
import {useQuery} from '@tanstack/react-query';
import Link from 'next/link';
import {api} from '@/lib/api';
import type {SupplierNote} from '@/lib/supplier-returns';
import {useWorkspace} from './workspace';
import {EntityGate} from './entity-gate';
export function SupplierNoteList(){const ws=useWorkspace();const q=useQuery({queryKey:['supplier-notes',ws.tenantId,ws.entityId],queryFn:()=>api<SupplierNote[]>('/buying/supplier-notes',{scope:ws.scope}),enabled:!!ws.entityId&&ws.can('buying.supplier_note.read'),staleTime:0});return <><PageHeader title="Supplier notes" description="Record supplier-issued credit and debit notes against an original purchase invoice."/><EntityGate what="supplier notes"><div className="mb-4">{ws.can('buying.supplier_note.create')&&<Link className={buttonClass('secondary','md')} href="/app/buying/supplier-notes/new">Record supplier note</Link>}</div>{q.error&&<Alert tone="danger">{q.error.message}</Alert>}<Card><Table><thead><tr><Th>Voucher</Th><Th>Supplier reference</Th><Th>Kind</Th><Th>Date</Th><Th>Total</Th><Th>Status</Th></tr></thead><tbody>{q.data?.map(n=><tr key={n.id}><Td><Link className="text-accent" href={`/app/buying/supplier-notes/${n.id}`}>{n.number??'Draft'}</Link></Td><Td>{n.supplierNoteNo}</Td><Td>{n.kind}</Td><Td>{n.postingDate}</Td><Td>{n.currency} {n.grandTotal}</Td><Td><Badge>{n.status}</Badge></Td></tr>)}</tbody></Table>{q.data?.length===0&&<p className="p-5 text-muted">Choose a submitted purchase invoice to record its supplier note.</p>}</Card></EntityGate></>;}
