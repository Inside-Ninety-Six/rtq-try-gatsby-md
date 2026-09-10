import type { ReviewPaper } from '@rtq/review-paper-model';
import {
  getReviewStore,
  ReviewDatabaseError,
  ReviewStoreValidationError,
  type ReviewOutcomeRepository,
} from '@rtq/review-store/server';

import type { ReviewOutcomeRequest } from './review-server.ts';
import {
  isReviewOutcome,
  reviewOutcomeLabel,
  reviewTargetForNode,
  reviewTargetKey,
  type ReviewOutcomeDestination,
  type ReviewOutcomeLoad,
  type ReviewOutcomeSelection,
} from './review-types.ts';

type ForwardOutcomeOptions = Readonly<{
  baseUrl: string;
  fetcher?: typeof fetch;
}>;

export type SubmitOutcomeResult = Readonly<{
  message: string;
  status: number;
}>;

function safeUpstreamReason(text: string): string {
  try {
    const parsed = JSON.parse(text) as { reason?: unknown };
    if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
      return parsed.reason.trim().slice(0, 300);
    }
  } catch {
    // Fall through to a generic error so HTML and internals are not exposed.
  }
  return 'The review service rejected the outcome.';
}

export async function forwardReviewOutcome(
  input: ReviewOutcomeRequest,
  options: ForwardOutcomeOptions,
): Promise<SubmitOutcomeResult> {
  if (!input.target.sheet) {
    return { message: 'No Google Sheets route is available.', status: 409 };
  }
  const fetcher = options.fetcher ?? fetch;
  const path = input.target.side === 'question' ? 'questionrag' : 'rag';
  let response: Response;
  try {
    response = await fetcher(`${options.baseUrl.replace(/\/$/, '')}/${path}`, {
      body: JSON.stringify({
        rag: input.outcome ?? '',
        reviewer: input.reviewer,
        sheet: input.target.sheet,
        uuid: input.target.uuid,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
  } catch {
    return {
      message: 'The local review API could not be reached.',
      status: 502,
    };
  }
  if (!response.ok) {
    return {
      message: safeUpstreamReason(await response.text()),
      status: response.status,
    };
  }
  return {
    message:
      input.outcome === null
        ? 'Review request reset in Google Sheets.'
        : input.outcome === 'PRG'
          ? 'Approved and submitted to Google Sheets.'
          : `${reviewOutcomeLabel(input.outcome)} submitted to Google Sheets.`,
    status: response.status,
  };
}

type DatabaseOutcomeOptions = Readonly<{
  repository?: ReviewOutcomeRepository;
}>;

export function persistReviewOutcome(
  input: ReviewOutcomeRequest,
  options: DatabaseOutcomeOptions = {},
): SubmitOutcomeResult {
  try {
    const repository = options.repository ?? getReviewStore().outcomes;
    if (input.outcome === null) {
      repository.clear({
        ragState: input.target.ragState,
        side: input.target.side,
        uuid: input.target.uuid,
      });
      return {
        message: 'Review request reset in the review database.',
        status: 200,
      };
    }
    repository.set({
      outcome: input.outcome,
      ragState: input.target.ragState,
      reviewer: input.reviewer,
      side: input.target.side,
      uuid: input.target.uuid,
    });
    return {
      message:
        input.outcome === 'PRG'
          ? 'Approved and saved to the review database.'
          : `${reviewOutcomeLabel(input.outcome)} saved to the review database.`,
      status: 200,
    };
  } catch (error) {
    if (error instanceof ReviewStoreValidationError) {
      return { message: 'The review request is not valid.', status: 400 };
    }
    if (error instanceof ReviewDatabaseError) {
      return {
        message: 'The review database is unavailable.',
        status: 503,
      };
    }
    throw error;
  }
}

type SubmitReviewOutcomeOptions = Readonly<{
  baseUrl: string;
  destination: ReviewOutcomeDestination;
  fetcher?: typeof fetch;
  repository?: ReviewOutcomeRepository;
}>;

export async function submitReviewOutcome(
  input: ReviewOutcomeRequest,
  options: SubmitReviewOutcomeOptions,
): Promise<SubmitOutcomeResult> {
  if (options.destination === 'database') {
    return persistReviewOutcome(input, { repository: options.repository });
  }
  return forwardReviewOutcome(input, {
    baseUrl: options.baseUrl,
    fetcher: options.fetcher,
  });
}

export function reviewOutcomeTargetsForPaper(paper: ReviewPaper) {
  const source = {
    collectionId: paper.source.collection.id,
    relativePath: paper.source.relativePath,
  };
  return paper.sections.flatMap((section) =>
    section.questions.flatMap((question) =>
      (['question', 'answer'] as const).flatMap((side) => {
        const target = reviewTargetForNode(question, side, source);
        return target
          ? [
              {
                ragState: target.ragState,
                side: target.side,
                uuid: target.uuid,
              },
            ]
          : [];
      }),
    ),
  );
}

type LoadReviewOutcomeOptions = Readonly<{
  repository?: ReviewOutcomeRepository;
}>;

export function loadReviewOutcomesForPaper(
  paper: ReviewPaper,
  destination: ReviewOutcomeDestination,
  options: LoadReviewOutcomeOptions = {},
): ReviewOutcomeLoad {
  if (destination === 'google-sheets') {
    return { destination, outcomes: {} };
  }
  try {
    const repository = options.repository ?? getReviewStore().outcomes;
    const targets = reviewOutcomeTargetsForPaper(paper);
    const requested = new Set(
      targets.map((target) =>
        JSON.stringify([target.uuid, target.side, target.ragState]),
      ),
    );
    const outcomes: Record<string, ReviewOutcomeSelection> = {};
    for (const stored of repository.resolve(targets)) {
      const identity = JSON.stringify([
        stored.uuid,
        stored.side,
        stored.ragState,
      ]);
      if (!requested.has(identity) || !isReviewOutcome(stored.outcome)) {
        throw new Error('The review database returned an invalid outcome.');
      }
      outcomes[reviewTargetKey(stored)] = stored.outcome;
    }
    return { destination, outcomes };
  } catch {
    return {
      destination,
      error:
        'Review requests are unavailable. Check the rtq-review database directory and retry.',
      outcomes: {},
    };
  }
}
