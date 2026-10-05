import {Suspense} from 'react';
import {SupplierNoteForm} from '@/components/supplier-note-form';
export default function Page(){return <Suspense fallback={<p>Loading document…</p>}><SupplierNoteForm/></Suspense>;}
