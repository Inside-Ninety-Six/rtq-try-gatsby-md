import {
  PENDING_REVIEW_OUTCOME,
  type ReviewPaperNode,
} from '@rtq/review-paper-model/client';
import type { LocalReviewComment, ReviewSide } from '@rtq/review-store/types';

export type {
  LocalReviewComment,
  ReviewSide,
  ReviewTargetIdentity,
} from '@rtq/review-store/types';

export const REVIEW_OUTCOMES = ['PRG', 'PRCR', 'PRCC', 'PRBD', 'PRCS'] as const;

export const REVIEW_SHEET_CODES = [
  'NS',
  'G0',
  'NG0',
  'NG1',
  'NG2',
  'NG3',
  'NG4',
  'NG5',
  'NG6',
  'NG7',
  'NG8',
] as const;

export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const REVIEW_OUTCOME_OPTIONS = [
  {
    actionLabel: 'Looks good',
    label: 'Approved',
    outcome: 'PRG',
    tone: 'approved',
  },
  {
    actionLabel: 'Make a change',
    label: 'Change Requested',
    outcome: 'PRCR',
    tone: 'change-requested',
  },
  {
    actionLabel: 'Change Complete',
    label: 'Change Complete',
    outcome: 'PRCC',
    tone: 'change-complete',
  },
  {
    actionLabel: 'Block it',
    label: 'Marked Blocked',
    outcome: 'PRBD',
    tone: 'blocked',
  },
  {
    actionLabel: 'Coming Soon',
    label: 'Coming Soon',
    outcome: 'PRCS',
    tone: 'coming-soon',
  },
] as const satisfies readonly {
  actionLabel: string;
  label: string;
  outcome: ReviewOutcome;
  tone: string;
}[];

export const SIMPLE_REVIEW_OUTCOME_OPTIONS = REVIEW_OUTCOME_OPTIONS.filter(
  ({ outcome }) => outcome === 'PRG' || outcome === 'PRCR',
);

export type ReviewOutcomeSelection = ReviewOutcome | null;
export type ReviewOutcomeDestination = 'database' | 'google-sheets';
export type ReviewOutcomeLoad = Readonly<{
  destination: ReviewOutcomeDestination;
  error?: string;
  outcomes: Readonly<Record<string, ReviewOutcomeSelection>>;
}>;
export type ReviewSheetCode = (typeof REVIEW_SHEET_CODES)[number];
export type ReviewTargetDescriptor = Readonly<{
  collectionId: string;
  nodeId: string;
  questionId: string | null;
  ragState: string;
  relativePath: string;
  sheet: ReviewSheetCode | null;
  side: ReviewSide;
  uuid: string;
}>;

export type ReviewCommentTargetDescriptor = Omit<
  ReviewTargetDescriptor,
  'sheet'
>;

export type ReviewCommentLoad = Readonly<{
  comments: readonly LocalReviewComment[];
  error?: string;
}>;

export function isReviewOutcome(value: unknown): value is ReviewOutcome {
  return (
    typeof value === 'string' &&
    (REVIEW_OUTCOMES as readonly string[]).includes(value)
  );
}

export function reviewOutcomeLabel(outcome: ReviewOutcome): string {
  return REVIEW_OUTCOME_OPTIONS.find((option) => option.outcome === outcome)!
    .label;
}

export function reviewOutcomeFilterLabel(value: string): string {
  if (value === PENDING_REVIEW_OUTCOME) return 'Pending';
  if (!isReviewOutcome(value)) return value;
  const labels: Readonly<Record<ReviewOutcome, string>> = {
    PRBD: 'Blocked',
    PRCC: 'Ready For Review',
    PRCR: 'Reviewed (Comments)',
    PRCS: 'Coming Soon',
    PRG: 'Approved',
  };
  return labels[value];
}

export function reviewOutcomeTone(
  value: ReviewOutcome,
): (typeof REVIEW_OUTCOME_OPTIONS)[number]['tone'] {
  return REVIEW_OUTCOME_OPTIONS.find((option) => option.outcome === value)!
    .tone;
}

