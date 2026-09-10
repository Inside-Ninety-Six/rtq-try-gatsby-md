import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_REVIEW_OUTCOMES,
  ReviewOutcomeRequestError,
  isReviewOutcomeAction,
  isReviewOutcomeSelection,
  parseReviewOutcomeRequestBody,
} from './review-outcomes.ts';

test('guards both question and answer submission routes', () => {
  assert.equal(isReviewOutcomeAction('question-rag'), true);
  assert.equal(isReviewOutcomeAction('rag'), true);
  assert.equal(isReviewOutcomeAction('comments'), false);
});

test('accepts every canonical review outcome and Reset', () => {
  for (const outcome of CANONICAL_REVIEW_OUTCOMES) {
    assert.equal(isReviewOutcomeSelection(outcome), true);
    assert.deepEqual(
      JSON.parse(
        parseReviewOutcomeRequestBody(
          JSON.stringify({
            rag: outcome,
            uuid: 'uuid-1',
          }),
        ),
      ),
      { rag: outcome, uuid: 'uuid-1' },
    );
  }
  assert.equal(isReviewOutcomeSelection(''), true);
  assert.deepEqual(
    JSON.parse(parseReviewOutcomeRequestBody('{"rag":"","uuid":"uuid-1"}')),
    { rag: '', uuid: 'uuid-1' },
  );
});

test('rejects every retired review outcome before forwarding', () => {
  for (const retired of [
    'PRG2',
    'PRPCC',
    'PRR',
    'PRA',
    'PRPCR',
    'PRRL',
    'PRCT',
  ]) {
    assert.equal(isReviewOutcomeSelection(retired), false);
    assert.throws(
      () => parseReviewOutcomeRequestBody(JSON.stringify({ rag: retired })),
      ReviewOutcomeRequestError,
    );
  }
});

test('rejects missing, malformed, and non-string outcomes', () => {
  for (const body of ['not-json', '[]', '{}', '{"rag":null}']) {
    assert.throws(
      () => parseReviewOutcomeRequestBody(body),
      ReviewOutcomeRequestError,
    );
  }
});
