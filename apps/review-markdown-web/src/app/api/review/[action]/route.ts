import {
  ReviewOutcomeRequestError,
  isReviewOutcomeAction,
  parseReviewOutcomeRequestBody,
} from '@/lib/review-outcomes';
import { reviewApiBaseUrl } from '@/lib/rtq-review-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const actionMap = {
  'add-subtag': 'addsubtag',
  comments: 'comments',
  'question-comments': 'questioncomments',
  'question-rag': 'questionrag',
  rag: 'rag',
  'remove-subtag': 'removesubtag',
  'reset-answer-comments': 'resetanswercomments',
  'reset-question-comments': 'resetquestioncomments',
} as const;

type ReviewRouteContext = {
  params: Promise<{
    action: string;
  }>;
};

export async function POST(request: Request, { params }: ReviewRouteContext) {
  const { action } = await params;
  const upstreamPath = actionMap[action as keyof typeof actionMap];

  if (!upstreamPath) {
    return Response.json(
      { reason: `Unknown review action: ${action}` },
      { status: 404 },
    );
  }

  let body = await request.text();

  if (isReviewOutcomeAction(action)) {
    try {
      body = parseReviewOutcomeRequestBody(body);
    } catch (error) {
      if (error instanceof ReviewOutcomeRequestError) {
        return Response.json({ reason: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    const upstreamResponse = await fetch(
      `${reviewApiBaseUrl}/${upstreamPath}`,
      {
        body,
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    );

    const responseText = await upstreamResponse.text();
    const contentType =
      upstreamResponse.headers.get('content-type') ?? 'application/json';

    return new Response(responseText, {
      headers: {
        'Content-Type': contentType,
      },
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : 'The local review API could not be reached.';

    return Response.json({ reason }, { status: 502 });
  }
}
