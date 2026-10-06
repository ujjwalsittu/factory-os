import {BankReportPrint} from '@/components/bank-reconciliation/report';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <BankReportPrint id={id}/>;}
