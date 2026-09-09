import {
  reviewApiBaseUrl,
  reviewOutcomeDestination,
} from '@/lib/review-api-config';
import { submitReviewOutcome } from '@/lib/review-outcomes';
import {
  parseReviewOutcomeRequest,
  resolveVerifiedReviewTarget,
  ReviewRequestError,
} from '@/lib/review-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const input = parseReviewOutcomeRequest(await request.json());
    const target = await resolveVerifiedReviewTarget(input.target);
    const destination = reviewOutcomeDestination();
    const result = await submitReviewOutcome(
      { ...input, target },
      { baseUrl: reviewApiBaseUrl, destination },
    );
    return Response.json(
      {
        message: result.message,
        outcome: input.outcome,
        side: target.side,
        destination,
      },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { message: 'The request body is not valid JSON.' },
        { status: 400 },
      );
    }
    if (error instanceof ReviewRequestError) {
      return Response.json(
        { message: error.message },
        { status: error.status },
      );
    }
    return Response.json(
      { message: 'The outcome request could not be processed.' },
      { status: 500 },
    );
  }
}
