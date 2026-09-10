import {
  isPaperCollectionId,
  readReviewPaper,
  type ReviewPaper,
  type ReviewPaperNode,
} from '@rtq/review-paper-model';

import {
  isReviewOutcome,
  isReviewSheetCode,
  isReviewSide,
  normalizeSourceRag,
  reviewCommentTargetForNode,
  reviewTargetForNode,
  type ReviewCommentTargetDescriptor,
  type ReviewOutcomeSelection,
  type ReviewTargetDescriptor,
} from './review-types.ts';

export class ReviewRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewRequestError';
    this.status = status;
  }
}

export type ReviewMutationRequest = Readonly<{
  reviewer: string;
  target: ReviewTargetDescriptor;
}>;

export type ReviewOutcomeRequest = ReviewMutationRequest &
  Readonly<{ outcome: ReviewOutcomeSelection }>;

export type ReviewCommentRequest = Readonly<{
  comment: string;
  reviewer: string;
  submissionId: string;
  target: ReviewCommentTargetDescriptor;
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewRequestError('The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ReviewRequestError(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new ReviewRequestError(`${label} is too long.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, label);
}

export function validateReviewer(value: unknown): string {
  const reviewer = requiredString(value, 'Reviewer', 64);
  if (!/^[A-Za-z0-9._-]+$/.test(reviewer)) {
    throw new ReviewRequestError(
      'Reviewer may contain only letters, numbers, dots, underscores, and hyphens.',
    );
  }
  return reviewer;
}

export function parseReviewMutationRequest(
  value: unknown,
): ReviewMutationRequest {
  const body = record(value);
  const target = record(body.target);
  const side = target.side;
  if (!isReviewSide(side)) {
    throw new ReviewRequestError('Review side must be question or answer.');
  }
  const sheetValue = target.sheet;
  if (
    sheetValue !== null &&
    sheetValue !== undefined &&
    typeof sheetValue !== 'string'
  ) {
    throw new ReviewRequestError('Sheet must be a string or null.');
  }
  const uuid = requiredString(target.uuid, 'UUID');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid)) {
    throw new ReviewRequestError('UUID has an invalid format.');
  }
  let sheet: ReviewTargetDescriptor['sheet'] = null;
  if (typeof sheetValue === 'string') {
    const candidate = requiredString(sheetValue, 'Sheet', 8).toUpperCase();
    if (!isReviewSheetCode(candidate)) {
      throw new ReviewRequestError('Sheet is not supported.');
    }
    sheet = candidate;
  }
  return {
    reviewer: validateReviewer(body.reviewer),
    target: {
      collectionId: requiredString(target.collectionId, 'Collection'),
      nodeId: requiredString(target.nodeId, 'Node ID'),
      questionId: optionalString(target.questionId, 'Question ID'),
      ragState: normalizeSourceRag(
        requiredString(target.ragState, 'Source RAG state'),
      ),
      relativePath: requiredString(target.relativePath, 'Paper path', 2048),
      sheet,
      side,
      uuid,
    },
  };
}

export function parseReviewOutcomeRequest(
  value: unknown,
): ReviewOutcomeRequest {
  const body = record(value);
  const mutation = parseReviewMutationRequest(body);
  const outcome = body.outcome;
  if (outcome !== null && !isReviewOutcome(outcome)) {
    throw new ReviewRequestError('Review request is not supported.');
  }
  return { ...mutation, outcome };
}

export function parseReviewCommentRequest(
  value: unknown,
): ReviewCommentRequest {
  const body = record(value);
  const targetBody = record(body.target);
  if ('sheet' in targetBody) {
    throw new ReviewRequestError(
      'Sheet routing is not accepted for local comments.',
    );
  }
  const mutation = parseReviewMutationRequest({
    ...body,
    target: { ...targetBody, sheet: null },
  });
  const comment = requiredString(body.comment, 'Comment', 10_000);
  const submissionId = requiredString(body.submissionId, 'Submission ID', 128);
  if (!/^[A-Za-z0-9_-]+$/.test(submissionId)) {
    throw new ReviewRequestError('Submission ID has an invalid format.');
  }
  return {
    comment,
    reviewer: mutation.reviewer,
    submissionId,
    target: {
      collectionId: mutation.target.collectionId,
      nodeId: mutation.target.nodeId,
      questionId: mutation.target.questionId,
      ragState: mutation.target.ragState,
      relativePath: mutation.target.relativePath,
      side: mutation.target.side,
      uuid: mutation.target.uuid,
    },
  };
}

