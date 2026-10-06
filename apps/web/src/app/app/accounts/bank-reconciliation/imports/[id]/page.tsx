import StatementReviewPage from '@/components/bank-reconciliation/statement-import';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <StatementReviewPage id={id}/>;}
