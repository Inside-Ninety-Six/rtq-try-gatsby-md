import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_REVIEW_PREFERENCES,
  INITIAL_REVIEW_PREFERENCES_KEY,
  LEGACY_REVIEW_PREFERENCES_KEY,
  REVIEW_PREFERENCES_KEY,
  adjacentQuestionId,
  collectionRoute,
  paperRoute,
  parseReviewPreferences,
  reviewStateLabel,
  visibleReviewSides,
} from './review-view-model.ts';

test('display preference storage is versioned for review control mode', () => {
  assert.equal(REVIEW_PREFERENCES_KEY, 'rtq.review-content.preferences.v3');
  assert.equal(
    LEGACY_REVIEW_PREFERENCES_KEY,
    'rtq.review-content.preferences.v2',
  );
  assert.equal(
    INITIAL_REVIEW_PREFERENCES_KEY,
    'rtq.review-content.preferences.v1',
  );
});

test('preferences survive partial and malformed local values', () => {
  assert.deepEqual(parseReviewPreferences(null), DEFAULT_REVIEW_PREFERENCES);
  assert.deepEqual(
    parseReviewPreferences('{broken'),
    DEFAULT_REVIEW_PREFERENCES,
  );
  assert.deepEqual(parseReviewPreferences('{"showRaw":true}'), {
    ...DEFAULT_REVIEW_PREFERENCES,
    showRaw: true,
  });
});

test('preferences migrate the former combined review visibility', () => {
  assert.deepEqual(
    parseReviewPreferences(null, '{"showReview":false,"showRaw":true}'),
    {
      ...DEFAULT_REVIEW_PREFERENCES,
      showAnswerReview: false,
      showQuestionReview: false,
      showRaw: true,
    },
  );
  assert.deepEqual(
    parseReviewPreferences(
      '{"showAnswerReview":true,"showQuestionReview":false}',
      '{"showReview":true}',
    ),
    {
      ...DEFAULT_REVIEW_PREFERENCES,
      showAnswerReview: true,
      showQuestionReview: false,
    },
  );
});

test('review controls default to simple and preserve an advanced selection', () => {
  assert.equal(parseReviewPreferences(null).reviewControlMode, 'simple');
  assert.equal(
    parseReviewPreferences('{"reviewControlMode":"advanced"}')
      .reviewControlMode,
    'advanced',
  );
  assert.equal(
    parseReviewPreferences(
      null,
      '{"reviewControlMode":"advanced"}',
      '{"showReview":false}',
    ).reviewControlMode,
    'advanced',
  );
});

test('review sides support both, question-only, answer-only, and neither', () => {
  assert.deepEqual(visibleReviewSides(DEFAULT_REVIEW_PREFERENCES), [
    'question',
    'answer',
  ]);
  assert.deepEqual(
    visibleReviewSides({
      ...DEFAULT_REVIEW_PREFERENCES,
      showAnswerReview: false,
    }),
    ['question'],
  );
  assert.deepEqual(
    visibleReviewSides({
      ...DEFAULT_REVIEW_PREFERENCES,
      showQuestionReview: false,
    }),
    ['answer'],
  );
  assert.deepEqual(
    visibleReviewSides({
      ...DEFAULT_REVIEW_PREFERENCES,
      showAnswerReview: false,
      showQuestionReview: false,
    }),
    [],
  );
});

test('matching-question navigation stops at either end', () => {
  const ids = ['q1', 'q2', 'q3'];
  assert.equal(adjacentQuestionId(ids, undefined, 1), 'q1');
  assert.equal(adjacentQuestionId(ids, undefined, -1), 'q3');
  assert.equal(adjacentQuestionId(ids, 'q2', 1), 'q3');
  assert.equal(adjacentQuestionId(ids, 'q1', -1), undefined);
  assert.equal(adjacentQuestionId(ids, 'q3', 1), undefined);
});

test('paper routes encode collection and every source-relative segment', () => {
  assert.equal(
    paperRoute('topicToml', 'nested/a paper.toml'),
    '/papers/topicToml/nested/a%20paper.toml',
  );
  assert.equal(
    paperRoute('topicToml', 'nested/a paper.toml', 'subtraction facts'),
    '/papers/topicToml/nested/a%20paper.toml?q=subtraction%20facts',
  );
});

test('collection routes encode the collection identifier', () => {
  assert.equal(collectionRoute('focusToml'), '/papers/focusToml');
  assert.equal(collectionRoute('focus papers'), '/papers/focus%20papers');
  assert.equal(
    collectionRoute('topicToml', 'subtraction facts'),
    '/papers/topicToml?q=subtraction%20facts',
  );
});

test('rack states have compact reviewer-facing labels', () => {
  assert.equal(reviewStateLabel('rag_wf_ng4'), 'NG4');
  assert.equal(reviewStateLabel('rag_ng2'), 'NG2');
  assert.equal(reviewStateLabel('editorial_hold'), 'EDITORIAL HOLD');
});
