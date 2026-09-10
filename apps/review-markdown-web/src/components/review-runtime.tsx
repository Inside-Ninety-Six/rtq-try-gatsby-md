'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isReviewOutcomeSelection } from '@/lib/review-outcomes';

type ChangeRecord = {
  event: 'add' | 'change' | 'unlink';
  relativePath: string;
  root: 'assets' | 'content';
};

type ContentChangeBatch = {
  changes?: ChangeRecord[];
  timestamp: number;
};

type ReviewRuntimeProps = {
  contentRelativePath?: string;
  watchMode: 'document' | 'home';
};

type ReviewEndpointAction =
  | 'add-subtag'
  | 'comments'
  | 'question-comments'
  | 'question-rag'
  | 'rag'
  | 'remove-subtag'
  | 'reset-answer-comments'
  | 'reset-question-comments';

type ReviewTagPayload = {
  dimension?: string;
  subtag?: string;
  tag?: string;
  uuid?: string;
};

type WindowWithReviewApi = Window & {
  addSubTag?: (event: Event) => void;
  removeSubTag?: (event: Event) => void;
  resetComment?: (event: Event) => void;
  submitComment?: (event: Event) => void;
  submitReview?: (event: Event) => void;
};

type DisplayPreferences = {
  controls: boolean;
  sourceData: boolean;
  tags: boolean;
  workings: boolean;
};

type DisplayPreferenceKey = keyof DisplayPreferences;

const displayPreferenceStorageKey = 'rtq-review-web:display-preferences';

const defaultDisplayPreferences: DisplayPreferences = {
  controls: true,
  sourceData: true,
  tags: true,
  workings: true,
};

const displayPreferenceControls: Array<{
  description: string;
  key: DisplayPreferenceKey;
  label: string;
}> = [
  {
    description: 'Show source/raw data blocks',
    key: 'sourceData',
    label: 'Source data',
  },
  {
    description: 'Show workings, tips, formulas, and answers',
    key: 'workings',
    label: 'Workings',
  },
  {
    description: 'Show dimensional tags and inherited tag badges',
    key: 'tags',
    label: 'Tags',
  },
  {
    description: 'Show review state buttons and comment forms',
    key: 'controls',
    label: 'Controls',
  },
];

function parseStoredDisplayPreferences(
  value: string | null,
): DisplayPreferences {
  if (!value) {
    return defaultDisplayPreferences;
  }

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return defaultDisplayPreferences;
    }

    return {
      controls:
        typeof parsed.controls === 'boolean'
          ? parsed.controls
          : defaultDisplayPreferences.controls,
      sourceData:
        typeof parsed.sourceData === 'boolean'
          ? parsed.sourceData
          : defaultDisplayPreferences.sourceData,
      tags:
        typeof parsed.tags === 'boolean'
          ? parsed.tags
          : defaultDisplayPreferences.tags,
      workings:
        typeof parsed.workings === 'boolean'
          ? parsed.workings
          : defaultDisplayPreferences.workings,
    };
  } catch {
    return defaultDisplayPreferences;
  }
}

function applyDisplayPreferencesToDocument(preferences: DisplayPreferences) {
  document.documentElement.dataset.rtqControlsVisible = preferences.controls
    ? 'true'
    : 'false';
  document.documentElement.dataset.rtqSourceDataVisible = preferences.sourceData
    ? 'true'
    : 'false';
  document.documentElement.dataset.rtqTagsVisible = preferences.tags
    ? 'true'
    : 'false';
  document.documentElement.dataset.rtqWorkingsVisible = preferences.workings
    ? 'true'
    : 'false';

  document.documentElement.classList.toggle(
    'rtq-hide-source-data',
    !preferences.sourceData,
  );
  document.documentElement.classList.toggle('rtq-hide-tags', !preferences.tags);
  document.documentElement.classList.toggle(
    'rtq-hide-workings',
    !preferences.workings,
  );
  document.body.classList.toggle(
    'rtq-hide-source-data',
    !preferences.sourceData,
  );
  document.body.classList.toggle('rtq-hide-tags', !preferences.tags);
  document.body.classList.toggle('rtq-hide-workings', !preferences.workings);
}