export function assertReviewTargetCurrent(
  requested: ReviewTargetDescriptor,
  current: ReviewTargetDescriptor,
): void {
  const matches =
    requested.collectionId === current.collectionId &&
    requested.relativePath === current.relativePath &&
    requested.nodeId === current.nodeId &&
    requested.questionId === current.questionId &&
    requested.uuid === current.uuid &&
    requested.side === current.side &&
    requested.ragState === current.ragState &&
    requested.sheet === current.sheet;
  if (!matches) {
    throw new ReviewRequestError(
      'The question identity or RAG state changed. Refresh the paper before submitting.',
      409,
    );
  }
}

export function assertReviewCommentTargetCurrent(
  requested: ReviewCommentTargetDescriptor,
  current: ReviewTargetDescriptor,
): void {
  const matches =
    requested.collectionId === current.collectionId &&
    requested.relativePath === current.relativePath &&
    requested.nodeId === current.nodeId &&
    requested.questionId === current.questionId &&
    requested.uuid === current.uuid &&
    requested.side === current.side &&
    requested.ragState === current.ragState;
  if (!matches) {
    throw new ReviewRequestError(
      'The question identity or RAG state changed. Refresh the paper before submitting.',
      409,
    );
  }
}

async function readRequestedPaper(
  requested: ReviewCommentTargetDescriptor,
): Promise<ReviewPaper> {
  if (!isPaperCollectionId(requested.collectionId)) {
    throw new ReviewRequestError(
      'The paper collection is not reviewable.',
      404,
    );
  }
  try {
    return await readReviewPaper(
      requested.collectionId,
      requested.relativePath,
    );
  } catch (error) {
    throw new ReviewRequestError('The selected paper could not be read.', 404, {
      cause: error,
    });
  }
}

function findNode(
  node: ReviewPaperNode,
  nodeId: string,
): ReviewPaperNode | undefined {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const match = findNode(child, nodeId);
    if (match) return match;
  }
  return undefined;
}

function findNodeAndTopLevel(
  paper: ReviewPaper,
  nodeId: string,
): Readonly<{ node: ReviewPaperNode; topLevel: ReviewPaperNode }> | undefined {
  for (const section of paper.sections) {
    for (const topLevel of section.questions) {
      const node = findNode(topLevel, nodeId);
      if (node) return { node, topLevel };
    }
  }
  return undefined;
}

async function resolveCurrentOutcomeTarget(
  requested: ReviewCommentTargetDescriptor,
): Promise<ReviewTargetDescriptor> {
  const paper = await readRequestedPaper(requested);
  const node = paper.sections
    .flatMap((section) => section.questions)
    .find((question) => question.id === requested.nodeId);
  if (!node) {
    throw new ReviewRequestError(
      'The selected top-level question was not found.',
      404,
    );
  }
  const current = reviewTargetForNode(node, requested.side, {
    collectionId: requested.collectionId,
    relativePath: requested.relativePath,
  });
  if (!current) {
    throw new ReviewRequestError(
      'This question does not have the identity and RAG metadata required for review.',
      409,
    );
  }
  return current;
}

async function resolveCurrentCommentTarget(
  requested: ReviewCommentTargetDescriptor,
): Promise<ReviewTargetDescriptor> {
  const paper = await readRequestedPaper(requested);
  return resolveReviewCommentTargetInPaper(paper, requested);
}

export function resolveReviewCommentTargetInPaper(
  paper: ReviewPaper,
  requested: ReviewCommentTargetDescriptor,
): ReviewTargetDescriptor {
  const resolved = findNodeAndTopLevel(paper, requested.nodeId);
  if (!resolved) {
    throw new ReviewRequestError(
      'The selected question node was not found.',
      404,
    );
  }
  const current = reviewCommentTargetForNode(
    resolved.node,
    resolved.topLevel,
    requested.side,
    {
      collectionId: requested.collectionId,
      relativePath: requested.relativePath,
    },
  );
  if (!current) {
    throw new ReviewRequestError(
      'This node does not have its own UUID and inherited top-level RAG metadata required for review.',
      409,
    );
  }
  return current;
}

export async function resolveVerifiedReviewTarget(
  requested: ReviewTargetDescriptor,
): Promise<ReviewTargetDescriptor> {
  const current = await resolveCurrentOutcomeTarget(requested);
  assertReviewTargetCurrent(requested, current);
  return current;
}

export async function resolveVerifiedReviewCommentTarget(
  requested: ReviewCommentTargetDescriptor,
): Promise<ReviewTargetDescriptor> {
  const current = await resolveCurrentCommentTarget(requested);
  assertReviewCommentTargetCurrent(requested, current);
  return current;
}
