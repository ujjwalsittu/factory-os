import { JournalEditor } from '@/components/accounting-journal-form';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JournalEditor id={id} />;
}
