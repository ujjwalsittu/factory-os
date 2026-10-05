import {Suspense} from 'react';
import {SalesNoteForm} from '@/components/sales-note-form';
export default function Page(){return <Suspense fallback={<p>Loading customer note…</p>}><SalesNoteForm/></Suspense>;}
