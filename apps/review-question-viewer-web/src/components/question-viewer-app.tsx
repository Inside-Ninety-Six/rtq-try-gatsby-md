'use client';

import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { RtqMarkdown } from '@/components/rtq-markdown';
import type {
  CurrentQuestionResponse,
  OriginalQuestionSource,
  QuestionNode,
  QuestionPayload,
  RagState,
  ReviewScopeMetadata,
  SessionsResponse,
  ViewerSessionSummary,
  ViewerTarget,
} from '@/lib/paper-types';

const DEBUG_STORAGE_KEY = 'rtq-question-viewer:raw-source-visible';
const HIDE_EMPTY_STORAGE_KEY = 'rtq-question-viewer:hide-empty-review-items';
const PREFERENCES_CHANGE_EVENT = 'rtq-question-viewer:preferences-change';
const POLL_INTERVAL_MS = 2000;
const EMPTY_PLACEHOLDER = '%empty%';
const DEFAULT_SESSION_ID = '1';
const PRIMARY_SESSION_IDS = Array.from({ length: 10 }, (_, index) =>
  String(index + 1),
);
const REVIEWER = 'up';

const REVIEW_RAGS = [
  { className: 'rag_prcc', label: 'PRCC', value: 'PRCC' },
  { className: 'rag_prcc', label: 'PRPCC', value: 'PRPCC' },
  { className: 'rag_prg', label: 'PRG', value: 'PRG' },
  { className: 'rag_prg2', label: 'PRG2', value: 'PRG2' },
  { className: 'rag_prcr', label: 'PRCR', value: 'PRCR' },
  { className: 'rag_prpcr', label: 'PRPCR', value: 'PRPCR' },
  { className: 'rag_prcs', label: 'PRCS', value: 'PRCS' },
  { className: 'rag_prrl', label: 'PRRL', value: 'PRRL' },
  { className: 'rag_prr', label: 'PRR', value: 'PRR' },
  { className: 'rag_pra', label: 'PRA', value: 'PRA' },
  { className: 'rag_prbd', label: 'PRBD', value: 'PRBD' },
  { className: 'rag_prct', label: 'PRCT', value: 'PRCT' },
] as const;

type LoadState =
  | { error: string; kind: 'error'; target: ViewerTarget | null }
  | { kind: 'loading' }
  | { kind: 'ready'; payload: QuestionPayload; sessionId: string }
  | { kind: 'waiting' };

type ReviewEndpointAction = 'comments' | 'rag' | 'reset-answer-comments';

type ReviewRequestStatus = {
  kind: 'error' | 'initial' | 'loading' | 'success';
  message: string;
};

type ReviewOverride = {
  comments?: string;
  reviewRag?: string;
};

function normalizeSessionId(sessionId: string | null | undefined) {
  return sessionId?.trim() || DEFAULT_SESSION_ID;
}

function targetKey(target: ViewerTarget) {
  return `${target.relativePathFromPapers}::${target.questionUuid}`;
}

function sessionTargetKey(sessionId: string, target: ViewerTarget) {
  return `${sessionId}::${targetKey(target)}`;
}

function readUrlSessionId() {
  if (typeof window === 'undefined') {
    return DEFAULT_SESSION_ID;
  }

  const params = new URLSearchParams(window.location.search);
  return normalizeSessionId(
    params.get('session') ??
      params.get('sessionId') ??
      params.get('context') ??
      params.get('contextId'),
  );
}

function readUrlTarget(): ViewerTarget | null {
  const params = new URLSearchParams(window.location.search);
  const relativePathFromPapers =
    params.get('file') ??
    params.get('relativePathFromPapers') ??
    params.get('path');
  const questionUuid = params.get('uuid') ?? params.get('questionUuid');

  if (!relativePathFromPapers || !questionUuid) {
    return null;
  }

  return {
    questionUuid,
    relativePathFromPapers,
  };
}

function targetUrl(sessionId: string, target: ViewerTarget | null) {
  const params = new URLSearchParams();
  params.set('session', normalizeSessionId(sessionId));

  if (target) {
    params.set('file', target.relativePathFromPapers);
    params.set('uuid', target.questionUuid);
  }

  return `/?${params.toString()}`;
}

