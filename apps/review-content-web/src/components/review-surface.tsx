'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import {
  DIMENSIONAL_TAG_AXES,
  clearAllReviewFilters,
  filterReviewPaper,
  parseReviewFilterSearchParams,
  serializeReviewFilterSearchParams,
  type DimensionalTagAxis,
  type ReviewFilterSelection,
  type ReviewPaperNode,
} from '@rtq/review-paper-model/client';

import type {
  DisplayContentField,
  DisplayPaperNode,
  DisplayReviewPaper,
  DisplayWorkingSegment,
} from '@/lib/display-model';
import {
  DEFAULT_REVIEW_PREFERENCES,
  INITIAL_REVIEW_PREFERENCES_KEY,
  LEGACY_REVIEW_PREFERENCES_KEY,
  REVIEW_PREFERENCES_KEY,
  adjacentQuestionId,
  parseReviewPreferences,
  reviewStateLabel,
  visibleReviewSides,
  type ReviewPreferences,
  type ReviewControlMode,
} from '@/lib/review-view-model';
import {
  REVIEW_OUTCOMES,
  partitionReviewComments,
  reviewCommentTargetForNode,
  reviewTargetForNode,
  reviewTargetKey,
  runUniqueReviewRequest,
  type LocalReviewComment,
  type ReviewCommentLoad,
  type ReviewOutcomeDestination,
  type ReviewOutcomeLoad,
  type ReviewOutcomeSelection,
  type ReviewSide,
  type ReviewTargetDescriptor,
} from '@/lib/review-types';
import {
  evaluateSourceFreshness,
  sourceVersionUrl,
  type SourceFreshnessStatus,
} from '@/lib/source-freshness';

import { RtqMarkdown } from './rtq-markdown';
import { SiteHeader } from './site-header';

const axisCopy: Readonly<Record<DimensionalTagAxis, string>> = {
  family: 'Family',
  frame: 'Frame',
  marker: 'Marker',
  math: 'Math',
  reasoning: 'Reasoning',
};

function hasField(field: DisplayContentField): boolean {
  return Boolean(field.rendered.trim() || field.raw.trim());
}

function ContentField({
  field,
  hideLabel = false,
  label,
  preferences,
}: {
  field: DisplayContentField;
  hideLabel?: boolean;
  label: string;
  preferences: ReviewPreferences;
}) {
  if (!hasField(field)) return null;
  return (
    <div
      className={`content-field${hideLabel ? ' content-field--unlabelled' : ''}`}
    >
      {hideLabel ? null : <div className="content-field-label">{label}</div>}
      {field.rendered.trim() ? <RtqMarkdown markdown={field.rendered} /> : null}
      <FieldSupportingInfo
        field={field}
        label={label}
        preferences={preferences}
      />
    </div>
  );
}

function FieldSupportingInfo({
  field,
  label,
  preferences,
}: {
  field: DisplayContentField;
  label: string;
  preferences: ReviewPreferences;
}) {
  return (
    <>
      {field.preparationIssue ? (
        <p className="preparation-issue" role="status">
          Content preparation note: {field.preparationIssue}
        </p>
      ) : null}
      {preferences.showRaw ? (
        <details className="raw-source" open>
          <summary>{label} source</summary>
          <pre>
            <code>{field.raw || '(empty)'}</code>
          </pre>
        </details>
      ) : null}
    </>
  );
}

function statusValue(value: string | undefined): string {
  return value ?? 'Not set';
}

type ReviewRuntimeState = Readonly<{
  appendComment: (
    target: ReviewTargetDescriptor,
    comment: string,
    submissionId: string,
  ) => Promise<LocalReviewComment>;
  commentError?: string;
  comments: readonly LocalReviewComment[];
  outcomeDestination: ReviewOutcomeDestination;
  outcomeError?: string;
  outcomeOverrides: Readonly<Record<string, ReviewOutcomeSelection>>;
  pendingKeys: ReadonlySet<string>;
  reviewer: string;
  showPreviousFeedback: boolean;
  source: Readonly<{ collectionId: string; relativePath: string }>;
  submitOutcome: (
    target: ReviewTargetDescriptor,
    outcome: ReviewOutcomeSelection,
  ) => Promise<string>;
}>;

type ReviewActionStatus = Readonly<{
  kind: 'error' | 'idle' | 'success';
  message: string;
}>;

function utcDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function CommentList({
  comments,
  current,
}: {
  comments: readonly LocalReviewComment[];
  current: boolean;
}) {
  if (comments.length === 0) {
    return current ? (
      <p className="comment-empty">No comments in this state.</p>
    ) : null;
  }
  return (
    <ol className={`comment-list${current ? '' : ' comment-list--history'}`}>
      {comments.map((comment) => (
        <li key={comment.id}>
          <div>
            <strong>{comment.reviewer}</strong>
            <time dateTime={comment.createdAt}>
              {utcDateTime(comment.createdAt)}
            </time>
            {!current ? (
              <span title={comment.ragState}>
                {reviewStateLabel(comment.ragState)} · not current
              </span>
            ) : null}
          </div>
          <p>{comment.comment}</p>
        </li>
      ))}
    </ol>
  );
}

function targetUnavailableReason(
  node: DisplayPaperNode,
  topLevelQuestion: DisplayPaperNode,
  side: ReviewSide,
): string {
  if (!node.uuid) return 'rtq-uuid is unavailable.';
  if (!topLevelQuestion.review[side].contentRag) {
    return `${side === 'question' ? 'Question' : 'Answer'} RAG is unavailable on the top-level question.`;
  }
  return 'Review metadata is unavailable.';
}

