'use client';
import {Alert,Badge,Card,PageHeader,Table,Td,Th,buttonClass} from '@factoryos/ui';
import {useQuery} from '@tanstack/react-query';
import Link from 'next/link';
import {api} from '@/lib/api';
import type {CustomerNote} from '@/lib/sales-notes';
import {EntityGate} from './entity-gate';
import {useWorkspace} from './workspace';
export function SalesNoteList(){const ws=useWorkspace();const q=useQuery({queryKey:['sales-notes',ws.tenantId,ws.entityId],queryFn:()=>api<CustomerNote[]>('/sales-notes',{scope:ws.scope}),enabled:!!ws.entityId&&ws.can('selling.sales_note.read'),staleTime:0});return <><PageHeader title="Credit/debit notes" description="Correct an original invoice or record returned goods, with traceable tax, stock and customer balances."/><EntityGate what="customer notes">{!ws.can('selling.sales_note.read')?<Alert>No permission to read customer notes.</Alert>:<><p className="mb-4"><Link className={buttonClass('secondary','md')} href="/app/selling/invoices">Choose an original invoice</Link></p>{q.error&&<Alert tone="danger">{q.error.message}</Alert>}<Card><Table><thead><tr><Th>Note</Th><Th>Type</Th><Th>Date</Th><Th>Customer</Th><Th>Total</Th><Th>Status</Th></tr></thead><tbody>{q.data?.map(n=><tr key={n.id}><Td><Link className="text-accent" href={`/app/selling/notes/${n.id}`}>{n.number??'Draft'}</Link></Td><Td>{n.kind==='credit'?'Credit':'Debit'}</Td><Td>{n.postingDate}</Td><Td>{n.customerName}</Td><Td>{n.currency} {n.grandTotal}</Td><Td><Badge>{n.status}</Badge></Td></tr>)}</tbody></Table>{q.data?.length===0&&<p className="p-5 text-muted">Create a note from a submitted sales invoice.</p>}</Card></>}</EntityGate></>;}
