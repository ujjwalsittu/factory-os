import {Suspense} from 'react';
import {SupplierReturnClaimForm} from '@/components/supplier-return-claim-form';
export default function Page(){return <Suspense fallback={<p>Loading original invoice…</p>}><SupplierReturnClaimForm fresh/></Suspense>;}
