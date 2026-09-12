import {
  appendVerifiedGlobalReviewFinding,
  listTodoGlobalReviewFindings,
  processGlobalReviewFinding,
} from '@/lib/global-review-findings';
import {
  parseGlobalReviewFindingRequest,
  parseProcessGlobalReviewFindingRequest,
  ReviewRequestError,
} from '@/lib/review-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const;

function errorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json(
      { message: 'The request body is not valid JSON.' },
      { headers: NO_STORE_HEADERS, status: 400 },
    );
  }
  if (error instanceof ReviewRequestError) {
    return Response.json(
      { message: error.message },
      { headers: NO_STORE_HEADERS, status: error.status },
    );
  }
  return Response.json(
    { message: 'The global finding request could not be completed.' },
    { headers: NO_STORE_HEADERS, status: 500 },
  );
}

export function GET() {
  try {
    return Response.json(
      { findings: listTodoGlobalReviewFindings() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseGlobalReviewFindingRequest(await request.json());
    const result = await appendVerifiedGlobalReviewFinding(input);
    return Response.json(
      { finding: result.finding },
      {
        headers: NO_STORE_HEADERS,
        status: result.created ? 201 : 200,
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = parseProcessGlobalReviewFindingRequest(await request.json());
    const result = processGlobalReviewFinding(input);
    return Response.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