async function submitAsyncRequest(
  statusId: string,
  body: Record<string, unknown>,
  action: ReviewEndpointAction,
) {
  const reviewStatus = document.getElementById(statusId);

  if (!reviewStatus) {
    return;
  }

  setStatusWithTimeout(
    reviewStatus,
    'Submitting. Please wait ...',
    'loading',
    0,
  );

  try {
    const response = await fetch(`/api/review/${action}`, {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const text = await response.text();
      let reason = text;

      try {
        const json = JSON.parse(text) as { reason?: string };
        reason = json.reason ?? text;
      } catch {
        reason = text;
      }

      setStatusWithTimeout(
        reviewStatus,
        `Error: ${reason || response.statusText}`,
        'error',
        3000,
      );
      return;
    }

    setStatusWithTimeout(reviewStatus, 'Success', 'success', 3000);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    setStatusWithTimeout(reviewStatus, `Error: ${message}`, 'error', 3000);
  }
}

function setStatusWithTimeout(
  element: Element,
  message: string,
  className: 'error' | 'initial' | 'loading' | 'success',
  timeoutMs: number,
) {
  element.textContent = message;
  element.classList.remove('error', 'initial', 'success', 'loading');
  element.classList.add(className);

  if (timeoutMs <= 0) {
    return;
  }

  window.setTimeout(() => {
    element.classList.remove('error', 'initial', 'success', 'loading');
    element.classList.add('initial');
    element.textContent = 'Initial';
  }, timeoutMs);
}

function extractPrimaryRagState(rawValue: string | null | undefined) {
  const value = rawValue?.trim().toLowerCase();

  if (!value) {
    return null;
  }

  if (value.startsWith('rag_wf_')) {
    return value.slice('rag_wf_'.length);
  }

  if (value.startsWith('rag_')) {
    return value.slice('rag_'.length);
  }

  return null;
}

function isTagContainer(element: HTMLElement) {
  if (
    element.classList.contains('topics') ||
    element.classList.contains('tags') ||
    element.classList.contains('tag-chip-list') ||
    element.dataset.rtqTagBlock === 'true'
  ) {
    return true;
  }

  return (
    element.querySelector(
      '[data-rtq-tag], [data-tag], [data-dimension], [data-tag-dimension]',
    ) !== null
  );
}

function buildReviewTagPayload(button: HTMLButtonElement): ReviewTagPayload {
  const dimension = button.dataset.dimension ?? button.dataset.tagDimension;
  const tag = button.dataset.tag;
  const subtag = button.dataset.subtag ?? tag;
  const payload: ReviewTagPayload = {
    subtag,
    uuid: button.dataset.uuid,
  };

  if (dimension) {
    payload.dimension = dimension;
  }

  if (tag) {
    payload.tag = tag;
  }

  return payload;
}

function annotateQuestionRagStates() {
  const questionEnvelopes = document.querySelectorAll<HTMLElement>(
    '.rtq-document .question_envelope',
  );

  questionEnvelopes.forEach(questionEnvelope => {
    const directRagBlocks = Array.from(questionEnvelope.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('rag'),
    );

    const primaryRagBlock = directRagBlocks[1];
    const primaryRagText = primaryRagBlock?.textContent ?? null;
    const primaryRagState = extractPrimaryRagState(primaryRagText);

    if (primaryRagState) {
      questionEnvelope.dataset.rtqPrimaryRagState = primaryRagState;
      primaryRagBlock.dataset.rtqPrimaryRagState = primaryRagState;
      return;
    }

    delete questionEnvelope.dataset.rtqPrimaryRagState;

    if (primaryRagBlock) {
      delete primaryRagBlock.dataset.rtqPrimaryRagState;
    }
  });
}

function annotateTopLevelQuestionNumbers() {
  const topLevelQuestionEnvelopes = document.querySelectorAll<HTMLElement>(
    '.rtq-document .question_envelope.question',
  );

  topLevelQuestionEnvelopes.forEach((questionEnvelope, index) => {
    const questionNumber = String(index + 1);
    questionEnvelope.dataset.rtqQuestionNumber = questionNumber;

    let headerBadge = questionEnvelope.querySelector<HTMLElement>(
      ':scope > .rtq-question-number-badge',
    );

    if (!headerBadge) {
      headerBadge = document.createElement('div');
      headerBadge.className = 'rtq-question-number-badge';
      questionEnvelope.insertAdjacentElement('afterbegin', headerBadge);
    }

    headerBadge.textContent = questionNumber;

    const questionBlock = Array.from(questionEnvelope.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.classList.contains('question') &&
        !child.classList.contains('subquestion') &&
        !child.classList.contains('subsubquestion'),
    );

    if (!questionBlock) {
      return;
    }

    const firstStrong = questionBlock.querySelector(
      'p:first-child strong:first-child',
    );

    if (firstStrong && firstStrong.textContent?.trim() === 'Question') {
      firstStrong.remove();
      return;
    }

    delete questionBlock.dataset.rtqQuestionNumber;
  });
}

function annotateInheritedTagBadges() {
  const questionEnvelopes = document.querySelectorAll<HTMLElement>(
    '.rtq-document .question_envelope',
  );

  questionEnvelopes.forEach(questionEnvelope => {
    Array.from(questionEnvelope.children).forEach(child => {
      if (!(child instanceof HTMLElement)) {
        return;
      }

      if (isTagContainer(child)) {
        child.classList.add('rtq-tags');
        return;
      }

      if (child.classList.contains('rtq-inherited-tags')) {
        return;
      }

      const normalizedText = child.textContent
        ?.replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (
        normalizedText?.startsWith('inherits parent tags:') ||
        normalizedText?.startsWith('inherits parent tag dimensions:') ||
        normalizedText?.startsWith('uses parent tags:')
      ) {
        child.classList.add('rtq-inherited-tags');
      }
    });
  });
}

function removeUnsupportedReviewOutcomeControls() {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '.rtq-document button.review[data-rag]',
  );

  buttons.forEach(button => {
    if (isReviewOutcomeSelection(button.dataset.rag)) {
      return;
    }
    const listItem = button.closest('li.review');
    (listItem ?? button).remove();
  });
}