function formatSourceId(value: string) {
  return value || 'unknown source';
}

function formatOriginalSource(source: OriginalQuestionSource) {
  if (
    source.paperStem &&
    source.sectionNumber !== null &&
    source.questionNumber !== null
  ) {
    return `${source.paperStem} / S${source.sectionNumber} Q${source.questionNumber} (${source.rawValue})`;
  }

  return source.rawValue;
}

function chipToneClass(tone: RagState['tone']) {
  return `rag-chip rag-chip--${tone}`;
}

function tagDimensionClass(tag: string) {
  if (tag.startsWith('family.')) return 'tag-chip--family';
  if (tag.startsWith('math.')) return 'tag-chip--math';
  if (tag.startsWith('frame.')) return 'tag-chip--frame';
  if (tag.startsWith('marker.')) return 'tag-chip--marker';
  if (tag.startsWith('reasoning.')) return 'tag-chip--reasoning';
  return 'tag-chip--legacy';
}

function reviewTone(value: string): RagState['tone'] {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'pr' || normalized === 'pra') return 'review-pending';
  if (normalized === 'prcs') return 'comingsoon';
  if (normalized === 'prr') return 'review-danger';
  if (normalized === 'prbd') return 'blocked';
  if (normalized === 'prg' || normalized === 'prg2') return 'review-success';
  if (normalized === 'prcr' || normalized === 'prpcr' || normalized === 'prrl')
    return 'review-warning';
  if (normalized === 'prcc' || normalized === 'prpcc') return 'review-success';
  return 'unknown';
}

function reviewStateFromOverride(value: string, label: string): RagState {
  return {
    key: 'review-override',
    label,
    rawValue: value,
    tone: reviewTone(value),
    value,
  };
}