export function displayedReviewOutcome(
  node: ReviewPaperNode,
  side: ReviewSide,
  source: Readonly<{ collectionId: string; relativePath: string }>,
  destination: ReviewOutcomeDestination,
  overrides: Readonly<Record<string, ReviewOutcomeSelection>>,
): ReviewOutcomeSelection | undefined {
  const target = reviewTargetForNode(node, side, source);
  if (!target) return undefined;
  const key = reviewTargetKey(target);
  if (Object.hasOwn(overrides, key)) return overrides[key];
  const sourceOutcome = node.review[side].reviewOutcome;
  return destination === 'google-sheets' && isReviewOutcome(sourceOutcome)
    ? sourceOutcome
    : undefined;
}

export function isReviewSide(value: unknown): value is ReviewSide {
  return value === 'answer' || value === 'question';
}

export function isReviewSheetCode(value: unknown): value is ReviewSheetCode {
  return (
    typeof value === 'string' &&
    (REVIEW_SHEET_CODES as readonly string[]).includes(value)
  );
}

export function normalizeSourceRag(value: string): string {
  const state = value
    .trim()
    .toLowerCase()
    .replace(/^rag_wf_/, '')
    .replace(/^rag_/, '')
    .replaceAll(/[\s_-]+/g, '');
  return state ? `rag_wf_${state}` : '';
}

export function sheetCodeFromSourceRag(value: string): ReviewSheetCode | null {
  const state = normalizeSourceRag(value).slice('rag_wf_'.length);
  if (state === 'notstarted' || state === 'ns') return 'NS';
  if (state === 'g0' || /^ng[0-8]$/.test(state)) {
    const sheet = state.toUpperCase();
    return isReviewSheetCode(sheet) ? sheet : null;
  }
  return null;
}

export function reviewTargetKey(
  target: Readonly<{ side: ReviewSide; uuid: string }>,
): string {
  return `${target.uuid}:${target.side}`;
}

export async function runUniqueReviewRequest<Result>(
  active: Set<string>,
  key: string,
  request: () => Promise<Result>,
  onChange: (active: ReadonlySet<string>) => void,
): Promise<Result> {
  if (active.has(key)) {
    throw new Error('That review request is already in progress.');
  }
  active.add(key);
  onChange(new Set(active));
  try {
    return await request();
  } finally {
    active.delete(key);
    onChange(new Set(active));
  }
}

export function partitionReviewComments(
  comments: readonly LocalReviewComment[],
  target: ReviewTargetDescriptor,
): Readonly<{
  current: readonly LocalReviewComment[];
  history: readonly LocalReviewComment[];
}> {
  const matching = comments
    .filter(
      (comment) =>
        comment.questionId === target.questionId &&
        reviewTargetKey(comment) === reviewTargetKey(target),
    )
    .toSorted(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
  return {
    current: matching.filter((comment) => comment.ragState === target.ragState),
    history: matching.filter((comment) => comment.ragState !== target.ragState),
  };
}

export function reviewTargetForNode(
  node: ReviewPaperNode,
  side: ReviewSide,
  source: Readonly<{ collectionId: string; relativePath: string }>,
): ReviewTargetDescriptor | undefined {
  const state = node.review[side];
  if (node.depth !== 0 || !node.uuid || !state.contentRag) {
    return undefined;
  }
  const ragState = normalizeSourceRag(state.contentRag);
  if (!ragState) return undefined;
  return {
    collectionId: source.collectionId,
    nodeId: node.id,
    questionId: node.questionId ?? null,
    ragState,
    relativePath: source.relativePath,
    sheet: sheetCodeFromSourceRag(ragState),
    side,
    uuid: node.uuid,
  };
}

export function reviewCommentTargetForNode(
  node: ReviewPaperNode,
  topLevelQuestion: ReviewPaperNode,
  side: ReviewSide,
  source: Readonly<{ collectionId: string; relativePath: string }>,
): ReviewTargetDescriptor | undefined {
  if (topLevelQuestion.depth !== 0 || !node.uuid) return undefined;
  const inheritedState = topLevelQuestion.review[side].contentRag;
  if (!inheritedState) return undefined;
  const ragState = normalizeSourceRag(inheritedState);
  if (!ragState) return undefined;
  return {
    collectionId: source.collectionId,
    nodeId: node.id,
    questionId: node.questionId ?? null,
    ragState,
    relativePath: source.relativePath,
    sheet: null,
    side,
    uuid: node.uuid,
  };
}
