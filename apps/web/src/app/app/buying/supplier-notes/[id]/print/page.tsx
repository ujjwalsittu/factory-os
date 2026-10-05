import {SupplierReturnPrint} from '@/components/supplier-return-print';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <SupplierReturnPrint id={id} kind="note"/>;}
