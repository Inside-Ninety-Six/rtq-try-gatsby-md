export const REVIEW_PREFERENCES_KEY = 'rtq.review-content.preferences.v3';
export const LEGACY_REVIEW_PREFERENCES_KEY =
  'rtq.review-content.preferences.v2';
export const INITIAL_REVIEW_PREFERENCES_KEY =
  'rtq.review-content.preferences.v1';

export type ReviewControlMode = 'advanced' | 'simple';

export type ReviewPreferences = Readonly<{
  reviewControlMode: ReviewControlMode;
  showAnswerReview: boolean;
  showQuestionReview: boolean;
  showRaw: boolean;
  showSolutions: boolean;
  showTags: boolean;
}>;

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  reviewControlMode: 'simple',
  showAnswerReview: true,
  showQuestionReview: true,
  showRaw: false,
  showSolutions: true,
  showTags: true,
};

export type VisibleReviewSide = 'answer' | 'question';

function parsePreferenceRecord(
  value: string | null,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseReviewPreferences(
  value: string | null,
  legacyValue: string | null = null,
  initialValue: string | null = null,
): ReviewPreferences {
  const parsed = parsePreferenceRecord(value);
  const legacy = parsePreferenceRecord(legacyValue);
  const initial = parsePreferenceRecord(initialValue);
  const oldReviewPreference =
    typeof parsed?.showReview === 'boolean'
      ? parsed.showReview
      : typeof legacy?.showReview === 'boolean'
        ? legacy.showReview
        : typeof initial?.showReview === 'boolean'
          ? initial.showReview
          : undefined;

  function preference(
    key: keyof ReviewPreferences,
    fallback: boolean,
  ): boolean {
    const currentPreference = parsed?.[key];
    const legacyPreference = legacy?.[key];
    const initialPreference = initial?.[key];
    if (typeof currentPreference === 'boolean') return currentPreference;
    if (typeof legacyPreference === 'boolean') return legacyPreference;
    if (typeof initialPreference === 'boolean') return initialPreference;
    return fallback;
  }

  const requestedControlMode =
    parsed?.reviewControlMode ??
    legacy?.reviewControlMode ??
    initial?.reviewControlMode;

  return {
    reviewControlMode:
      requestedControlMode === 'advanced' || requestedControlMode === 'simple'
        ? requestedControlMode
        : DEFAULT_REVIEW_PREFERENCES.reviewControlMode,
    showAnswerReview: preference(
      'showAnswerReview',
      oldReviewPreference ?? DEFAULT_REVIEW_PREFERENCES.showAnswerReview,
    ),
    showQuestionReview: preference(
      'showQuestionReview',
      oldReviewPreference ?? DEFAULT_REVIEW_PREFERENCES.showQuestionReview,
    ),
    showRaw: preference('showRaw', DEFAULT_REVIEW_PREFERENCES.showRaw),
    showSolutions: preference(
      'showSolutions',
      DEFAULT_REVIEW_PREFERENCES.showSolutions,
    ),
    showTags: preference('showTags', DEFAULT_REVIEW_PREFERENCES.showTags),
  };
}

export function visibleReviewSides(
  preferences: ReviewPreferences,
): readonly VisibleReviewSide[] {
  const sides: VisibleReviewSide[] = [];
  if (preferences.showQuestionReview) sides.push('question');
  if (preferences.showAnswerReview) sides.push('answer');
  return sides;
}

export function adjacentQuestionId(
  questionIds: readonly string[],
  activeId: string | undefined,
  direction: -1 | 1,
): string | undefined {
  if (questionIds.length === 0) return undefined;
  const activeIndex = activeId ? questionIds.indexOf(activeId) : -1;
  const nextIndex =
    activeIndex < 0
      ? direction === 1
        ? 0
        : questionIds.length - 1
      : activeIndex + direction;
  return questionIds[nextIndex];
}

function withIndexQuery(route: string, indexQuery?: string): string {
  const query = indexQuery?.trim();
  return query ? `${route}?q=${encodeURIComponent(query)}` : route;
}

export function paperRoute(
  collectionId: string,
  relativePath: string,
  indexQuery?: string,
): string {
  const slug = relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return withIndexQuery(
    `/papers/${encodeURIComponent(collectionId)}/${slug}`,
    indexQuery,
  );
}

export function collectionRoute(
  collectionId: string,
  indexQuery?: string,
): string {
  return withIndexQuery(
    `/papers/${encodeURIComponent(collectionId)}`,
    indexQuery,
  );
}

export function reviewStateLabel(value: string): string {
  return value
    .trim()
    .replace(/^rag_wf_/i, '')
    .replace(/^rag_/i, '')
    .replaceAll(/[_-]+/g, ' ')
    .toUpperCase();
}
