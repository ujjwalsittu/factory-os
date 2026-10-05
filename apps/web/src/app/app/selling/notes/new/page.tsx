import {Suspense} from 'react';
import {SalesNoteForm} from '@/components/sales-note-form';
export default function Page(){return <Suspense fallback={<p>Loading original invoice…</p>}><SalesNoteForm fresh/></Suspense>;}
