import assert from 'node:assert/strict';
import test from 'node:test';

import { forwardReviewOutcome } from './review-outcomes.ts';
import { reviewCommentIdentitiesForPaper } from './review-comments.ts';
import {
  assertReviewCommentTargetCurrent,
  assertReviewTargetCurrent,
  parseReviewCommentRequest,
  parseReviewOutcomeRequest,
  resolveReviewCommentTargetInPaper,
  ReviewRequestError,
} from './review-server.ts';
import {
  REVIEW_OUTCOMES,
  normalizeSourceRag,
  partitionReviewComments,
  reviewCommentTargetForNode,
  runUniqueReviewRequest,
  sheetCodeFromSourceRag,
  type ReviewTargetDescriptor,
} from './review-types.ts';
import type { ReviewPaper, ReviewPaperNode } from '@rtq/review-paper-model';

const target: ReviewTargetDescriptor = {
  collectionId: 'toml',
  nodeId: 's0.q0',
  questionId: 'paper:1:1',
  ragState: 'rag_wf_ng3',
  relativePath: 'paper.toml',
  sheet: 'NG3',
  side: 'question',
  uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
};

const commentTarget = {
  collectionId: target.collectionId,
  nodeId: target.nodeId,
  questionId: target.questionId,
  ragState: target.ragState,
  relativePath: target.relativePath,
  side: target.side,
  uuid: target.uuid,
};

test('normalizes source states and derives only supported sheet routes', () => {
  assert.equal(normalizeSourceRag('NG-4'), 'rag_wf_ng4');
  assert.equal(normalizeSourceRag('rag_wf_notstarted'), 'rag_wf_notstarted');
  assert.equal(sheetCodeFromSourceRag('rag_wf_notstarted'), 'NS');
  assert.equal(sheetCodeFromSourceRag('RAG_WF_G0'), 'G0');
  assert.equal(sheetCodeFromSourceRag('rag_wf_ng0'), 'NG0');
  assert.equal(sheetCodeFromSourceRag('rag_wf_ng8'), 'NG8');
  assert.equal(sheetCodeFromSourceRag('rag_wf_blocked'), null);
  assert.equal(sheetCodeFromSourceRag('rag_wf_g4'), null);
  assert.equal(sheetCodeFromSourceRag('rag_wf_green'), null);
});

test('partitions current and historical comments by exact side and state', () => {
  const comments = [
    {
      comment: 'New state',
      createdAt: '2026-09-06T10:00:00.000Z',
      id: 'c2',
      questionId: 'paper:1:1',
      ragState: 'rag_wf_ng4',
      reviewer: 'up',
      side: 'question' as const,
      submissionId: 's2',
      uuid: target.uuid,
    },
    {
      comment: 'Current state',
      createdAt: '2026-09-06T09:00:00.000Z',
      id: 'c1',
      questionId: 'paper:1:1',
      ragState: 'rag_wf_ng3',
      reviewer: 'wf',
      side: 'question' as const,
      submissionId: 's1',
      uuid: target.uuid,
    },
    {
      comment: 'Latest current-state feedback',
      createdAt: '2026-09-06T11:00:00.000Z',
      id: 'c3',
      questionId: 'paper:1:1',
      ragState: 'rag_wf_ng3',
      reviewer: 'ap',
      side: 'question' as const,
      submissionId: 's3',
      uuid: target.uuid,
    },
    {
      comment: 'Older previous-state feedback',
      createdAt: '2026-09-06T07:00:00.000Z',
      id: 'c4',
      questionId: 'paper:1:1',
      ragState: 'rag_wf_ng2',
      reviewer: 'ap',
      side: 'question' as const,
      submissionId: 's4',
      uuid: target.uuid,
    },
    {
      comment: 'Other side',
      createdAt: '2026-09-06T08:00:00.000Z',
      id: 'c0',
      questionId: 'paper:1:1',
      ragState: 'rag_wf_ng3',
      reviewer: 'wf',
      side: 'answer' as const,
      submissionId: 's0',
      uuid: target.uuid,
    },
    {
      comment: 'Other question identity',
      createdAt: '2026-09-06T08:30:00.000Z',
      id: 'c00',
      questionId: 'paper:1:2',
      ragState: 'rag_wf_ng3',
      reviewer: 'wf',
      side: 'question' as const,
      submissionId: 's00',
      uuid: target.uuid,
    },
  ];
  const groups = partitionReviewComments(comments, target);
  assert.deepEqual(
    groups.current.map((comment) => comment.id),
    ['c3', 'c1'],
  );
  assert.deepEqual(
    groups.history.map((comment) => comment.id),
    ['c2', 'c4'],
  );
});

