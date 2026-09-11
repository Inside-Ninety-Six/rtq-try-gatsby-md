import { PaperIndex } from '@/components/paper-index';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return <PaperIndex initialQuery={typeof q === 'string' ? q : undefined} />;
}
