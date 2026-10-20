import { TallyImportDetail } from '@/components/tally-import';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TallyImportDetail id={id} />;
}
