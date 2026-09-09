import { Suspense } from 'react';

import { isPaperCollectionId, readReviewPaper } from '@rtq/review-paper-model';
import { notFound } from 'next/navigation';

import { ReviewSurface } from '@/components/review-surface';
import { prepareReviewPaperForDisplay } from '@/lib/prepare-paper';
import {
  reviewContentReviewer,
  reviewOutcomeDestination,
} from '@/lib/review-api-config';
import { loadReviewCommentsForPaper } from '@/lib/review-comments';
import { loadReviewOutcomesForPaper } from '@/lib/review-outcomes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PaperPage({
  params,
}: {
  params: Promise<{ collection: string; slug: string[] }>;
}) {
  const { collection, slug } = await params;
  if (!isPaperCollectionId(collection) || slug.length === 0) notFound();

  let paper;
  try {
    paper = await readReviewPaper(collection, slug.join('/'));
  } catch (error) {
    if (
      error instanceof Error &&
      /unsupported|unavailable|safe repository-relative/i.test(error.message)
    ) {
      notFound();
    }
    throw error;
  }

  const displayPaper = prepareReviewPaperForDisplay(paper);
  const commentLoad = loadReviewCommentsForPaper(paper);
  const outcomeLoad = loadReviewOutcomesForPaper(
    paper,
    reviewOutcomeDestination(),
  );
  return (
    <Suspense fallback={<div className="route-loading">Preparing review…</div>}>
      <ReviewSurface
        commentLoad={commentLoad}
        key={`${paper.source.collection.id}:${paper.source.relativePath}:${paper.source.version}`}
        outcomeLoad={outcomeLoad}
        paper={displayPaper}
        reviewer={reviewContentReviewer}
      />
    </Suspense>
  );
}
