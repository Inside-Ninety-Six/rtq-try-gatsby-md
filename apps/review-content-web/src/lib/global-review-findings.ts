import {
  getReviewStore,
  ReviewDatabaseError,
  ReviewFindingConflictError,
  type GlobalReviewFindingRepository,
} from '@rtq/review-store/server';

import {
  resolveVerifiedGlobalReviewFindingSource,
  ReviewRequestError,
  type GlobalReviewFindingRequest,
} from './review-server.ts';
import type { GlobalReviewFindingSourceDescriptor } from './review-types.ts';

type FindingDependencies = Readonly<{
  repository?: GlobalReviewFindingRepository;
  resolveSource?: (
    source: GlobalReviewFindingSourceDescriptor,
  ) => Promise<
    Omit<
      Parameters<GlobalReviewFindingRepository['append']>[0],
      'finding' | 'reviewer' | 'submissionId'
    >
  >;
}>;

function findingRepository(
  repository?: GlobalReviewFindingRepository,
): GlobalReviewFindingRepository {
  return repository ?? getReviewStore().findings;
}

function mapStorageError(error: unknown): never {
  if (error instanceof ReviewFindingConflictError) {
    throw new ReviewRequestError(error.message, 409);
  }
  if (error instanceof ReviewDatabaseError) {
    throw new ReviewRequestError(
      'Global findings are unavailable. Check the database directory and retry.',
      503,
    );
  }
  throw error;
}

export async function appendVerifiedGlobalReviewFinding(
  input: GlobalReviewFindingRequest,
  dependencies: FindingDependencies = {},
) {
  const resolveSource =
    dependencies.resolveSource ?? resolveVerifiedGlobalReviewFindingSource;
  const source = await resolveSource(input.source);
  try {
    return findingRepository(dependencies.repository).append({
      ...source,
      finding: input.finding,
      reviewer: input.reviewer,
      submissionId: input.submissionId,
    });
  } catch (error) {
    mapStorageError(error);
  }
}

export function listTodoGlobalReviewFindings(
  dependencies: Pick<FindingDependencies, 'repository'> = {},
) {
  try {
    return findingRepository(dependencies.repository).listTodo();
  } catch (error) {
    mapStorageError(error);
  }
}

export function processGlobalReviewFinding(
  input: Readonly<{ id: string; processedBy: string }>,
  dependencies: Pick<FindingDependencies, 'repository'> = {},
) {
  try {
    const result = findingRepository(dependencies.repository).markProcessed(
      input,
    );
    if (!result) {
      throw new ReviewRequestError('The global finding was not found.', 404);
    }
    return result;
  } catch (error) {
    if (error instanceof ReviewRequestError) throw error;
    mapStorageError(error);
  }
}
