import {GstSandboxDetail} from '@/components/gst-sandbox-detail';
export default async function Page({params}:{params:Promise<{id:string}>}){return <GstSandboxDetail id={(await params).id}/>}
