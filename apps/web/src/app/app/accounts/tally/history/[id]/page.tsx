import { TallyVoucher } from '@/components/tally-history';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TallyVoucher id={id} />;
}
