import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewPaper } from '@rtq/review-paper-model';
import {
  ReviewDatabaseError,
  type ReviewOutcomeRepository,
  type StoredReviewOutcome,
} from '@rtq/review-store/server';

import { reviewOutcomeDestination } from './review-api-config.ts';
import {
  loadReviewOutcomesForPaper,
  submitReviewOutcome,
} from './review-outcomes.ts';
import type { ReviewOutcomeRequest } from './review-server.ts';
import { REVIEW_OUTCOMES } from './review-types.ts';

const target = {
  collectionId: 'toml',
  nodeId: 's0.q0',
  questionId: 'paper:1:1',
  ragState: 'rag_wf_ng3',
  relativePath: 'paper.toml',
  sheet: 'NG3' as const,
  side: 'question' as const,
  uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
};

function storedOutcome(
  input: ReviewOutcomeRequest & {
    outcome: NonNullable<ReviewOutcomeRequest['outcome']>;
  },
): StoredReviewOutcome {
  return {
    createdAt: '2026-09-09T12:00:00.000Z',
    outcome: input.outcome,
    ragState: input.target.ragState,
    reviewer: input.reviewer,
    side: input.target.side,
    updatedAt: '2026-09-09T12:00:00.000Z',
    uuid: input.target.uuid,
  };
}

function repository() {
  const records = new Map<string, StoredReviewOutcome>();
  const calls = { clear: 0, resolve: 0, set: 0 };
  const key = (value: { ragState: string; side: string; uuid: string }) =>
    JSON.stringify([value.uuid, value.side, value.ragState]);
  const value: ReviewOutcomeRepository = {
    clear(input) {
      calls.clear += 1;
      return records.delete(key(input));
    },
    get(input) {
      return records.get(key(input));
    },
    listAll() {
      return [...records.values()];
    },
    resolve(inputs) {
      calls.resolve += 1;
      return inputs.flatMap((input) => {
        const stored = records.get(key(input));
        return stored ? [stored] : [];
      });
    },
    set(input) {
      calls.set += 1;
      const stored = storedOutcome({
        outcome: input.outcome as NonNullable<ReviewOutcomeRequest['outcome']>,
        reviewer: input.reviewer,
        target: {
          ...target,
          ragState: input.ragState,
          side: input.side,
          uuid: input.uuid,
        },
      });
      records.set(key(input), stored);
      return stored;
    },
  };
  return { calls, records, repository: value };
}

test('selects one explicit outcome destination and defaults to database', () => {
  assert.equal(reviewOutcomeDestination(undefined), 'database');
  assert.equal(reviewOutcomeDestination(' database '), 'database');
  assert.equal(reviewOutcomeDestination('GOOGLE-SHEETS'), 'google-sheets');
  assert.throws(() => reviewOutcomeDestination('both'), /must be/);
});