function ReviewScope({
  controlMode,
  node,
  outcomesEnabled,
  runtime,
  side,
  topLevelQuestion,
}: {
  controlMode: ReviewControlMode;
  node: DisplayPaperNode;
  outcomesEnabled: boolean;
  runtime: ReviewRuntimeState;
  side: ReviewSide;
  topLevelQuestion: DisplayPaperNode;
}) {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ReviewActionStatus>({
    kind: 'idle',
    message: '',
  });
  const submissionId = useRef<string | undefined>(undefined);
  const target = outcomesEnabled
    ? reviewTargetForNode(node, side, runtime.source)
    : reviewCommentTargetForNode(node, topLevelQuestion, side, runtime.source);
  const key = target ? reviewTargetKey(target) : `${node.id}:${side}`;
  const outcomePending = runtime.pendingKeys.has(`${key}:outcome`);
  const commentPending = runtime.pendingKeys.has(`${key}:comment`);
  const commentGroups = target
    ? partitionReviewComments(runtime.comments, target)
    : { current: [], history: [] };
  const hasFeedback =
    commentGroups.current.length > 0 || commentGroups.history.length > 0;
  const displayedOutcome = Object.hasOwn(runtime.outcomeOverrides, key)
    ? runtime.outcomeOverrides[key]
    : runtime.outcomeDestination === 'google-sheets'
      ? node.review[side].reviewOutcome
      : undefined;
  const outcomeDisabledReason = !target
    ? targetUnavailableReason(node, topLevelQuestion, side)
    : runtime.outcomeError
      ? runtime.outcomeError
      : runtime.outcomeDestination === 'google-sheets' && !target.sheet
        ? `Source state ${reviewStateLabel(target.ragState)} has no Google Sheets route.`
        : undefined;
  const commentDisabledReason = !target
    ? targetUnavailableReason(node, topLevelQuestion, side)
    : runtime.commentError;

  async function submitOutcome(outcome: ReviewOutcomeSelection) {
    if (!target || outcomeDisabledReason || outcomePending) return;
    setStatus({ kind: 'idle', message: '' });
    try {
      const message = await runtime.submitOutcome(target, outcome);
      setStatus({ kind: 'success', message });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Outcome failed.',
      });
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || commentPending || commentDisabledReason) return;
    const comment = draft.trim();
    if (!comment) {
      setStatus({
        kind: 'error',
        message: 'Enter a comment before adding it.',
      });
      return;
    }
    submissionId.current ??= crypto.randomUUID();
    setStatus({ kind: 'idle', message: '' });
    try {
      await runtime.appendComment(target, comment, submissionId.current);
      submissionId.current = undefined;
      setDraft('');
      setStatus({
        kind: 'success',
        message: 'Comment added to local review history.',
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Comment failed.',
      });
    }
  }

  return (
    <section
      className={`review-scope review-scope--${side}${
        status.kind === 'success' ? ' review-scope--success' : ''
      }`}
    >
      <header>
        <div>
          <span>{outcomesEnabled ? `${side} review` : `${side} feedback`}</span>
          <h4>{side === 'question' ? 'Question' : 'Answer'}</h4>
        </div>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>
              {target
                ? reviewStateLabel(target.ragState)
                : statusValue(node.review[side].contentRag)}
            </dd>
          </div>
          {outcomesEnabled ? (
            <>
              <div>
                <dt>Outcome</dt>
                <dd>
                  {displayedOutcome
                    ? reviewStateLabel(displayedOutcome)
                    : 'Not reviewed'}
                </dd>
              </div>
              {controlMode === 'advanced' &&
              runtime.outcomeDestination === 'google-sheets' ? (
                <div>
                  <dt>Sheet</dt>
                  <dd>{target?.sheet ?? 'Unavailable'}</dd>
                </div>
              ) : null}
            </>
          ) : null}
        </dl>
      </header>

      {outcomesEnabled ? (
        <>
          {controlMode === 'simple' ? (
            <div
              aria-label={`${side} simple review outcomes`}
              className="simple-outcome-actions"
            >
              <button
                aria-pressed={displayedOutcome === 'PRG'}
                className="simple-outcome-approve"
                disabled={Boolean(outcomeDisabledReason) || outcomePending}
                onClick={() => void submitOutcome('PRG')}
                title={outcomeDisabledReason}
                type="button"
              >
                Approved
              </button>
              <button
                aria-pressed={!displayedOutcome}
                className="simple-outcome-reset"
                disabled={Boolean(outcomeDisabledReason) || outcomePending}
                onClick={() => void submitOutcome(null)}
                title={outcomeDisabledReason}
                type="button"
              >
                Reset
              </button>
            </div>
          ) : (
            <div
              className="outcome-actions"
              aria-label={`${side} review outcomes`}
            >
              {REVIEW_OUTCOMES.map((outcome) => (
                <button
                  aria-pressed={
                    reviewStateLabel(displayedOutcome ?? '') === outcome
                  }
                  disabled={Boolean(outcomeDisabledReason) || outcomePending}
                  key={outcome}
                  onClick={() => void submitOutcome(outcome)}
                  title={outcomeDisabledReason}
                  type="button"
                >
                  {outcome}
                </button>
              ))}
            </div>
          )}
          {outcomeDisabledReason ? (
            <p className="review-unavailable">{outcomeDisabledReason}</p>
          ) : null}
        </>
      ) : null}

      <form
        className="comment-form"
        onSubmit={(event) => void submitComment(event)}
      >
        <label>
          Add feedback as {runtime.reviewer}
          <textarea
            disabled={Boolean(commentDisabledReason)}
            maxLength={10_000}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Append a state-specific comment…"
            rows={3}
            value={draft}
          />
        </label>
        <button
          disabled={Boolean(commentDisabledReason) || commentPending}
          type="submit"
        >
          {commentPending ? 'Adding locally…' : 'Add comment'}
        </button>
      </form>
      {commentDisabledReason ? (
        <p className="review-unavailable">{commentDisabledReason}</p>
      ) : null}
      {status.message ? (
        <p
          className={`review-action-status review-action-status--${status.kind}`}
          role="status"
        >
          {status.message}
        </p>
      ) : null}

      <section
        aria-label={`${side} feedback`}
        aria-live="polite"
        className={`feedback-region${hasFeedback ? ' feedback-region--populated' : ''}`}
      >
        <div className="comment-heading">
          <div>
            <strong>
              {side === 'question' ? 'Question' : 'Answer'} feedback
            </strong>
            <span>
              {target ? reviewStateLabel(target.ragState) : 'State unavailable'}
            </span>
          </div>
          <span>
            {commentGroups.current.length} current ·{' '}
            {commentGroups.history.length} previous
          </span>
        </div>
        <CommentList comments={commentGroups.current} current />
        {runtime.showPreviousFeedback && commentGroups.history.length > 0 ? (
          <section className="comment-history">
            <div className="comment-history-heading">
              <strong>Previous feedback</strong>
              <span>{commentGroups.history.length} read only</span>
            </div>
            <p>These comments do not apply to the current RAG state.</p>
            <CommentList comments={commentGroups.history} current={false} />
          </section>
        ) : null}
      </section>

      {node.review[side].legacyComments ? (
        <details className="legacy-source-comments">
          <summary>Legacy synchronized comment</summary>
          <pre>{node.review[side].legacyComments}</pre>
        </details>
      ) : null}
    </section>
  );
}