test('uses each nested node UUID and only inherits RAG from its top-level question', () => {
  const topLevel = {
    depth: 0,
    review: {
      answer: { contentRag: 'rag_wf_g0' },
      question: { contentRag: 'rag_wf_ng3' },
    },
    uuid: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  } as ReviewPaperNode;
  const nested = {
    depth: 1,
    id: 's0.q0.sq0',
    review: {
      answer: { contentRag: 'rag_wf_notstarted' },
      question: { contentRag: 'rag_wf_notstarted' },
    },
    uuid: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  } as ReviewPaperNode;

  const questionTarget = reviewCommentTargetForNode(
    nested,
    topLevel,
    'question',
    { collectionId: 'toml', relativePath: 'paper.toml' },
  );
  const answerTarget = reviewCommentTargetForNode(nested, topLevel, 'answer', {
    collectionId: 'toml',
    relativePath: 'paper.toml',
  });

  assert.equal(questionTarget?.uuid, nested.uuid);
  assert.equal(questionTarget?.questionId, null);
  assert.equal(questionTarget?.ragState, 'rag_wf_ng3');
  assert.equal(answerTarget?.uuid, nested.uuid);
  assert.equal(answerTarget?.ragState, 'rag_wf_g0');
  assert.equal(questionTarget?.sheet, null);
});

test('recursively resolves a nested comment target within its top-level RAG context', () => {
  const nested = {
    children: [],
    depth: 2,
    id: 's0.q0.sq0.ssq0',
    review: { answer: {}, question: {} },
    uuid: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
  } as unknown as ReviewPaperNode;
  const subquestion = {
    children: [nested],
    depth: 1,
    id: 's0.q0.sq0',
    review: { answer: {}, question: {} },
    uuid: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
  } as unknown as ReviewPaperNode;
  const topLevel = {
    children: [subquestion],
    depth: 0,
    id: 's0.q0',
    review: {
      answer: { contentRag: 'rag_wf_g0' },
      question: { contentRag: 'rag_wf_ng3' },
    },
    uuid: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
  } as unknown as ReviewPaperNode;
  const paper = {
    sections: [{ questions: [topLevel] }],
    source: {
      collection: { id: 'toml' },
      relativePath: 'paper.toml',
    },
  } as unknown as ReviewPaper;
  const requested = {
    collectionId: 'toml',
    nodeId: nested.id,
    questionId: null,
    ragState: 'rag_wf_ng3',
    relativePath: 'paper.toml',
    side: 'question' as const,
    uuid: nested.uuid!,
  };

  const current = resolveReviewCommentTargetInPaper(paper, requested);
  assert.equal(current.uuid, nested.uuid);
  assert.equal(current.questionId, null);
  assert.equal(current.ragState, topLevel.review.question.contentRag);
  assert.deepEqual(
    reviewCommentIdentitiesForPaper(paper).map((identity) => [
      identity.uuid,
      identity.side,
    ]),
    [
      [topLevel.uuid, 'question'],
      [topLevel.uuid, 'answer'],
      [subquestion.uuid, 'question'],
      [subquestion.uuid, 'answer'],
      [nested.uuid, 'question'],
      [nested.uuid, 'answer'],
    ],
  );
  assert.throws(
    () =>
      assertReviewCommentTargetCurrent(
        { ...requested, ragState: 'rag_wf_ng4' },
        current,
      ),
    (error: unknown) =>
      error instanceof ReviewRequestError && error.status === 409,
  );
});

test('prevents duplicate active submissions and releases the scope afterward', async () => {
  const active = new Set<string>();
  const snapshots: string[][] = [];
  let release: (() => void) | undefined;
  const request = runUniqueReviewRequest(
    active,
    'uuid:question:comment',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    (values) => snapshots.push([...values]),
  );
  await assert.rejects(
    runUniqueReviewRequest(
      active,
      'uuid:question:comment',
      async () => undefined,
      () => undefined,
    ),
    /already in progress/,
  );
  release?.();
  await request;
  assert.deepEqual(snapshots, [['uuid:question:comment'], []]);
  assert.equal(active.size, 0);
});

test('accepts every API outcome and rejects malformed mutation input', () => {
  for (const outcome of REVIEW_OUTCOMES) {
    assert.equal(
      parseReviewOutcomeRequest({ outcome, reviewer: 'up', target }).outcome,
      outcome,
    );
  }
  assert.equal(
    parseReviewOutcomeRequest({ outcome: null, reviewer: 'up', target })
      .outcome,
    null,
  );
  assert.throws(
    () => parseReviewOutcomeRequest({ outcome: '', reviewer: 'up', target }),
    ReviewRequestError,
  );
  assert.throws(
    () =>
      parseReviewOutcomeRequest({
        outcome: 'MADE_UP',
        reviewer: 'up',
        target,
      }),
    ReviewRequestError,
  );
  assert.throws(
    () =>
      parseReviewOutcomeRequest({
        outcome: 'PRG',
        reviewer: 'up',
        target: { ...target, sheet: 'OTHER' },
      }),
    ReviewRequestError,
  );
  assert.throws(
    () =>
      parseReviewOutcomeRequest({
        outcome: 'PRG',
        reviewer: 'up',
        target: { ...target, uuid: 'not-a-uuid' },
      }),
    ReviewRequestError,
  );
  assert.equal(
    parseReviewOutcomeRequest({
      outcome: 'PRG',
      reviewer: 'up',
      target: { ...target, questionId: null },
    }).target.questionId,
    null,
  );
  assert.equal(
    'sheet' in
      parseReviewCommentRequest({
        comment: 'Valid local feedback',
        reviewer: 'up',
        submissionId: 'submission-1',
        target: commentTarget,
      }).target,
    false,
  );
  assert.equal(
    parseReviewCommentRequest({
      comment: 'Valid local feedback',
      reviewer: 'up',
      submissionId: 'submission-1',
      target: { ...commentTarget, questionId: null },
    }).target.questionId,
    null,
  );
  assert.throws(
    () =>
      parseReviewOutcomeRequest({
        outcome: 'PRG',
        reviewer: 'Uday Patel',
        target,
      }),
    ReviewRequestError,
  );
  assert.throws(
    () =>
      parseReviewCommentRequest({
        comment: '   ',
        reviewer: 'up',
        submissionId: 'submission-1',
        target: commentTarget,
      }),
    ReviewRequestError,
  );
  assert.throws(
    () =>
      parseReviewCommentRequest({
        comment: 'Valid local feedback',
        reviewer: 'up',
        submissionId: 'submission-1',
        target,
      }),
    ReviewRequestError,
  );
});

