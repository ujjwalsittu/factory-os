import {Suspense} from 'react';
import {SalesNoteForm} from '@/components/sales-note-form';
import {TallyNoteSwitch} from '@/components/tally-documents';
export default function Page(){return <Suspense fallback={<p>Loading customer note…</p>}><TallyNoteSwitch kind="sales"><SalesNoteForm/></TallyNoteSwitch></Suspense>;}