function ReviewPanel({
  node,
  preferences,
  runtime,
  topLevelQuestion,
}: {
  node: DisplayPaperNode;
  preferences: ReviewPreferences;
  runtime: ReviewRuntimeState;
  topLevelQuestion: DisplayPaperNode;
}) {
  const outcomesEnabled = node.depth === 0;
  const visibleSides = visibleReviewSides(preferences);
  return (
    <aside
      className={`review-panel${outcomesEnabled ? '' : ' review-panel--nested'}`}
      aria-label={`${node.label} review status`}
    >
      <div className="review-panel-heading">
        <span>{outcomesEnabled ? 'Review workflow' : 'Node feedback'}</span>
        <span>
          {outcomesEnabled
            ? 'Outcomes → Sheets · comments → local SQLite'
            : `Own UUID · RAG inherited from ${topLevelQuestion.label}`}
        </span>
      </div>
      <div className="review-scopes" data-visible-sides={visibleSides.length}>
        {visibleSides.map((side) => (
          <ReviewScope
            controlMode={preferences.reviewControlMode}
            key={side}
            node={node}
            outcomesEnabled={outcomesEnabled}
            runtime={runtime}
            side={side}
            topLevelQuestion={topLevelQuestion}
          />
        ))}
      </div>
    </aside>
  );
}

function NodeTags({ node }: { node: DisplayPaperNode }) {
  return (
    <div className="node-tags" aria-label={`${node.label} dimensional tags`}>
      {DIMENSIONAL_TAG_AXES.map((axis) => {
        const tags = node.effectiveTags.filter((tag) => tag.axis === axis);
        return tags.length ? (
          <div className={`tag-group tag-group--${axis}`} key={axis}>
            <span>{axisCopy[axis]}</span>
            {tags.map((tag) => (
              <code key={`${tag.value}:${tag.origin}`} title={tag.origin}>
                {tag.value.slice(axis.length + 1)}
                {tag.origin === 'inherited' ? ' ↳' : ''}
                {tag.origin === 'implicit' ? ' · default' : ''}
              </code>
            ))}
          </div>
        ) : null;
      })}
    </div>
  );
}

function WorkingStage({
  first,
  segment,
  terminal,
}: {
  first: boolean;
  segment: Extract<DisplayWorkingSegment, { kind: 'section' }>;
  terminal: boolean;
}) {
  return (
    <section
      aria-label={segment.title ? undefined : `${segment.phase} working stage`}
      className={`working-stage${segment.title ? '' : ' working-stage--untitled'}`}
      data-first={first}
      data-phase={segment.phase}
      data-terminal={terminal}
    >
      <span aria-hidden="true" className="working-stage-track">
        <span className="working-stage-rail working-stage-rail--start" />
        <span className="working-stage-marker" />
        <span className="working-stage-rail working-stage-rail--end" />
        {terminal ? <span className="working-stage-terminal" /> : null}
      </span>
      {segment.title ? (
        <div className="working-stage-title-rule">
          <span aria-hidden="true" />
          <h5>{segment.title}</h5>
          <span aria-hidden="true" />
        </div>
      ) : null}
      <div className="working-stage-body">
        {segment.rendered ? <RtqMarkdown markdown={segment.rendered} /> : null}
      </div>
    </section>
  );
}

function WorkingBody({
  field,
  preferences,
}: {
  field: DisplayContentField;
  preferences: ReviewPreferences;
}) {
  const segments = field.workingSegments;
  if (!segments) {
    return (
      <ContentField
        field={field}
        hideLabel
        label="Working"
        preferences={preferences}
      />
    );
  }

  const visibleStageCount = segments.filter(
    (segment) => segment.kind === 'section' && segment.visibility === 'visible',
  ).length;
  let stageIndex = 0;

  return (
    <div className="content-field content-field--unlabelled">
      <div
        className="working-section-sequence"
        data-stage-count={visibleStageCount}
      >
        {segments.map((segment, index) => {
          if (segment.kind === 'flat') {
            return segment.rendered ? (
              <div className="working-flat-segment" key={`flat-${index}`}>
                <RtqMarkdown markdown={segment.rendered} />
              </div>
            ) : null;
          }
          if (segment.visibility === 'hidden') return null;
          const currentStage = stageIndex++;
          return (
            <WorkingStage
              first={currentStage === 0}
              key={`section-${index}`}
              segment={segment}
              terminal={currentStage === visibleStageCount - 1}
            />
          );
        })}
      </div>
      <FieldSupportingInfo
        field={field}
        label="Working"
        preferences={preferences}
      />
    </div>
  );
}