test('database mode handles every outcome and reset without an API request', async () => {
  const store = repository();
  let fetchCalls = 0;
  for (const outcome of REVIEW_OUTCOMES) {
    const result = await submitReviewOutcome(
      { outcome, reviewer: 'up', target },
      {
        baseUrl: 'http://review.test',
        destination: 'database',
        fetcher: async () => {
          fetchCalls += 1;
          throw new Error('Google Sheets must not run in database mode.');
        },
        repository: store.repository,
      },
    );
    assert.equal(result.status, 200);
  }
  assert.equal(fetchCalls, 0);
  await submitReviewOutcome(
    {
      outcome: 'PRR',
      reviewer: 'wf',
      target: { ...target, side: 'answer' },
    },
    {
      baseUrl: 'http://review.test',
      destination: 'database',
      repository: store.repository,
    },
  );
  await submitReviewOutcome(
    {
      outcome: 'PRG',
      reviewer: 'ap',
      target: { ...target, ragState: 'rag_wf_ng2' },
    },
    {
      baseUrl: 'http://review.test',
      destination: 'database',
      repository: store.repository,
    },
  );
  assert.equal(store.calls.set, REVIEW_OUTCOMES.length + 2);
  assert.equal(store.records.size, 3);
  assert.equal(store.repository.get(target)?.outcome, REVIEW_OUTCOMES.at(-1));
  assert.equal(
    store.repository.get({ ...target, side: 'answer' })?.outcome,
    'PRR',
  );
  assert.equal(
    store.repository.get({ ...target, ragState: 'rag_wf_ng2' })?.outcome,
    'PRG',
  );

  const reset = await submitReviewOutcome(
    { outcome: null, reviewer: 'up', target },
    {
      baseUrl: 'http://review.test',
      destination: 'database',
      repository: store.repository,
    },
  );
  assert.equal(reset.status, 200);
  assert.equal(store.calls.clear, 1);
  assert.equal(store.records.size, 2);
  assert.equal(
    store.repository.get({ ...target, side: 'answer' })?.outcome,
    'PRR',
  );
  assert.equal(
    store.repository.get({ ...target, ragState: 'rag_wf_ng2' })?.outcome,
    'PRG',
  );
});

test('Google Sheets mode forwards exclusively and does not access the repository', async () => {
  const store = repository();
  let fetchCalls = 0;
  const result = await submitReviewOutcome(
    { outcome: 'PRG', reviewer: 'up', target },
    {
      baseUrl: 'http://review.test',
      destination: 'google-sheets',
      fetcher: async () => {
        fetchCalls += 1;
        return Response.json({ status: 'success' });
      },
      repository: store.repository,
    },
  );
  assert.equal(result.status, 200);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(store.calls, { clear: 0, resolve: 0, set: 0 });
});

test('reload resolves only current question and answer state in database mode', () => {
  const store = repository();
  store.repository.set({
    outcome: 'PRG',
    ragState: target.ragState,
    reviewer: 'up',
    side: 'question',
    uuid: target.uuid,
  });
  store.repository.set({
    outcome: 'PRR',
    ragState: 'rag_wf_ng2',
    reviewer: 'up',
    side: 'answer',
    uuid: target.uuid,
  });
  const paper = {
    sections: [
      {
        questions: [
          {
            depth: 0,
            id: target.nodeId,
            questionId: target.questionId,
            review: {
              answer: { contentRag: target.ragState },
              question: { contentRag: target.ragState },
            },
            uuid: target.uuid,
          },
        ],
      },
    ],
    source: {
      collection: { id: target.collectionId },
      relativePath: target.relativePath,
    },
  } as unknown as ReviewPaper;

  const loaded = loadReviewOutcomesForPaper(paper, 'database', {
    repository: store.repository,
  });
  assert.equal(loaded.error, undefined);
  assert.deepEqual(loaded.outcomes, {
    [`${target.uuid}:question`]: 'PRG',
  });
  assert.equal(store.calls.resolve, 1);

  const sheets = loadReviewOutcomesForPaper(paper, 'google-sheets', {
    repository: store.repository,
  });
  assert.deepEqual(sheets, { destination: 'google-sheets', outcomes: {} });
  assert.equal(store.calls.resolve, 1);
});

test('database failures are safe and do not fall back to Google Sheets', async () => {
  const store = repository();
  const unavailable = {
    ...store.repository,
    set: () => {
      throw new ReviewDatabaseError('private database detail');
    },
  };
  let fetchCalls = 0;
  const result = await submitReviewOutcome(
    { outcome: 'PRG', reviewer: 'up', target },
    {
      baseUrl: 'http://review.test',
      destination: 'database',
      fetcher: async () => {
        fetchCalls += 1;
        return Response.json({ status: 'success' });
      },
      repository: unavailable,
    },
  );
  assert.deepEqual(result, {
    message: 'The review database is unavailable.',
    status: 503,
  });
  assert.equal(fetchCalls, 0);
});
