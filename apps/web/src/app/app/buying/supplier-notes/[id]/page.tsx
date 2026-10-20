import {Suspense} from 'react';
import {SupplierNoteForm} from '@/components/supplier-note-form';
import {TallyNoteSwitch} from '@/components/tally-documents';
export default function Page(){return <Suspense fallback={<p>Loading document…</p>}><TallyNoteSwitch kind="supplier"><SupplierNoteForm/></TallyNoteSwitch></Suspense>;}