async function submitReviewRequest(
  action: ReviewEndpointAction,
  body: Record<string, unknown>,
) {
  const response = await fetch(`/api/review/${action}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();
  let reason = text;

  try {
    const json = JSON.parse(text) as { reason?: string };
    reason = json.reason ?? text;
  } catch {
    reason = text;
  }

  throw new Error(reason || response.statusText);
}

function subscribeToPreferences(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(PREFERENCES_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(PREFERENCES_CHANGE_EVENT, onStoreChange);
  };
}

function readStoredBoolean(key: string) {
  return window.localStorage.getItem(key) === 'true';
}

function serverBooleanSnapshot() {
  return false;
}

function useStoredBoolean(key: string) {
  const getSnapshot = useCallback(() => readStoredBoolean(key), [key]);
  const value = useSyncExternalStore(
    subscribeToPreferences,
    getSnapshot,
    serverBooleanSnapshot,
  );
  const setValue = useCallback(
    (updater: boolean | ((current: boolean) => boolean)) => {
      const current = readStoredBoolean(key);
      const next = typeof updater === 'function' ? updater(current) : updater;

      window.localStorage.setItem(key, next ? 'true' : 'false');
      window.dispatchEvent(new Event(PREFERENCES_CHANGE_EVENT));
    },
    [key],
  );

  return [value, setValue] as const;
}

function isEmptyPlaceholder(value: string) {
  return value.trim().toLowerCase() === EMPTY_PLACEHOLDER;
}

function DebugBlock({ label, value }: { label: string; value: string }) {
  return (
    <details className="debug-block" open>
      <summary>{label}</summary>
      <pre>{value}</pre>
    </details>
  );
}

function RenderedList({
  emptyLabel,
  hideEmpty,
  label,
  values,
}: {
  emptyLabel: string;
  hideEmpty: boolean;
  label: string;
  values: string[];
}) {
  const visibleValues = hideEmpty
    ? values.filter(value => !isEmptyPlaceholder(value))
    : values;

  if (!visibleValues.length && hideEmpty && values.length > 0) {
    return null;
  }

  if (!visibleValues.length) {
    return (
      <section className="content-section content-section--empty">
        <h4>{label}</h4>
        <p>{emptyLabel}</p>
      </section>
    );
  }

  return (
    <section className="content-section">
      <h4>{label}</h4>
      <div className="content-section__stack">
        {visibleValues.map((value, index) => (
          <div className="content-entry" key={`${label}-${index}`}>
            {visibleValues.length > 1 ? (
              <div className="entry-label">
                {label} {index + 1}
              </div>
            ) : null}
            <RtqMarkdown markdown={value} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Tags({ node }: { node: QuestionNode }) {
  const explicit = node.effectiveTags.filter(tag => tag.source === 'explicit');
  const inherited = node.effectiveTags.filter(
    tag => tag.source === 'inherited',
  );
  const implicit = node.effectiveTags.filter(tag => tag.source === 'implicit');

  if (!node.effectiveTags.length) {
    return <span className="tag-empty">No tags</span>;
  }

  return (
    <div className="tag-groups" aria-label="Tags">
      {explicit.length ? (
        <div className="tag-group">
          <span className="tag-group__label">Own</span>
          {explicit.map(tag => (
            <span
              className={`tag-chip tag-chip--explicit ${tagDimensionClass(tag.value)}`}
              key={`explicit-${tag.value}`}>
              {tag.value}
            </span>
          ))}
        </div>
      ) : null}
      {inherited.length ? (
        <div className="tag-group">
          <span className="tag-group__label">Inherited</span>
          {inherited.map(tag => (
            <span
              className={`tag-chip tag-chip--inherited ${tagDimensionClass(tag.value)}`}
              key={`inherited-${tag.value}`}>
              {tag.value}
            </span>
          ))}
        </div>
      ) : null}
      {implicit.length ? (
        <div className="tag-group">
          <span className="tag-group__label">Implicit</span>
          {implicit.map(tag => (
            <span
              className={`tag-chip tag-chip--implicit ${tagDimensionClass(tag.value)}`}
              key={`implicit-${tag.value}`}>
              {tag.value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RagStates({ states }: { states: RagState[] }) {
  return (
    <div className="rag-list" aria-label="RAG states">
      {states.map(state => (
        <span
          className={chipToneClass(state.tone)}
          key={`${state.key}-${state.value}`}>
          <strong>{state.value}</strong>
        </span>
      ))}
    </div>
  );
}

function ReviewScopePanel({
  metadata,
  onOverride,
  override,
  sessionId,
  uuid,
}: {
  metadata: ReviewScopeMetadata;
  onOverride: (scopeKey: string, override: ReviewOverride) => void;
  override?: ReviewOverride;
  sessionId: string;
  uuid: string;
}) {
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<ReviewRequestStatus>({
    kind: 'initial',
    message: 'Initial',
  });
  const statusTimeoutRef = useRef<number | null>(null);
  const scopeKey = `${sessionId}:${uuid}:answer`;
  const title = 'Answer review';
  const reviewType = 'REVIEW_ANSWER';
  const displayedReviewRag = override?.reviewRag
    ? reviewStateFromOverride(override.reviewRag, title)
    : metadata.reviewRag;
  const displayedComments = override?.comments ?? metadata.comments;

  const setTimedStatus = useCallback(
    (nextStatus: ReviewRequestStatus, timeoutMs = 0) => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }

      setStatus(nextStatus);

      if (timeoutMs > 0) {
        statusTimeoutRef.current = window.setTimeout(() => {
          setStatus({ kind: 'initial', message: 'Initial' });
          statusTimeoutRef.current = null;
        }, timeoutMs);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const basePayload = useMemo(
    () => ({
      sheet: metadata.sheet,
      uuid,
    }),
    [metadata.sheet, uuid],
  );

  const submitRag = useCallback(
    async (rag: string) => {
      if (!metadata.sheet) {
        setTimedStatus(
          { kind: 'error', message: 'Error: review sheet unavailable' },
          3000,
        );
        return;
      }

      setTimedStatus({
        kind: 'loading',
        message: 'Submitting. Please wait ...',
      });

      try {
        await submitReviewRequest('rag', {
          ...basePayload,
          rag,
          reviewer: REVIEWER,
        });
        onOverride(scopeKey, { reviewRag: rag });
        setTimedStatus({ kind: 'success', message: 'Success' }, 3000);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        setTimedStatus({ kind: 'error', message: `Error: ${message}` }, 3000);
      }
    },
    [basePayload, metadata.sheet, onOverride, scopeKey, setTimedStatus],
  );

  const submitComment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!metadata.sheet || !comment.trim()) {
        setTimedStatus(
          { kind: 'error', message: 'Error: comment or review sheet missing' },
          3000,
        );
        return;
      }

      setTimedStatus({
        kind: 'loading',
        message: 'Submitting. Please wait ...',
      });

      try {
        await submitReviewRequest('comments', {
          ...basePayload,
          comment: comment.trim(),
          reviewer: REVIEWER,
        });
        onOverride(scopeKey, {
          comments: [displayedComments, comment.trim()]
            .filter(Boolean)
            .join('\n\n'),
        });
        setComment('');
        setTimedStatus({ kind: 'success', message: 'Success' }, 3000);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        setTimedStatus({ kind: 'error', message: `Error: ${message}` }, 3000);
      }
    },
    [
      basePayload,
      comment,
      displayedComments,
      metadata.sheet,
      onOverride,
      scopeKey,
      setTimedStatus,
    ],
  );

  const resetComments = useCallback(async () => {
    if (!metadata.sheet) {
      setTimedStatus(
        { kind: 'error', message: 'Error: review sheet unavailable' },
        3000,
      );
      return;
    }

    setTimedStatus({ kind: 'loading', message: 'Submitting. Please wait ...' });

    try {
      await submitReviewRequest('reset-answer-comments', basePayload);
      onOverride(scopeKey, { comments: '' });
      setTimedStatus({ kind: 'success', message: 'Success' }, 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setTimedStatus({ kind: 'error', message: `Error: ${message}` }, 3000);
    }
  }, [basePayload, metadata.sheet, onOverride, scopeKey, setTimedStatus]);

  return (
    <section className="review-scope" data-review-type={reviewType}>
      <header className="review-scope__header">
        <div>
          <p className="review-scope__eyebrow">
            {metadata.sheet ?? 'No sheet'}
          </p>
          <h4>{title}</h4>
        </div>
        <div className="review-scope__state">
          <span>Source {metadata.sourceRag?.value ?? 'missing'}</span>
          <strong>{displayedReviewRag?.value ?? 'PRNS'}</strong>
        </div>
      </header>

      <div className="review-actions" aria-label={`${title} states`}>
        {REVIEW_RAGS.map(rag => (
          <button
            className={`review-action ${rag.className}`}
            data-rag={rag.value}
            data-review-type={reviewType}
            data-reviewer={REVIEWER}
            data-sheet={metadata.sheet ?? undefined}
            data-uuid={uuid}
            disabled={!metadata.sheet || status.kind === 'loading'}
            key={`answer-${rag.value}`}
            onClick={() => void submitRag(rag.value)}
            type="button">
            {rag.label}
          </button>
        ))}
        <button
          className="review-action rag_prct"
          data-review-type={reviewType}
          data-sheet={metadata.sheet ?? undefined}
          data-uuid={uuid}
          disabled={!metadata.sheet || status.kind === 'loading'}
          onClick={() => void resetComments()}
          type="button">
          Reset Comments
        </button>
      </div>

      {displayedComments ? (
        <div className="review-comments">
          <pre>{displayedComments}</pre>
        </div>
      ) : null}

      <form
        className="review-form"
        onSubmit={event => void submitComment(event)}>
        <textarea
          name="comment"
          onChange={event => setComment(event.target.value)}
          placeholder="Enter review comments ..."
          required
          rows={5}
          value={comment}
        />
        <div className="review-form__actions">
          <button
            disabled={!metadata.sheet || status.kind === 'loading'}
            type="submit">
            Submit
          </button>
          <button onClick={() => setComment('')} type="button">
            Reset
          </button>
        </div>
      </form>

      <p className={`review-status review-status--${status.kind}`}>
        {status.message}
      </p>
    </section>
  );
}

function ReviewPane({
  node,
  onOverride,
  overrides,
  sessionId,
}: {
  node: QuestionNode;
  onOverride: (scopeKey: string, override: ReviewOverride) => void;
  overrides: Record<string, ReviewOverride>;
  sessionId: string;
}) {
  if (!node.uuid || !node.review) {
    return null;
  }

  return (
    <section className="review-pane">
      <header className="review-pane__header">
        <div>
          <p className="review-pane__eyebrow">Review pane</p>
          <h3>Answer Review</h3>
        </div>
        <code>{node.uuid}</code>
      </header>
      <div className="review-pane__grid">
        <ReviewScopePanel
          metadata={node.review.answer}
          onOverride={onOverride}
          override={overrides[`${sessionId}:${node.uuid}:answer`]}
          sessionId={sessionId}
          uuid={node.uuid}
        />
      </div>
    </section>
  );
}

function SessionSwitcher({
  onSelect,
  selectedSessionId,
  sessions,
}: {
  onSelect: (sessionId: string) => void;
  selectedSessionId: string;
  sessions: ViewerSessionSummary[];
}) {
  const sessionsById = useMemo(
    () => new Map(sessions.map(session => [session.sessionId, session])),
    [sessions],
  );
  const visibleSessionIds = useMemo(() => {
    const discoveredSessionIds = sessions
      .map(session => session.sessionId)
      .filter(sessionId => !PRIMARY_SESSION_IDS.includes(sessionId));

    return [...PRIMARY_SESSION_IDS, ...discoveredSessionIds];
  }, [sessions]);

  return (
    <div className="session-switcher" aria-label="Viewer sessions">
      <span className="session-switcher__label">Session</span>
      <div className="session-switcher__buttons">
        {visibleSessionIds.map(sessionId => {
          const session = sessionsById.get(sessionId);
          const isSelected = sessionId === selectedSessionId;
          const hasTarget = Boolean(session?.hasTarget);

          return (
            <button
              aria-label={`Show session ${sessionId}`}
              aria-pressed={isSelected}
              className={`session-button${hasTarget ? 'session-button--has-target' : ''}`}
              key={sessionId}
              onClick={() => onSelect(sessionId)}
              title={
                hasTarget
                  ? `Session ${sessionId} has an active target`
                  : `Show session ${sessionId}`
              }
              type="button">
              <span>{sessionId}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RawSource({ node }: { node: QuestionNode }) {
  return (
    <section className="raw-source">
      <h4>Raw source</h4>
      <DebugBlock label="Question" value={node.content.raw.question} />
      {node.content.raw.workings.map((working, index) => (
        <div className="debug-grid" key={`working-${index}`}>
          {working.formulas.map((formula, itemIndex) => (
            <DebugBlock
              key={`formula-${itemIndex}`}
              label={`Working ${index + 1} · Formula ${itemIndex + 1}`}
              value={formula.formula}
            />
          ))}
          {working.tips.map((tip, itemIndex) => (
            <DebugBlock
              key={`tip-${itemIndex}`}
              label={`Working ${index + 1} · Tip ${itemIndex + 1}`}
              value={tip.tip}
            />
          ))}
          <DebugBlock label={`Working ${index + 1}`} value={working.working} />
        </div>
      ))}
      {node.content.raw.answers.map((answer, index) => (
        <div className="debug-grid" key={`answer-${index}`}>
          <DebugBlock label={`Answer ${index + 1}`} value={answer.answer} />
          <DebugBlock label={`Option ${index + 1}`} value={answer.option} />
          <DebugBlock label={`Key ${index + 1}`} value={answer.key} />
        </div>
      ))}
    </section>
  );
}

function NodeCard({
  hideEmpty,
  node,
  rawVisible,
}: {
  hideEmpty: boolean;
  node: QuestionNode;
  rawVisible: boolean;
}) {
  const rendered = node.content.rendered;

  return (
    <article className={`question-node question-node--depth-${node.depth}`}>
      <header className="node-header">
        <div>
          <div className="node-eyebrow">{node.kind}</div>
          <h2>{node.hierarchyLabel}</h2>
        </div>
        <div className="node-identifiers">
          <span>
            UUID <strong className="node-uuid">{node.uuid ?? 'missing'}</strong>
          </span>
          {node.originalSource ? (
            <span>
              Original{' '}
              <strong>{formatOriginalSource(node.originalSource)}</strong>
            </span>
          ) : node.isRootNode ? (
            <span>
              Source <strong>{formatSourceId(node.sourceId)}</strong>
            </span>
          ) : null}
        </div>
      </header>

      <div className="node-meta-grid">
        {node.isRootNode && node.ragStates.length ? (
          <section>
            <h3>RAG state</h3>
            <RagStates states={node.ragStates} />
          </section>
        ) : null}
        <section>
          <h3>Tags</h3>
          <Tags node={node} />
        </section>
      </div>

      <section className="content-section">
        <h4>Question</h4>
        <RtqMarkdown markdown={rendered.question} />
      </section>
      <RenderedList
        emptyLabel="No formulas array present"
        hideEmpty={hideEmpty}
        label="Formulas"
        values={rendered.formulas}
      />
      <RenderedList
        emptyLabel="No tips array present"
        hideEmpty={hideEmpty}
        label="Tips"
        values={rendered.tips}
      />
      <RenderedList
        emptyLabel="No workings array present"
        hideEmpty={hideEmpty}
        label="Working"
        values={rendered.workings}
      />
      <RenderedList
        emptyLabel="No answers array present"
        hideEmpty={hideEmpty}
        label="Answers"
        values={rendered.answers}
      />

      {rawVisible ? <RawSource node={node} /> : null}

      {node.children.length ? (
        <div className="node-children">
          {node.children.map(child => (
            <NodeCard
              hideEmpty={hideEmpty}
              key={child.path}
              node={child}
              rawVisible={rawVisible}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

async function postTarget(sessionId: string, target: ViewerTarget) {
  const response = await fetch('/api/view-target', {
    body: JSON.stringify({
      ...target,
      sessionId,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const body = await response.json();

  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? 'Unable to set target.');
  }

  return body.payload as QuestionPayload;
}

async function fetchCurrent(sessionId: string) {
  const params = new URLSearchParams();
  params.set('sessionId', sessionId);
  const response = await fetch(`/api/current-question?${params.toString()}`, {
    cache: 'no-store',
  });
  const body = (await response.json()) as CurrentQuestionResponse;

  if (!response.ok || !body.ok) {
    return body;
  }

  return body;
}

async function fetchSessions() {
  const response = await fetch('/api/sessions', {
    cache: 'no-store',
  });
  const body = (await response.json()) as SessionsResponse;

  if (!response.ok || !body.ok) {
    throw new Error('Unable to load sessions.');
  }

  return body.sessions;
}

export function QuestionViewerApp({
  initialSessionId,
}: {
  initialSessionId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selectedSessionId, setSelectedSessionId] = useState(() =>
    normalizeSessionId(initialSessionId),
  );
  const [sessions, setSessions] = useState<ViewerSessionSummary[]>([]);
  const [reviewOverrides, setReviewOverrides] = useState<
    Record<string, ReviewOverride>
  >({});
  const [rawVisible, setRawVisible] = useStoredBoolean(DEBUG_STORAGE_KEY);
  const [hideEmpty, setHideEmpty] = useStoredBoolean(HIDE_EMPTY_STORAGE_KEY);
  const lastPostedUrlTargetRef = useRef<string | null>(null);

  const currentPayload =
    state.kind === 'ready' && state.sessionId === selectedSessionId
      ? state.payload
      : null;
  const currentTarget = currentPayload?.target ?? null;
  const statusCopy = useMemo(() => {
    if (state.kind === 'waiting') return 'Waiting for target';
    if (state.kind === 'loading') return 'Loading';
    if (state.kind === 'error') return 'Target error';
    return 'Live';
  }, [state.kind]);

  const loadSessions = useCallback(async () => {
    setSessions(await fetchSessions());
  }, []);

  const loadCurrent = useCallback(async () => {
    const result = await fetchCurrent(selectedSessionId);

    if (!result.ok) {
      setState(
        result.target
          ? { error: result.error, kind: 'error', target: result.target }
          : { kind: 'waiting' },
      );
      return;
    }

    setState({
      kind: 'ready',
      payload: result.payload,
      sessionId: result.sessionId,
    });
  }, [selectedSessionId]);

  const handleReviewOverride = useCallback(
    (scopeKey: string, override: ReviewOverride) => {
      setReviewOverrides(current => ({
        ...current,
        [scopeKey]: {
          ...current[scopeKey],
          ...override,
        },
      }));
    },
    [],
  );

  useEffect(() => {
    const urlSessionId = readUrlSessionId();
    const urlTarget = readUrlTarget();

    if (urlTarget && urlSessionId !== selectedSessionId) {
      const timeoutId = window.setTimeout(() => {
        setState({ kind: 'loading' });
        void loadCurrent();
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    if (!urlTarget) {
      const timeoutId = window.setTimeout(() => {
        setState({ kind: 'loading' });
        void loadCurrent();
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }

    if (
      lastPostedUrlTargetRef.current ===
      sessionTargetKey(selectedSessionId, urlTarget)
    ) {
      const timeoutId = window.setTimeout(() => void loadCurrent(), 0);
      return () => window.clearTimeout(timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      const key = sessionTargetKey(selectedSessionId, urlTarget);
      lastPostedUrlTargetRef.current = key;
      setState({ kind: 'loading' });
      postTarget(selectedSessionId, urlTarget)
        .then(payload => {
          setState({ kind: 'ready', payload, sessionId: selectedSessionId });
          void loadSessions().catch(() => undefined);
        })
        .catch(error => {
          setState({
            error:
              error instanceof Error
                ? error.message
                : 'Unable to set target from URL.',
            kind: 'error',
            target: urlTarget,
          });
        });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCurrent, loadSessions, selectedSessionId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSessions().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSessions]);

  useEffect(() => {
    document.title = `Session ${selectedSessionId} - RTQ Question Viewer`;
  }, [selectedSessionId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void loadSessions().catch(() => undefined);
      void loadCurrent().catch(error => {
        setState({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to refresh the current question.',
          kind: 'error',
          target: currentTarget,
        });
      });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [currentTarget, loadCurrent, loadSessions]);

  useEffect(() => {
    const nextUrl = targetUrl(selectedSessionId, currentTarget);
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      router.replace(nextUrl, { scroll: false });
    }
  }, [currentTarget, router, selectedSessionId]);

  return (
    <main className="viewer-shell">
      <header className="viewer-topbar">
        <div className="viewer-topbar__main">
          <div>
            <p className="viewer-eyebrow">RTQ question viewport</p>
            <h1>Question Review</h1>
          </div>
        </div>
        <div className="viewer-session-row">
          <SessionSwitcher
            onSelect={sessionId => {
              setState({ kind: 'loading' });
              setSelectedSessionId(normalizeSessionId(sessionId));
            }}
            selectedSessionId={selectedSessionId}
            sessions={sessions}
          />
        </div>
        <div className="viewer-actions">
          <span className={`live-pill live-pill--${state.kind}`}>
            {statusCopy}
          </span>
          <button
            aria-pressed={rawVisible}
            className="toggle-button"
            onClick={() => setRawVisible(current => !current)}
            type="button">
            <span className="toggle-button__dot" />
            Raw source
          </button>
          <button
            aria-pressed={hideEmpty}
            className="toggle-button"
            onClick={() => setHideEmpty(current => !current)}
            type="button">
            <span className="toggle-button__dot" />
            Hide empty
          </button>
        </div>
      </header>

      {currentPayload ? (
        <>
          <section className="document-strip">
            <span>
              File{' '}
              <strong>{currentPayload.document.relativePathFromPapers}</strong>
            </span>
            <span>
              Hash{' '}
              <strong>
                {currentPayload.document.versionHash.slice(0, 10)}
              </strong>
            </span>
          </section>
          <NodeCard
            hideEmpty={hideEmpty}
            node={currentPayload.question}
            rawVisible={rawVisible}
          />
          <ReviewPane
            node={currentPayload.question}
            onOverride={handleReviewOverride}
            overrides={reviewOverrides}
            sessionId={selectedSessionId}
          />
        </>
      ) : null}

      {state.kind === 'waiting' ? (
        <section className="empty-state">
          <p className="empty-state__label">No active target</p>
          <h2>Waiting for an agent or URL to select a question.</h2>
          <code>POST /api/view-target</code>
        </section>
      ) : null}

      {state.kind === 'loading' ? (
        <section className="empty-state">
          <p className="empty-state__label">Loading</p>
          <h2>Preparing the current question.</h2>
        </section>
      ) : null}

      {state.kind === 'error' ? (
        <section className="empty-state empty-state--error">
          <p className="empty-state__label">Error</p>
          <h2>{state.error}</h2>
          {state.target ? <code>{targetKey(state.target)}</code> : null}
        </section>
      ) : null}
    </main>
  );
}