function SolutionContentRow({
  fields,
  kind,
  label,
  preferences,
}: {
  fields: readonly DisplayContentField[];
  kind: 'formulas' | 'tips';
  label: string;
  preferences: ReviewPreferences;
}) {
  if (!fields.some(hasField)) return null;
  return (
    <div className={`solution-row solution-row--${kind}`}>
      <div className="solution-row-label">{label}</div>
      <div className="solution-row-body">
        {fields.map((field, index) => (
          <ContentField
            field={field}
            hideLabel
            key={index}
            label={`${kind === 'formulas' ? 'Formula' : 'Tip'} ${index + 1}`}
            preferences={preferences}
          />
        ))}
      </div>
    </div>
  );
}

function hasVisibleWorking(
  field: DisplayContentField,
  preferences: ReviewPreferences,
): boolean {
  if (!field.workingSegments) return hasField(field);
  return Boolean(
    field.preparationIssue ||
    (preferences.showRaw && field.raw.trim()) ||
    field.workingSegments.some(
      (segment) => segment.kind === 'flat' || segment.visibility === 'visible',
    ),
  );
}

function SolutionContent({
  node,
  preferences,
}: {
  node: DisplayPaperNode;
  preferences: ReviewPreferences;
}) {
  if (!preferences.showSolutions) return null;
  const hasWorkings = node.content.workings.some(
    (working) =>
      hasVisibleWorking(working.working, preferences) ||
      working.formulas.some(hasField) ||
      working.tips.some(hasField),
  );
  const hasAnswers = node.content.answers.some(
    (answer) =>
      hasField(answer.option) ||
      hasField(answer.key) ||
      hasField(answer.answer),
  );
  if (!hasWorkings && !hasAnswers) return null;

  return (
    <div className="solution-grid">
      {hasWorkings ? (
        <section className="solution-block">
          <h4>Working</h4>
          {node.content.workings.map((working, index) => (
            <div className="solution-entry working-entry" key={index}>
              {index > 0 ? (
                <div className="working-method-divider">
                  <span>Method {index + 1}</span>
                  <span aria-hidden="true" />
                </div>
              ) : null}
              <div className="working-content-rows">
                <SolutionContentRow
                  fields={working.formulas}
                  kind="formulas"
                  label="Formulas used"
                  preferences={preferences}
                />
                <SolutionContentRow
                  fields={working.tips}
                  kind="tips"
                  label="Keep in mind"
                  preferences={preferences}
                />
                {hasVisibleWorking(working.working, preferences) ? (
                  <div className="solution-row solution-row--working">
                    <div
                      aria-hidden="true"
                      className="solution-row-label solution-row-label--spacer"
                    />
                    <div className="solution-row-body">
                      <WorkingBody
                        field={working.working}
                        preferences={preferences}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {hasAnswers ? (
        <section className="solution-block solution-block--answers">
          <h4>Answers</h4>
          {node.content.answers.map((answer, index) => (
            <div className="solution-entry" key={index}>
              {node.content.answers.length > 1 ? (
                <span className="entry-number">Answer {index + 1}</span>
              ) : null}
              <ContentField
                field={answer.option}
                label="Option"
                preferences={preferences}
              />
              <ContentField
                field={answer.key}
                label="Key"
                preferences={preferences}
              />
              <ContentField
                field={answer.answer}
                label="Answer"
                preferences={preferences}
              />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function QuestionNode({
  active,
  matchingNodeIds,
  node,
  onActivate,
  preferences,
  reviewRuntime,
  topLevelQuestion,
}: {
  active: boolean;
  matchingNodeIds: ReadonlySet<string>;
  node: DisplayPaperNode;
  onActivate: () => void;
  preferences: ReviewPreferences;
  reviewRuntime: ReviewRuntimeState;
  topLevelQuestion: DisplayPaperNode;
}) {
  const exactMatch = matchingNodeIds.has(node.id);
  return (
    <article
      className={`question-node question-node--depth-${node.depth}${
        active && node.depth === 0 ? ' question-node--active' : ''
      }${exactMatch ? '' : ' question-node--context'}`}
      id={`question-${node.id}`}
      onFocusCapture={(event) => {
        if (event.target === event.currentTarget) onActivate();
      }}
      tabIndex={node.depth === 0 ? 0 : -1}
    >
      <header className="question-heading">
        <div className="question-label">
          <span>{node.kind.replaceAll('-', ' ')}</span>
          <h3>{node.label}</h3>
        </div>
        <div className="question-identifiers">
          {node.uuid ? <code>UUID {node.uuid}</code> : null}
          <code>{node.sourceQuestionId}</code>
          {node.originalSource?.paperStem ? (
            <span>Source · {node.originalSource.paperStem}</span>
          ) : null}
        </div>
      </header>

      {preferences.showTags ? <NodeTags node={node} /> : null}
      <div className="question-copy">
        <ContentField
          field={node.content.question}
          label="Question"
          preferences={preferences}
        />
      </div>
      <SolutionContent node={node} preferences={preferences} />
      {visibleReviewSides(preferences).length > 0 ? (
        <ReviewPanel
          node={node}
          preferences={preferences}
          runtime={reviewRuntime}
          topLevelQuestion={topLevelQuestion}
        />
      ) : null}
      {node.children.length ? (
        <div className="nested-questions">
          {node.children.map((child) => (
            <QuestionNode
              active={active}
              key={child.id}
              matchingNodeIds={matchingNodeIds}
              node={child}
              onActivate={onActivate}
              preferences={preferences}
              reviewRuntime={reviewRuntime}
              topLevelQuestion={topLevelQuestion}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PreferenceToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="preference-toggle">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        role="switch"
        type="checkbox"
      />
      <span aria-hidden="true" className="preference-toggle-control">
        <span />
      </span>
      <span className="preference-toggle-label">{label}</span>
    </label>
  );
}

function FilterPanel({
  facets,
  onClear,
  onToggle,
  onToggleState,
  selection,
  stateFacets,
}: {
  facets: ReturnType<typeof filterReviewPaper>['facets'];
  onClear: () => void;
  onToggle: (axis: DimensionalTagAxis, value: string) => void;
  onToggleState: (
    parameter: 'answerRag' | 'questionRag',
    value: string,
  ) => void;
  selection: ReviewFilterSelection;
  stateFacets: ReturnType<typeof filterReviewPaper>['stateFacets'];
}) {
  const selectedCount =
    DIMENSIONAL_TAG_AXES.reduce(
      (count, axis) => count + selection[axis].length,
      0,
    ) +
    selection.questionRag.length +
    selection.answerRag.length;
  return (
    <section className="filter-panel" aria-labelledby="filter-title">
      <div className="filter-heading">
        <div>
          <p className="eyebrow">Runtime lens</p>
          <h2 id="filter-title">Review filters</h2>
        </div>
        <button disabled={selectedCount === 0} onClick={onClear} type="button">
          Clear all {selectedCount ? `(${selectedCount})` : ''}
        </button>
      </div>
      <div className="state-filter-band">
        <div className="state-filter-intro">
          <strong>Content RAG state</strong>
          <span>Question and answer readiness are independent.</span>
        </div>
        {stateFacets.map((facet) => (
          <fieldset
            className={`state-facet state-facet--${facet.side}`}
            key={facet.side}
          >
            <legend>{facet.label}</legend>
            <div className="state-options">
              {facet.options.map((option) => (
                <label
                  className={option.disabled ? 'facet-option--disabled' : ''}
                  key={option.value}
                  title={option.value}
                >
                  <input
                    checked={option.selected}
                    disabled={option.disabled}
                    onChange={() =>
                      onToggleState(facet.parameter, option.value)
                    }
                    type="checkbox"
                  />
                  <span>{reviewStateLabel(option.value)}</span>
                  <strong>{option.count}</strong>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="filter-section-label">Content dimensions</p>
      <div className="facet-grid">
        {facets.map((facet) => (
          <details key={facet.axis} open={selection[facet.axis].length > 0}>
            <summary>
              <span>{facet.label}</span>
              <strong>
                {selection[facet.axis].length || facet.options.length}
              </strong>
            </summary>
            <div className="facet-options">
              {facet.options.map((option) => (
                <label
                  className={option.disabled ? 'facet-option--disabled' : ''}
                  key={option.value}
                >
                  <input
                    checked={option.selected}
                    disabled={option.disabled}
                    onChange={() => onToggle(facet.axis, option.value)}
                    type="checkbox"
                  />
                  <span>{option.value.slice(facet.axis.length + 1)}</span>
                  <strong>{option.count}</strong>
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function QuestionIndexNode({
  matchingNodeIds,
  node,
}: {
  matchingNodeIds: ReadonlySet<string>;
  node: ReviewPaperNode;
}) {
  const exactMatch = matchingNodeIds.has(node.id);
  return (
    <li
      className={`question-index-item question-index-item--depth-${node.depth}`}
    >
      <a
        className={exactMatch ? 'question-index-link--match' : undefined}
        href={`#question-${node.id}`}
      >
        <span>{node.label}</span>
        {!exactMatch ? <small>context</small> : null}
      </a>
      {node.children.length > 0 ? (
        <ol>
          {node.children.map((child) => (
            <QuestionIndexNode
              key={child.id}
              matchingNodeIds={matchingNodeIds}
              node={child}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function PaperQuestionIndex({
  matchingNodeIds,
  sections,
}: {
  matchingNodeIds: ReadonlySet<string>;
  sections: ReturnType<typeof filterReviewPaper>['matchingSections'];
}) {
  return (
    <aside className="question-index" aria-label="Filtered question navigation">
      <span>Questions</span>
      {sections.map((section) => (
        <section className="question-index-section" key={section.id}>
          <a className="question-index-section-link" href={`#${section.id}`}>
            <span>{section.label}</span>
            <strong>{section.questions.length}</strong>
          </a>
          <ol>
            {section.questions.map((question) => (
              <QuestionIndexNode
                key={question.id}
                matchingNodeIds={matchingNodeIds}
                node={question}
              />
            ))}
          </ol>
        </section>
      ))}
    </aside>
  );
}

function QuestionNavigation({
  activeId,
  label,
  onNavigate,
  questionIds,
}: {
  activeId: string | undefined;
  label: string;
  onNavigate: (id: string) => void;
  questionIds: readonly string[];
}) {
  const activeIndex = activeId ? questionIds.indexOf(activeId) : -1;
  const previous = adjacentQuestionId(questionIds, activeId, -1);
  const next = adjacentQuestionId(questionIds, activeId, 1);
  return (
    <nav className="question-navigation" aria-label={label}>
      <button
        disabled={!previous}
        onClick={() => previous && onNavigate(previous)}
        type="button"
      >
        <span aria-hidden="true">←</span> Previous
      </button>
      <span>
        {activeIndex >= 0 ? activeIndex + 1 : 0} / {questionIds.length} matching
      </span>
      <button
        disabled={!next}
        onClick={() => next && onNavigate(next)}
        type="button"
      >
        Next <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}

function SourceFreshnessBanner({
  checking,
  onCheck,
  onRefresh,
  refreshing,
  status,
}: {
  checking: boolean;
  onCheck: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  status: SourceFreshnessStatus;
}) {
  if (status.state === 'current') return null;

  const copy =
    status.state === 'changed'
      ? {
          detail:
            'The TOML changed after this view loaded. Refresh to review the current working-tree version.',
          title: 'Source changed on disk',
        }
      : status.state === 'invalid'
        ? {
            detail: status.message,
            title: 'Source TOML is temporarily invalid',
          }
        : status.state === 'unavailable'
          ? {
              detail: status.message,
              title: 'Source file is unavailable',
            }
          : {
              detail: status.message,
              title: 'Freshness check could not complete',
            };

  return (
    <section
      className={`source-freshness source-freshness--${status.state}`}
      role={status.state === 'changed' ? 'status' : 'alert'}
    >
      <div>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </div>
      <div className="source-freshness-actions">
        {status.state === 'changed' ? (
          <button disabled={refreshing} onClick={onRefresh} type="button">
            {refreshing ? 'Refreshing…' : 'Refresh paper'}
          </button>
        ) : null}
        <button disabled={checking} onClick={onCheck} type="button">
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {status.state === 'unavailable' ? (
          <Link href="/">Paper index</Link>
        ) : null}
      </div>
    </section>
  );
}

export function ReviewSurface({
  commentLoad,
  outcomeLoad,
  paper,
  reviewer,
}: {
  commentLoad: ReviewCommentLoad;
  outcomeLoad: ReviewOutcomeLoad;
  paper: DisplayReviewPaper;
  reviewer: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [preferences, setPreferences] = useState<ReviewPreferences>(
    DEFAULT_REVIEW_PREFERENCES,
  );
  const [comments, setComments] = useState<readonly LocalReviewComment[]>(
    commentLoad.comments,
  );
  const [showPreviousFeedback, setShowPreviousFeedback] = useState(false);
  const [outcomeOverrides, setOutcomeOverrides] = useState<
    Readonly<Record<string, ReviewOutcomeSelection>>
  >(outcomeLoad.outcomes);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [sourceFreshness, setSourceFreshness] = useState<SourceFreshnessStatus>(
    { state: 'current' },
  );
  const [sourceFreshnessChecking, setSourceFreshnessChecking] = useState(false);
  const pendingRequestKeys = useRef(new Set<string>());
  const sourceFreshnessPending = useRef(false);
  const selection = useMemo(
    () => parseReviewFilterSearchParams(searchParams.toString()),
    [searchParams],
  );
  const result = useMemo(
    () => filterReviewPaper(paper, selection),
    [paper, selection],
  );
  const displayNodeById = useMemo(
    () =>
      new Map(
        paper.sections.flatMap((section) =>
          section.questions.map((question) => [question.id, question] as const),
        ),
      ),
    [paper],
  );
  const activeFromUrl = searchParams.get('question') ?? undefined;
  const activeId = result.matchingQuestionTreeIds.includes(activeFromUrl ?? '')
    ? activeFromUrl
    : result.matchingQuestionTreeIds[0];
  const matchingNodeIds = useMemo(
    () => new Set(result.matchingNodeIds),
    [result.matchingNodeIds],
  );

  const checkSourceFreshness = useCallback(async () => {
    if (sourceFreshnessPending.current) return;
    sourceFreshnessPending.current = true;
    setSourceFreshnessChecking(true);

    try {
      const response = await fetch(
        sourceVersionUrl(paper.source.collection.id, paper.source.relativePath),
        { cache: 'no-store' },
      );
      const payload: unknown = await response.json().catch(() => undefined);
      setSourceFreshness(
        evaluateSourceFreshness(paper.source.version, payload),
      );
    } catch {
      setSourceFreshness({
        message:
          'The app could not inspect the source file. Check the local server and try again.',
        state: 'error',
      });
    } finally {
      sourceFreshnessPending.current = false;
      setSourceFreshnessChecking(false);
    }
  }, [
    paper.source.collection.id,
    paper.source.relativePath,
    paper.source.version,
  ]);

  const withPending = useCallback(
    <Result,>(key: string, request: () => Promise<Result>) =>
      runUniqueReviewRequest(
        pendingRequestKeys.current,
        key,
        request,
        setPendingKeys,
      ),
    [],
  );

  const responseMessage = useCallback(async (response: Response) => {
    const body = (await response.json().catch(() => ({}))) as {
      message?: unknown;
    };
    const message =
      typeof body.message === 'string' ? body.message : response.statusText;
    if (!response.ok) throw new Error(message || 'Review request failed.');
    return { body, message };
  }, []);

  const submitOutcome = useCallback(
    (target: ReviewTargetDescriptor, outcome: ReviewOutcomeSelection) => {
      const key = reviewTargetKey(target);
      return withPending(`${key}:outcome`, async () => {
        const response = await fetch('/api/review/outcome', {
          body: JSON.stringify({ outcome, reviewer, target }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        const { message } = await responseMessage(response);
        setOutcomeOverrides((current) => ({ ...current, [key]: outcome }));
        return message;
      });
    },
    [responseMessage, reviewer, withPending],
  );

  const appendComment = useCallback(
    (target: ReviewTargetDescriptor, comment: string, submissionId: string) => {
      const key = reviewTargetKey(target);
      return withPending(`${key}:comment`, async () => {
        const commentTarget = {
          collectionId: target.collectionId,
          nodeId: target.nodeId,
          questionId: target.questionId,
          ragState: target.ragState,
          relativePath: target.relativePath,
          side: target.side,
          uuid: target.uuid,
        };
        const response = await fetch('/api/review/comments', {
          body: JSON.stringify({
            comment,
            reviewer,
            submissionId,
            target: commentTarget,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        const { body } = await responseMessage(response);
        const stored = (body as { comment?: LocalReviewComment }).comment;
        if (!stored) throw new Error('The stored comment was not returned.');
        setComments((current) =>
          current.some((item) => item.id === stored.id)
            ? current
            : [...current, stored],
        );
        return stored;
      });
    },
    [responseMessage, reviewer, withPending],
  );

  const reviewRuntime = useMemo<ReviewRuntimeState>(
    () => ({
      appendComment,
      commentError: commentLoad.error,
      comments,
      outcomeDestination: outcomeLoad.destination,
      outcomeError: outcomeLoad.error,
      outcomeOverrides,
      pendingKeys,
      reviewer,
      showPreviousFeedback,
      source: {
        collectionId: paper.source.collection.id,
        relativePath: paper.source.relativePath,
      },
      submitOutcome,
    }),
    [
      appendComment,
      commentLoad.error,
      comments,
      outcomeLoad.destination,
      outcomeLoad.error,
      outcomeOverrides,
      paper.source.collection.id,
      paper.source.relativePath,
      pendingKeys,
      reviewer,
      showPreviousFeedback,
      submitOutcome,
    ],
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let next = DEFAULT_REVIEW_PREFERENCES;
      try {
        const stored = localStorage.getItem(REVIEW_PREFERENCES_KEY);
        next = parseReviewPreferences(
          stored,
          localStorage.getItem(LEGACY_REVIEW_PREFERENCES_KEY),
          localStorage.getItem(INITIAL_REVIEW_PREFERENCES_KEY),
        );
        if (!stored) {
          localStorage.setItem(REVIEW_PREFERENCES_KEY, JSON.stringify(next));
        }
      } catch {
        // Browser storage is optional; the in-memory controls still work.
      }
      setPreferences(next);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function checkVisibleSource() {
      if (document.visibilityState === 'visible') {
        void checkSourceFreshness();
      }
    }

    window.addEventListener('focus', checkVisibleSource);
    document.addEventListener('visibilitychange', checkVisibleSource);
    return () => {
      window.removeEventListener('focus', checkVisibleSource);
      document.removeEventListener('visibilitychange', checkVisibleSource);
    };
  }, [checkSourceFreshness]);

  useEffect(() => {
    if (!activeFromUrl || activeId !== activeFromUrl) return;
    document
      .getElementById(`question-${activeId}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [activeFromUrl, activeId]);

  function replaceSearchParams(next: URLSearchParams) {
    const query = next.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${pathname}?${query}` : pathname,
    );
  }

  function updatePreferences(next: ReviewPreferences) {
    setPreferences(next);
    try {
      localStorage.setItem(REVIEW_PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Display preferences remain usable when browser storage is unavailable.
    }
  }

  function updatePreference<Key extends keyof ReviewPreferences>(
    key: Key,
    value: ReviewPreferences[Key],
  ) {
    updatePreferences({ ...preferences, [key]: value });
  }

  function toggleFilter(axis: DimensionalTagAxis, value: string) {
    const selected = selection[axis].includes(value);
    const nextSelection = {
      ...selection,
      [axis]: selected
        ? selection[axis].filter((item) => item !== value)
        : [...selection[axis], value],
    };
    const current = new URLSearchParams(searchParams.toString());
    current.delete('question');
    replaceSearchParams(
      new URLSearchParams(
        serializeReviewFilterSearchParams(nextSelection, current),
      ),
    );
  }

  function toggleStateFilter(
    parameter: 'answerRag' | 'questionRag',
    value: string,
  ) {
    const selected = selection[parameter].includes(value);
    const nextSelection = {
      ...selection,
      [parameter]: selected
        ? selection[parameter].filter((item) => item !== value)
        : [...selection[parameter], value],
    };
    const current = new URLSearchParams(searchParams.toString());
    current.delete('question');
    replaceSearchParams(
      new URLSearchParams(
        serializeReviewFilterSearchParams(nextSelection, current),
      ),
    );
  }

  function clearFilters() {
    const current = new URLSearchParams(searchParams.toString());
    current.delete('question');
    replaceSearchParams(
      new URLSearchParams(
        serializeReviewFilterSearchParams(clearAllReviewFilters(), current),
      ),
    );
  }

  function navigateTo(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('question', id);
    replaceSearchParams(next);
  }

  function refreshPaper() {
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')
      ) {
        return;
      }
      const direction =
        event.key.toLowerCase() === 'j' ||
        (event.altKey && event.key === 'ArrowDown')
          ? 1
          : event.key.toLowerCase() === 'k' ||
              (event.altKey && event.key === 'ArrowUp')
            ? -1
            : undefined;
      if (!direction) return;
      const next = adjacentQuestionId(
        result.matchingQuestionTreeIds,
        activeId,
        direction,
      );
      if (next) {
        event.preventDefault();
        navigateTo(next);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <main className="paper-shell" id="paper-top">
      <SiteHeader compact />
      <header className="paper-hero">
        <div className="paper-breadcrumb">
          <Link href="/">Paper index</Link>
          <span>/</span>
          <span>{paper.source.collection.label}</span>
        </div>
        <div className="paper-title-row">
          <div>
            <p className="eyebrow">{paper.source.provenance.kind} source</p>
            <h1>{paper.title}</h1>
            <code>{paper.source.fileName}</code>
          </div>
          <dl className="paper-metadata">
            <div>
              <dt>Questions</dt>
              <dd>{paper.source.questionCount}</dd>
            </div>
            <div>
              <dt>Year</dt>
              <dd>{paper.metadata.year ?? '—'}</dd>
            </div>
            <div>
              <dt>Paper RAG</dt>
              <dd>{paper.metadata.paperRag ?? '—'}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>{paper.metadata.accessTier ?? '—'}</dd>
            </div>
          </dl>
        </div>
        <div className="paper-provenance">
          {paper.metadata.paperId ? (
            <code>ID {paper.metadata.paperId}</code>
          ) : null}
          {paper.metadata.schoolIds.map((school) => (
            <code key={school}>School {school}</code>
          ))}
          {paper.source.provenance.sourcePaperStems.map((stem) => (
            <code key={stem}>Source {stem}</code>
          ))}
        </div>
      </header>

      <SourceFreshnessBanner
        checking={sourceFreshnessChecking}
        onCheck={() => void checkSourceFreshness()}
        onRefresh={refreshPaper}
        refreshing={refreshing}
        status={sourceFreshness}
      />

      <FilterPanel
        facets={result.facets}
        onClear={clearFilters}
        onToggle={toggleFilter}
        onToggleState={toggleStateFilter}
        selection={selection}
        stateFacets={result.stateFacets}
      />

      <section
        className="review-toolbar"
        aria-label="Display and feedback preferences"
      >
        <div className="review-toolbar-group">
          <span className="toolbar-label">Display</span>
          <PreferenceToggle
            checked={preferences.showSolutions}
            label="Workings & answers"
            onChange={(value) => updatePreference('showSolutions', value)}
          />
          <PreferenceToggle
            checked={preferences.showTags}
            label="Tags"
            onChange={(value) => updatePreference('showTags', value)}
          />
          <PreferenceToggle
            checked={preferences.showRaw}
            label="Raw source"
            onChange={(value) => updatePreference('showRaw', value)}
          />
          <PreferenceToggle
            checked={preferences.showQuestionReview}
            label="Question review"
            onChange={(value) => updatePreference('showQuestionReview', value)}
          />
          <PreferenceToggle
            checked={preferences.showAnswerReview}
            label="Answer review"
            onChange={(value) => updatePreference('showAnswerReview', value)}
          />
        </div>
        {visibleReviewSides(preferences).length > 0 ? (
          <>
            <div className="review-toolbar-group review-toolbar-group--mode">
              <span className="toolbar-label">Review mode</span>
              <PreferenceToggle
                checked={preferences.reviewControlMode === 'simple'}
                label="Simple review"
                onChange={(value) =>
                  updatePreference(
                    'reviewControlMode',
                    value ? 'simple' : 'advanced',
                  )
                }
              />
              <span className="feedback-mode-copy">
                {preferences.reviewControlMode === 'simple'
                  ? 'Approved / Reset'
                  : 'All outcomes'}
              </span>
            </div>
            <div className="review-toolbar-group review-toolbar-group--feedback">
              <span className="toolbar-label">Feedback</span>
              <PreferenceToggle
                checked={showPreviousFeedback}
                label="Show previous feedback"
                onChange={setShowPreviousFeedback}
              />
              <span className="feedback-mode-copy">
                {showPreviousFeedback ? 'All RAG states' : 'Current RAG only'}
              </span>
            </div>
          </>
        ) : null}
        <span className="keyboard-note">J / K · next / previous</span>
      </section>

      <QuestionNavigation
        activeId={activeId}
        label="Top question navigation"
        onNavigate={navigateTo}
        questionIds={result.matchingQuestionTreeIds}
      />

      {result.matchingQuestionTreeCount === 0 ? (
        <section className="empty-results" aria-live="polite">
          <span>0 / {result.totalQuestionTreeCount}</span>
          <h2>No question shares that exact lens.</h2>
          <p>
            Keep the selected zero-result values for reference, or clear one
            filter to widen the paper again.
          </p>
          <button onClick={clearFilters} type="button">
            Clear all filters
          </button>
        </section>
      ) : (
        <div className="paper-body">
          <PaperQuestionIndex
            matchingNodeIds={matchingNodeIds}
            sections={result.matchingSections}
          />
          <div className="paper-sections">
            {result.matchingSections.map((section) => (
              <section
                className="paper-section"
                id={section.id}
                key={section.id}
              >
                <header>
                  <span>Section</span>
                  <h2>{section.label}</h2>
                  <strong>{section.questions.length} matching trees</strong>
                </header>
                {section.questions.map((question) => {
                  const displayQuestion = displayNodeById.get(question.id);
                  return displayQuestion ? (
                    <QuestionNode
                      active={displayQuestion.id === activeId}
                      key={displayQuestion.id}
                      matchingNodeIds={matchingNodeIds}
                      node={displayQuestion}
                      onActivate={() => navigateTo(displayQuestion.id)}
                      preferences={preferences}
                      reviewRuntime={reviewRuntime}
                      topLevelQuestion={displayQuestion}
                    />
                  ) : null;
                })}
              </section>
            ))}
          </div>
        </div>
      )}

      <QuestionNavigation
        activeId={activeId}
        label="Bottom question navigation"
        onNavigate={navigateTo}
        questionIds={result.matchingQuestionTreeIds}
      />
      <footer className="paper-footer">
        <a href="#paper-top">Back to top ↑</a>
        <span>TOML and canonical assets are never mutated by this app.</span>
      </footer>
    </main>
  );
}