test('rejects stale or spoofed target identity and state snapshots', () => {
  for (const changed of [
    { questionId: 'other-question' },
    { uuid: 'other-uuid' },
    { side: 'answer' as const },
    { ragState: 'rag_wf_ng4' },
    { sheet: 'NG4' },
  ] as const) {
    assert.throws(
      () => assertReviewTargetCurrent({ ...target, ...changed }, target),
      (error: unknown) =>
        error instanceof ReviewRequestError && error.status === 409,
    );
  }
  assert.throws(
    () =>
      assertReviewCommentTargetCurrent(
        { ...commentTarget, uuid: 'other-uuid' },
        target,
      ),
    (error: unknown) =>
      error instanceof ReviewRequestError && error.status === 409,
  );
});

test('maps question and answer outcomes and forwards only API-required fields', async () => {
  const requests: Array<{ body: unknown; url: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({
      body: JSON.parse(String(init?.body)),
      url: String(input),
    });
    return Response.json({ status: 'success' });
  };
  for (const outcome of REVIEW_OUTCOMES) {
    await forwardReviewOutcome(
      { outcome, reviewer: 'up', target },
      { baseUrl: 'http://review.test/', fetcher },
    );
  }
  await forwardReviewOutcome(
    {
      outcome: 'PRR',
      reviewer: 'wf',
      target: { ...target, side: 'answer' },
    },
    { baseUrl: 'http://review.test', fetcher },
  );
  const reset = await forwardReviewOutcome(
    { outcome: null, reviewer: 'ap', target },
    { baseUrl: 'http://review.test', fetcher },
  );
  assert.deepEqual(
    requests.slice(0, REVIEW_OUTCOMES.length).map((request) => request.url),
    REVIEW_OUTCOMES.map(() => 'http://review.test/questionrag'),
  );
  assert.deepEqual(
    requests.slice(0, REVIEW_OUTCOMES.length).map((request) => request.body),
    REVIEW_OUTCOMES.map((outcome) => ({
      rag: outcome,
      reviewer: 'up',
      sheet: 'NG3',
      uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
    })),
  );
  assert.deepEqual(requests.at(-1), {
    body: {
      rag: '',
      reviewer: 'ap',
      sheet: 'NG3',
      uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
    },
    url: 'http://review.test/questionrag',
  });
  assert.deepEqual(requests.at(-2), {
    body: {
      rag: 'PRR',
      reviewer: 'wf',
      sheet: 'NG3',
      uuid: 'D8AE66C1-9AB8-4C7F-A023-1C17B53237CF',
    },
    url: 'http://review.test/rag',
  });
  assert.equal(reset.message, 'Review outcome reset in Google Sheets.');
});

test('returns safe upstream and connection failures', async () => {
  const noRoute = await forwardReviewOutcome(
    { outcome: 'PRG', reviewer: 'up', target: { ...target, sheet: null } },
    {
      baseUrl: 'http://review.test',
      fetcher: async () => {
        throw new Error('Fetcher must not run without sheet routing.');
      },
    },
  );
  assert.deepEqual(noRoute, {
    message: 'No Google Sheets route is available.',
    status: 409,
  });
  const upstream = await forwardReviewOutcome(
    { outcome: 'PRG', reviewer: 'up', target },
    {
      baseUrl: 'http://review.test',
      fetcher: async () =>
        new Response('<html>secret error</html>', { status: 500 }),
    },
  );
  assert.deepEqual(upstream, {
    message: 'The review service rejected the outcome.',
    status: 500,
  });
  const unavailable = await forwardReviewOutcome(
    { outcome: 'PRG', reviewer: 'up', target },
    {
      baseUrl: 'http://review.test',
      fetcher: async () => {
        throw new Error('/private/path/credential');
      },
    },
  );
  assert.deepEqual(unavailable, {
    message: 'The local review API could not be reached.',
    status: 502,
  });
});
