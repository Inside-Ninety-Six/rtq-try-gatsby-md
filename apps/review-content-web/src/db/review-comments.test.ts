import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REVIEW_WORKSPACE_ROOT } from '@rtq/review-repository-paths';

import {
  openReviewCommentRepository,
  REVIEW_COMMENT_DATABASE_PATH,
  ReviewCommentConflictError,
  ReviewDatabaseError,
  type ReviewCommentRepository,
} from './review-comments.ts';
import { appendVerifiedReviewComment } from '../lib/review-comments.ts';
import { ReviewRequestError } from '../lib/review-server.ts';
import type { ReviewTargetDescriptor } from '../lib/review-types.ts';

test('resolves the shared review database inside the rtq-review workspace', () => {
  assert.equal(
    REVIEW_COMMENT_DATABASE_PATH,
    path.join(REVIEW_WORKSPACE_ROOT, 'database', 'review-content.sqlite'),
  );
});

test('migrates, appends chronologically, retries idempotently, and reloads durably', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rtq-review-comments-'));
  const databasePath = path.join(directory, 'comments.sqlite');
  const times = [
    new Date('2026-09-06T09:00:00.000Z'),
    new Date('2026-09-06T09:01:00.000Z'),
    new Date('2026-09-06T09:02:00.000Z'),
  ];
  let time = 0;
  const repository = openReviewCommentRepository({
    databasePath,
    migrationsFolder: path.resolve('drizzle'),
    now: () => times[Math.min(time++, times.length - 1)],
  });
  const firstInput = {
    comment: 'Check the unit conversion.',
    questionId: 'paper:1:1',
    ragState: 'rag_wf_ng3',
    reviewer: 'up',
    side: 'question' as const,
    submissionId: 'submission-1',
    uuid: 'uuid-1',
  };
  const first = repository.append(firstInput);
  const retry = repository.append(firstInput);
  const second = repository.append({
    ...firstInput,
    comment: 'The explanation now needs a final read.',
    ragState: 'rag_wf_ng4',
    submissionId: 'submission-2',
  });
  repository.append({
    ...firstInput,
    comment: 'Answer-side note.',
    side: 'answer',
    submissionId: 'submission-answer',
  });
  repository.append({
    ...firstInput,
    comment: 'Nested-node feedback.',
    questionId: null,
    submissionId: 'submission-nested',
    uuid: 'uuid-nested',
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.comment.id, first.comment.id);
  assert.equal(second.created, true);
  assert.deepEqual(
    repository
      .listForTargets([
        { questionId: 'paper:1:1', side: 'question', uuid: 'uuid-1' },
      ])
      .map((comment) => [comment.comment, comment.ragState]),
    [
      ['Check the unit conversion.', 'rag_wf_ng3'],
      ['The explanation now needs a final read.', 'rag_wf_ng4'],
    ],
  );
  assert.deepEqual(Object.keys(repository).sort(), [
    'append',
    'close',
    'listForTargets',
  ]);
  assert.deepEqual(
    repository
      .listForTargets([
        { questionId: null, side: 'question', uuid: 'uuid-nested' },
      ])
      .map((comment) => comment.comment),
    ['Nested-node feedback.'],
  );
  assert.deepEqual(
    repository.listForTargets([
      { questionId: 'paper:1:1', side: 'question', uuid: 'uuid-nested' },
    ]),
    [],
  );
  repository.close();

  const reloaded = openReviewCommentRepository({
    databasePath,
    migrationsFolder: path.resolve('drizzle'),
  });
  assert.equal(
    reloaded.listForTargets([
      { questionId: 'paper:1:1', side: 'question', uuid: 'uuid-1' },
    ]).length,
    2,
  );
  reloaded.close();
  assert.throws(
    () =>
      reloaded.listForTargets([
        { questionId: 'paper:1:1', side: 'question', uuid: 'uuid-1' },
      ]),
    ReviewDatabaseError,
  );
  rmSync(directory, { force: true, recursive: true });
});

test('rejects a reused submission ID with different immutable content', () => {
  const repository = openReviewCommentRepository({
    databasePath: ':memory:',
    migrationsFolder: path.resolve('drizzle'),
  });
  const input = {
    comment: 'First comment',
    questionId: 'q1',
    ragState: 'rag_wf_g2',
    reviewer: 'up',
    side: 'answer' as const,
    submissionId: 'same-submission',
    uuid: 'uuid-1',
  };
  repository.append(input);
  assert.throws(
    () => repository.append({ ...input, comment: 'Different comment' }),
    ReviewCommentConflictError,
  );
  repository.close();
});

test('reports migration failures as recoverable database errors', () => {
  assert.throws(
    () =>
      openReviewCommentRepository({
        databasePath: ':memory:',
        migrationsFolder: path.join(tmpdir(), 'missing-rtq-migrations'),
      }),
    ReviewDatabaseError,
  );
});

test('returns an appended comment immediately and maps local database failures safely', async () => {
  const target: ReviewTargetDescriptor = {
    collectionId: 'toml',
    nodeId: 's0.q0',
    questionId: null,
    ragState: 'rag_wf_g2',
    relativePath: 'paper.toml',
    sheet: 'G2',
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
    close: () => undefined,
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
