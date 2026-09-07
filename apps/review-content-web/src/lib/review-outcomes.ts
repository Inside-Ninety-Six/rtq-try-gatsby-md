import type { ReviewOutcomeRequest } from './review-server.ts';

type ForwardOutcomeOptions = Readonly<{
  baseUrl: string;
  fetcher?: typeof fetch;
}>;

export type ForwardOutcomeResult = Readonly<{
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
): Promise<ForwardOutcomeResult> {
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
        ? 'Review outcome reset in Google Sheets.'
        : input.outcome === 'PRG'
          ? 'Approved and submitted to Google Sheets.'
          : `${input.outcome} submitted to Google Sheets.`,
    status: response.status,
  };
}