function setupQuestionNavStickiness() {
  const managedNavs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.rtq-document .question_envelope.question > .question-nav',
    ),
  )
    .map(nav => {
      const container = nav.closest<HTMLElement>('.question_envelope.question');

      if (!container) {
        return null;
      }

      let placeholder = nav.nextElementSibling;

      if (
        !(placeholder instanceof HTMLElement) ||
        !placeholder.classList.contains('rtq-question-nav-placeholder')
      ) {
        placeholder = document.createElement('div');
        placeholder.className = 'rtq-question-nav-placeholder';
        nav.insertAdjacentElement('afterend', placeholder);
      }

      return { container, nav, placeholder };
    })
    .filter(
      (
        item,
      ): item is {
        container: HTMLElement;
        nav: HTMLElement;
        placeholder: HTMLElement;
      } => item !== null,
    );

  if (managedNavs.length === 0) {
    return () => undefined;
  }

  const topOffset = 12;
  const horizontalInset = 16;
  let frameId = 0;

  const applyNormal = (nav: HTMLElement, placeholder: HTMLElement) => {
    nav.dataset.rtqStickyMode = 'normal';
    nav.style.position = 'relative';
    nav.style.top = '0';
    nav.style.left = '0';
    nav.style.right = 'auto';
    nav.style.width = 'auto';
    nav.style.maxWidth = 'none';
    nav.style.zIndex = '20';
    placeholder.style.display = 'none';
    placeholder.style.height = '0';
  };

  const applyFixed = (
    nav: HTMLElement,
    placeholder: HTMLElement,
    containerRect: DOMRect,
    navHeight: number,
  ) => {
    nav.dataset.rtqStickyMode = 'fixed';
    nav.style.position = 'fixed';
    nav.style.top = `${topOffset}px`;
    nav.style.left = `${containerRect.left + horizontalInset}px`;
    nav.style.right = 'auto';
    nav.style.width = `${Math.max(containerRect.width - horizontalInset * 2, 220)}px`;
    nav.style.maxWidth = `${Math.max(containerRect.width - horizontalInset * 2, 220)}px`;
    nav.style.zIndex = '40';
    placeholder.style.display = 'block';
    placeholder.style.height = `${navHeight + 14}px`;
  };

  const applyPinnedBottom = (
    nav: HTMLElement,
    placeholder: HTMLElement,
    navHeight: number,
  ) => {
    nav.dataset.rtqStickyMode = 'bottom';
    nav.style.position = 'absolute';
    nav.style.top = 'auto';
    nav.style.bottom = '1rem';
    nav.style.left = `${horizontalInset}px`;
    nav.style.right = `${horizontalInset}px`;
    nav.style.width = 'auto';
    nav.style.maxWidth = 'none';
    nav.style.zIndex = '20';
    placeholder.style.display = 'block';
    placeholder.style.height = `${navHeight + 14}px`;
  };

  const updatePositions = () => {
    frameId = 0;

    managedNavs.forEach(({ container, nav, placeholder }) => {
      const containerRect = container.getBoundingClientRect();
      const navHeight = nav.offsetHeight;
      const shouldStick = containerRect.top <= topOffset;
      const canRemainFixed = containerRect.bottom - topOffset > navHeight + 16;

      nav.style.bottom = 'auto';

      if (!shouldStick) {
        applyNormal(nav, placeholder);
        return;
      }

      if (canRemainFixed) {
        applyFixed(nav, placeholder, containerRect, navHeight);
        return;
      }

      applyPinnedBottom(nav, placeholder, navHeight);
    });
  };

  const scheduleUpdate = () => {
    if (frameId !== 0) {
      return;
    }

    frameId = window.requestAnimationFrame(updatePositions);
  };

  const resizeObserver = new ResizeObserver(() => {
    scheduleUpdate();
  });

  managedNavs.forEach(({ container, nav }) => {
    resizeObserver.observe(container);
    resizeObserver.observe(nav);
  });

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  scheduleUpdate();

  return () => {
    if (frameId !== 0) {
      window.cancelAnimationFrame(frameId);
    }

    window.removeEventListener('scroll', scheduleUpdate);
    window.removeEventListener('resize', scheduleUpdate);
    resizeObserver.disconnect();

    managedNavs.forEach(({ nav, placeholder }) => {
      nav.dataset.rtqStickyMode = 'normal';
      nav.style.position = '';
      nav.style.top = '';
      nav.style.bottom = '';
      nav.style.left = '';
      nav.style.right = '';
      nav.style.width = '';
      nav.style.maxWidth = '';
      nav.style.zIndex = '';
      placeholder.remove();
    });
  };
}

