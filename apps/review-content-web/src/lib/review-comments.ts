import type { ReviewPaper, ReviewPaperNode } from '@rtq/review-paper-model';
import {
  getReviewStore,
  ReviewCommentConflictError,
  ReviewDatabaseError,
  type ReviewCommentRepository,
} from '@rtq/review-store/server';

import {
  resolveVerifiedReviewCommentTarget,
  ReviewRequestError,
  type ReviewCommentRequest,
} from './review-server.ts';
import {
  reviewCommentTargetForNode,
  type ReviewCommentLoad,
  type ReviewCommentTargetDescriptor,
  type ReviewTargetIdentity,
  type ReviewTargetDescriptor,
} from './review-types.ts';

function flattenQuestionTree(
  node: ReviewPaperNode,
): readonly ReviewPaperNode[] {
  return [node, ...node.children.flatMap(flattenQuestionTree)];
}

export function reviewCommentIdentitiesForPaper(
  paper: ReviewPaper,
): readonly ReviewTargetIdentity[] {
  const source = {
    collectionId: paper.source.collection.id,
    relativePath: paper.source.relativePath,
  };
  const targets = paper.sections.flatMap((section) =>
    section.questions.flatMap((topLevel) =>
      flattenQuestionTree(topLevel).flatMap((node) =>
        (['question', 'answer'] as const).flatMap((side) => {
          const target = reviewCommentTargetForNode(
            node,
            topLevel,
            side,
            source,
          );
          return target
            ? [
                {
                  questionId: target.questionId,
                  side: target.side,
                  uuid: target.uuid,
                },
              ]
            : [];
        }),
      ),
    ),
  );
  return targets;
}

export function loadReviewCommentsForPaper(
  paper: ReviewPaper,
): ReviewCommentLoad {
  try {
    return {
      comments: getReviewStore().comments.listForTargets(
        reviewCommentIdentitiesForPaper(paper),
      ),
    };
  } catch {
    return {
      comments: [],
      error:
        'Local comments are unavailable. Check the rtq-review database directory and retry.',
    };
  }
}

type AppendCommentDependencies = Readonly<{
  repository?: ReviewCommentRepository;
  resolveTarget?: (
    target: ReviewCommentTargetDescriptor,
  ) => Promise<ReviewTargetDescriptor>;
}>;

export async function appendVerifiedReviewComment(
  input: ReviewCommentRequest,
  dependencies: AppendCommentDependencies = {},
) {
  const resolveTarget =
    dependencies.resolveTarget ?? resolveVerifiedReviewCommentTarget;
  const target = await resolveTarget(input.target);
  try {
    const repository = dependencies.repository ?? getReviewStore().comments;
    return repository.append({
      comment: input.comment,
      questionId: target.questionId,
      ragState: target.ragState,
      reviewer: input.reviewer,
      side: target.side,
      submissionId: input.submissionId,
      uuid: target.uuid,
    });
  } catch (error) {
    if (error instanceof ReviewCommentConflictError) {
      throw new ReviewRequestError(error.message, 409);
    }
    if (error instanceof ReviewDatabaseError) {
      throw new ReviewRequestError(
        'Local comments are unavailable. Check the database directory and retry.',
        503,
      );
    }
    throw error;
  }
}
