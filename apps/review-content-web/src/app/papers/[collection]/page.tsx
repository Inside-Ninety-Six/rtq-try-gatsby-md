import { isPaperCollectionId } from '@rtq/review-paper-model';
import { notFound } from 'next/navigation';

import { PaperIndex } from '@/components/paper-index';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { collection } = await params;
  const { q } = await searchParams;
  if (!isPaperCollectionId(collection)) notFound();

  return (
    <PaperIndex
      initialCollectionId={collection}
      initialQuery={typeof q === 'string' ? q : undefined}
    />
  );
}