export function ReviewRuntime({
  contentRelativePath,
  watchMode,
}: ReviewRuntimeProps) {
  const router = useRouter();
  const refreshTimeoutRef = useRef<number | null>(null);
  const [displayPreferences, setDisplayPreferences] = useState(
    defaultDisplayPreferences,
  );
  const [hasLoadedDisplayPreferences, setHasLoadedDisplayPreferences] =
    useState(false);
  const displayModeAttributes = useMemo(
    () => ({
      'data-controls-visible': displayPreferences.controls ? 'true' : 'false',
      'data-source-data-visible': displayPreferences.sourceData
        ? 'true'
        : 'false',
      'data-tags-visible': displayPreferences.tags ? 'true' : 'false',
      'data-workings-visible': displayPreferences.workings ? 'true' : 'false',
    }),
    [displayPreferences],
  );

  useEffect(() => {
    const win = window as WindowWithReviewApi;

    win.addSubTag = event => {
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      void submitAsyncRequest(
        `SUBTAG-STATUS-${button.dataset.uuid}`,
        buildReviewTagPayload(button),
        'add-subtag',
      );
    };

    win.removeSubTag = event => {
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      void submitAsyncRequest(
        `SUBTAG-STATUS-${button.dataset.uuid}`,
        buildReviewTagPayload(button),
        'remove-subtag',
      );
    };

    win.submitReview = event => {
      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      const reviewOutcome = button.dataset.rag;
      if (!isReviewOutcomeSelection(reviewOutcome)) {
        const reviewStatus = document.getElementById(
          `REVIEW-STATUS-${button.dataset.uuid}`,
        );
        if (reviewStatus) {
          setStatusWithTimeout(
            reviewStatus,
            'Error: The review outcome is not supported.',
            'error',
            3000,
          );
        }
        return;
      }

      const reviewType = button.dataset.reviewType;
      const action: ReviewEndpointAction =
        reviewType === 'REVIEW_QUESTION' ? 'question-rag' : 'rag';

      void submitAsyncRequest(
        `REVIEW-STATUS-${button.dataset.uuid}`,
        {
          rag: reviewOutcome,
          reviewer: button.dataset.reviewer,
          sheet: button.dataset.sheet,
          uuid: button.dataset.uuid,
        },
        action,
      );
    };

    win.submitComment = event => {
      event.preventDefault();

      const form = event.currentTarget as HTMLFormElement | null;
      if (!form) {
        return;
      }

      const formData = new FormData(form);
      const action: ReviewEndpointAction =
        form.dataset.reviewType === 'REVIEW_QUESTION'
          ? 'question-comments'
          : 'comments';

      void submitAsyncRequest(
        `REVIEW-STATUS-${form.dataset.uuid}`,
        {
          comment: formData.get('comment'),
          reviewer: form.dataset.reviewer,
          sheet: form.dataset.sheet,
          uuid: form.dataset.uuid,
        },
        action,
      );
    };

    win.resetComment = event => {
      event.preventDefault();

      const button = event.currentTarget as HTMLButtonElement | null;
      if (!button) {
        return;
      }

      const action: ReviewEndpointAction =
        button.dataset.reviewType === 'REVIEW_QUESTION'
          ? 'reset-question-comments'
          : 'reset-answer-comments';

      void submitAsyncRequest(
        `REVIEW-STATUS-${button.dataset.uuid}`,
        {
          sheet: button.dataset.sheet,
          uuid: button.dataset.uuid,
        },
        action,
      );
    };

    return () => {
      delete win.addSubTag;
      delete win.removeSubTag;
      delete win.resetComment;
      delete win.submitComment;
      delete win.submitReview;
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const storedDisplayPreferences = parseStoredDisplayPreferences(
        window.localStorage.getItem(displayPreferenceStorageKey),
      );

      applyDisplayPreferencesToDocument(storedDisplayPreferences);
      setDisplayPreferences(storedDisplayPreferences);
      setHasLoadedDisplayPreferences(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    applyDisplayPreferencesToDocument(displayPreferences);

    if (!hasLoadedDisplayPreferences) {
      return;
    }

    window.localStorage.setItem(
      displayPreferenceStorageKey,
      JSON.stringify(displayPreferences),
    );
  }, [displayPreferences, hasLoadedDisplayPreferences]);

  useEffect(() => {
    removeUnsupportedReviewOutcomeControls();
    annotateQuestionRagStates();
    annotateTopLevelQuestionNumbers();
    annotateInheritedTagBadges();
    return setupQuestionNavStickiness();
  });

  useEffect(() => {
    const eventSource = new EventSource('/api/content-events');

    const refreshRoute = () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        router.refresh();
      }, 100);
    };

    eventSource.onmessage = event => {
      const payload = JSON.parse(event.data) as ContentChangeBatch;
      const changes = Array.isArray(payload.changes) ? payload.changes : [];

      if (watchMode === 'home') {
        if (changes.some(change => change.root === 'content')) {
          refreshRoute();
        }
        return;
      }

      if (!contentRelativePath) {
        return;
      }

      const shouldRefresh = changes.some(
        change =>
          change.root === 'content' &&
          change.relativePath === contentRelativePath,
      );

      if (shouldRefresh) {
        refreshRoute();
      }
    };

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      eventSource.close();
    };
  }, [contentRelativePath, router, watchMode]);

  return (
    <aside
      aria-label="Display controls"
      className="rtq-display-controls"
      {...displayModeAttributes}>
      {displayPreferenceControls.map(control => {
        const isEnabled = displayPreferences[control.key];

        return (
          <button
            aria-label={`${isEnabled ? 'Hide' : 'Show'} ${control.label}`}
            aria-pressed={isEnabled}
            className="rtq-display-controls__button"
            data-active={isEnabled ? 'true' : 'false'}
            key={control.key}
            onClick={() =>
              setDisplayPreferences(current => ({
                ...current,
                [control.key]: !current[control.key],
              }))
            }
            title={control.description}
            type="button">
            <span
              className="rtq-display-controls__indicator"
              aria-hidden="true"
            />
            <span>{control.label}</span>
          </button>
        );
      })}
    </aside>
  );
}
