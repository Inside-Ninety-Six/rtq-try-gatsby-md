import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReviewDatabaseError,
  type ReviewCommentRepository,
} from '@rtq/review-store/server';

import { appendVerifiedReviewComment } from './review-comments.ts';
import { ReviewRequestError } from './review-server.ts';
import type { ReviewTargetDescriptor } from './review-types.ts';

test('returns an appended comment immediately and maps store failures safely', async () => {
  const target: ReviewTargetDescriptor = {
    collectionId: 'toml',
    nodeId: 's0.q0',
    questionId: null,
    ragState: 'rag_wf_g0',
    relativePath: 'paper.toml',
    sheet: 'G0',
    side: 'answer',
    uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
  };
  const stored = {
    comment: 'Local only',
    createdAt: '2026-09-06T10:00:00.000Z',
    id: 'comment-1',
    questionId: target.questionId,
    ragState: target.ragState,
    reviewer: 'up',
    side: target.side,
    submissionId: 'submission-1',
    uuid: target.uuid,
  };
  const repository: ReviewCommentRepository = {
    append: () => ({ comment: stored, created: true }),
    listForTargets: () => [],
  };
  const result = await appendVerifiedReviewComment(
    {
      comment: stored.comment,
      reviewer: stored.reviewer,
      submissionId: stored.submissionId,
      target,
    },
    { repository, resolveTarget: async () => target },
  );
  assert.deepEqual(result, { comment: stored, created: true });

  await assert.rejects(
    appendVerifiedReviewComment(
      {
        comment: stored.comment,
        reviewer: stored.reviewer,
        submissionId: 'submission-2',
        target,
      },
      {
        repository: {
          ...repository,
          append: () => {
            throw new ReviewDatabaseError('private SQL detail');
          },
        },
        resolveTarget: async () => target,
      },
    ),
    (error: unknown) =>
      error instanceof ReviewRequestError &&
      error.status === 503 &&
      !error.message.includes('SQL'),
  );
});
