import {Suspense} from 'react';
import {SupplierNoteForm} from '@/components/supplier-note-form';
export default function Page(){return <Suspense fallback={<p>Loading original invoice…</p>}><SupplierNoteForm fresh/></Suspense>;}
