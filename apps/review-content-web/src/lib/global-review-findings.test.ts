import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ReviewDatabaseError,
  type GlobalReviewFinding,
  type GlobalReviewFindingRepository,
} from '@rtq/review-store/server';

import {
  appendVerifiedGlobalReviewFinding,
  listTodoGlobalReviewFindings,
  processGlobalReviewFinding,
} from './global-review-findings.ts';
import { ReviewRequestError } from './review-server.ts';

const finding: GlobalReviewFinding = {
  createdAt: '2026-09-12T08:00:00.000Z',
  finding: 'Apply this naming rule everywhere.',
  id: 'd8ae66c1-9ab8-4c7f-a023-1c17b53237cf',
  processedAt: null,
  processedBy: null,
  reviewer: 'up',
  sourceCollectionId: 'toml',
  sourceNodeId: 's0.q0',
  sourceNodeLabel: 'Question 2',
  sourceNodeUuid: null,
  sourcePaperTitle: 'Practice paper',
  sourceRelativePath: 'paper.toml',
  sourceSide: 'answer',
  sourceVersion: 'source-version-1',
  status: 'todo',
  submissionId: 'finding-submission-1',
};

function repository(
  overrides: Partial<GlobalReviewFindingRepository> = {},
): GlobalReviewFindingRepository {
  return {
    append: () => ({ created: true, finding }),
    listTodo: () => [finding],
    markProcessed: () => ({
      changed: true,
      finding: {
        ...finding,
        processedAt: '2026-09-12T09:00:00.000Z',
        processedBy: 'roadmap-owner',
        status: 'processed',
      },
    }),
    ...overrides,
  };
}

test('stores a verified global finding and exposes only the consumer operations', async () => {
  let appended:
    Parameters<GlobalReviewFindingRepository['append']>[0] | undefined;
  const source = {
    collectionId: 'toml',
    nodeId: 's0.q0',
    relativePath: 'paper.toml',
    side: 'answer' as const,
    sourceVersion: 'source-version-1',
  };
  const result = await appendVerifiedGlobalReviewFinding(
    {
      finding: finding.finding,
      reviewer: finding.reviewer,
      source,
      submissionId: finding.submissionId,
    },
    {
      repository: repository({
        append: (input) => {
          appended = input;
          return { created: true, finding };
        },
      }),
      resolveSource: async () => ({
        sourceCollectionId: finding.sourceCollectionId,
        sourceNodeId: finding.sourceNodeId,
        sourceNodeLabel: finding.sourceNodeLabel,
        sourceNodeUuid: finding.sourceNodeUuid,
        sourcePaperTitle: finding.sourcePaperTitle,
        sourceRelativePath: finding.sourceRelativePath,
        sourceSide: finding.sourceSide,
        sourceVersion: finding.sourceVersion,
      }),
    },
  );

  assert.equal(result.created, true);
  assert.deepEqual(appended, {
    finding: finding.finding,
    reviewer: finding.reviewer,
    sourceCollectionId: finding.sourceCollectionId,
    sourceNodeId: finding.sourceNodeId,
    sourceNodeLabel: finding.sourceNodeLabel,
    sourceNodeUuid: finding.sourceNodeUuid,
    sourcePaperTitle: finding.sourcePaperTitle,
    sourceRelativePath: finding.sourceRelativePath,
    sourceSide: finding.sourceSide,
    sourceVersion: finding.sourceVersion,
    submissionId: finding.submissionId,
  });
  assert.deepEqual(listTodoGlobalReviewFindings({ repository: repository() }), [
    finding,
  ]);
  assert.equal(
    processGlobalReviewFinding(
      { id: finding.id, processedBy: 'roadmap-owner' },
      { repository: repository() },
    ).finding.status,
    'processed',
  );
});

test('maps unavailable storage and missing findings to safe API errors', async () => {
  const unavailable = repository({
    append: () => {
      throw new ReviewDatabaseError('private SQL detail');
    },
  });
  await assert.rejects(
    appendVerifiedGlobalReviewFinding(
      {
        finding: finding.finding,
        reviewer: finding.reviewer,
        source: {
          collectionId: finding.sourceCollectionId,
          nodeId: finding.sourceNodeId,
          relativePath: finding.sourceRelativePath,
          side: finding.sourceSide,
          sourceVersion: finding.sourceVersion,
        },
        submissionId: finding.submissionId,
      },
      {
        repository: unavailable,
        resolveSource: async () => finding,
      },
    ),
    (error: unknown) =>
      error instanceof ReviewRequestError &&
      error.status === 503 &&
      !error.message.includes('SQL'),
  );
  assert.throws(
    () =>
      processGlobalReviewFinding(
        { id: finding.id, processedBy: 'roadmap-owner' },
        { repository: repository({ markProcessed: () => undefined }) },
      ),
    (error: unknown) =>
      error instanceof ReviewRequestError && error.status === 404,
  );
});
