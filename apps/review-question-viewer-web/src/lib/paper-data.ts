import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parse } from '@iarna/toml';

import { enrichRtqMarkdown } from '@/lib/paper-assets';
import { applyPaperMacros } from '@/lib/paper-macros';
import {
  fileStemFromPaperPath,
  resolvePaperFile,
  titleFromPaperPath,
} from '@/lib/paper-paths';
import type {
  DisplayTag,
  NodeKind,
  OriginalQuestionSource,
  QuestionNode,
  QuestionPayload,
  RagState,
  RawAnswer,
  RawWorking,
  RenderedNodeContent,
  ReviewMetadata,
  ViewerTarget,
} from '@/lib/paper-types';
import {
  hydrateWorkingCollection,
  rawWorkingFromEntry,
} from '@/lib/working-collections';

type ParsedPaper = {
  meta?: Record<string, unknown>;
  sections?: Array<Record<string, unknown>>;
};

type BuildContext = {
  fileStem: string;
  inheritedSourceId: string;
  questionIndex: number;
  relativePathFromPapers: string;
  sectionIndex: number;
  subquestionIndex: number | null;
  subsubquestionIndex: number | null;
};

type TagDimensions = {
  family: string | null;
  frame: string | null;
  legacy: string[];
  maths: string[];
  markers: string[];
  reasoning: string | null;
};

export class NestedQuestionUuidError extends Error {
  constructor(public readonly nodePath: string) {
    super(
      'The requested UUID belongs to a nested question. Provide a top-level question UUID.',
    );
  }
}

export class QuestionUuidNotFoundError extends Error {
  constructor() {
    super('No top-level question was found for the requested UUID.');
  }
}

function hashContent(raw: string) {
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function sortTags(tags: string[]) {
  return [...new Set(tags.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
}

function nodePath(
  sectionIndex: number,
  questionIndex: number,
  subquestionIndex: number | null = null,
  subsubquestionIndex: number | null = null,
) {
  const parts = [`s${sectionIndex}`, `q${questionIndex}`];

  if (subquestionIndex !== null) {
    parts.push(`sq${subquestionIndex}`);
  }

  if (subsubquestionIndex !== null) {
    parts.push(`ssq${subsubquestionIndex}`);
  }

  return parts.join('.');
}

function lowerAlpha(index: number) {
  return String.fromCharCode(97 + index);
}

function lowerRoman(value: number) {
  const numerals: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let remaining = value;
  let output = '';

  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      output += numeral;
      remaining -= amount;
    }
  }

  return output;
}

function hierarchyLabel(
  kind: NodeKind,
  sectionIndex: number,
  questionIndex: number,
  subquestionIndex: number | null,
  subsubquestionIndex: number | null,
) {
  const questionLabel = `S${sectionIndex + 1} Q${questionIndex + 1}`;

  if (kind === 'question') {
    return questionLabel;
  }

  if (kind === 'subquestion') {
    return `${questionLabel}${lowerAlpha(subquestionIndex ?? 0)}`;
  }

  return `${questionLabel}${lowerAlpha(subquestionIndex ?? 0)}.${lowerRoman(
    (subsubquestionIndex ?? 0) + 1,
  )}`;
}

function parseRtqQuestionId(questionId: string | null) {
  if (!questionId) {
    return null;
  }

  const match = /^(.*):(\d+):(\d+)$/i.exec(questionId);

  if (!match) {
    return null;
  }

  const sectionIndex = Number.parseInt(match[2], 10) - 1;
  const questionIndex = Number.parseInt(match[3], 10) - 1;

  if (
    !Number.isInteger(sectionIndex) ||
    !Number.isInteger(questionIndex) ||
    sectionIndex < 0 ||
    questionIndex < 0
  ) {
    return null;
  }

  return {
    paperStem: match[1],
    questionIndex,
    rawValue: questionId,
    sectionIndex,
  };
}

function originalSourceFromQuestionId(
  questionId: string | null,
): OriginalQuestionSource | null {
  if (!questionId) {
    return null;
  }

  const parsed = parseRtqQuestionId(questionId);

  if (!parsed) {
    return {
      paperStem: null,
      questionNumber: null,
      rawValue: questionId,
      sectionNumber: null,
    };
  }

  return {
    paperStem: parsed.paperStem,
    questionNumber: parsed.questionIndex + 1,
    rawValue: parsed.rawValue,
    sectionNumber: parsed.sectionIndex + 1,
  };
}

function assetContextFromQuestionId(
  questionId: string | null,
  fallback: BuildContext,
) {
  const parsed = parseRtqQuestionId(questionId);

  if (!parsed) {
    return fallback;
  }

  return {
    ...fallback,
    assetFileStem: parsed.paperStem,
    assetQuestionIndex: parsed.questionIndex,
    assetSectionIndex: parsed.sectionIndex,
  };
}

async function hydrateMarkdown(
  text: string,
  context: BuildContext,
  options?: {
    scopeIndex?: number;
    scopeType?: 'answer' | 'working';
  },
) {
  const withMacros = await applyPaperMacros(text);
  return enrichRtqMarkdown(withMacros, context, options);
}

function rawAnswerFromEntry(entry: unknown): RawAnswer {
  if (!entry || typeof entry !== 'object') {
    return {
      answer: '',
      key: '',
      option: '',
    };
  }

  const record = entry as Record<string, unknown>;

  return {
    answer: asString(record.answer),
    key: asString(record.key),
    option: asString(record.option),
  };
}

function nonEmptyAnswerPart(value: string) {
  const trimmed = value.trim();

  return trimmed.toLowerCase() === '%empty%' ? '' : trimmed;
}

function answerMarkdownFromEntry(entry: RawAnswer) {
  const answer = nonEmptyAnswerPart(entry.answer);
  const key = nonEmptyAnswerPart(entry.key);
  const option = nonEmptyAnswerPart(entry.option);

  if (key && option && answer) {
    return `Option ${option}: ${key} = ${answer}`;
  }

  if (key && answer) {
    return `${key} = ${answer}`;
  }

  if (option && answer) {
    return `Option ${option} = ${answer}`;
  }

  if (key) {
    return key;
  }

  if (option) {
    return `Option ${option}`;
  }

  return entry.answer;
}

async function buildNodeContent(
  rawNode: Record<string, unknown>,
  context: BuildContext,
): Promise<{
  raw: {
    answers: RawAnswer[];
    question: string;
    workings: RawWorking[];
  };
  rendered: RenderedNodeContent;
}> {
  const rawWorkings = Array.isArray(rawNode.workings)
    ? rawNode.workings.map(rawWorkingFromEntry)
    : [];
  const rawAnswers = Array.isArray(rawNode.answers)
    ? rawNode.answers.map(rawAnswerFromEntry)
    : [];
  const rawQuestion = asString(rawNode.question);

  const renderedWorkings = await Promise.all(
    rawWorkings.map(async (entry, index) => ({
      formulas: await hydrateWorkingCollection(
        entry.formulas,
        'formula',
        value => hydrateMarkdown(value, context),
      ),
      tips: await hydrateWorkingCollection(entry.tips, 'tip', value =>
        hydrateMarkdown(value, context),
      ),
      working: await hydrateMarkdown(entry.working, context, {
        scopeIndex: index,
        scopeType: 'working',
      }),
    })),
  );
  const renderedAnswers = await Promise.all(
    rawAnswers.map((entry, index) =>
      hydrateMarkdown(answerMarkdownFromEntry(entry), context, {
        scopeIndex: index,
        scopeType: 'answer',
      }),
    ),
  );

  return {
    raw: {
      answers: rawAnswers,
      question: rawQuestion,
      workings: rawWorkings,
    },
    rendered: {
      answers: renderedAnswers,
      formulas: renderedWorkings.flatMap(entry => entry.formulas),
      question: await hydrateMarkdown(rawQuestion, context),
      tips: renderedWorkings.flatMap(entry => entry.tips),
      workings: renderedWorkings.map(entry => entry.working),
    },
  };
}

function tagKind(tag: string) {
  if (tag.startsWith('family.')) return 'family';
  if (tag.startsWith('frame.')) return 'frame';
  if (tag.startsWith('marker.')) return 'marker';
  if (tag.startsWith('math.')) return 'math';
  if (tag.startsWith('reasoning.')) return 'reasoning';
  return 'legacy';
}

function dimensionsFromTags(tags: string[]): TagDimensions {
  const dimensions: TagDimensions = {
    family: null,
    frame: null,
    legacy: [],
    maths: [],
    markers: [],
    reasoning: null,
  };

  for (const tag of sortTags(tags)) {
    switch (tagKind(tag)) {
      case 'family':
        dimensions.family = tag;
        break;
      case 'frame':
        dimensions.frame = tag;
        break;
      case 'legacy':
        dimensions.legacy.push(tag);
        break;
      case 'marker':
        dimensions.markers.push(tag);
        break;
      case 'math':
        dimensions.maths.push(tag);
        break;
      case 'reasoning':
        dimensions.reasoning = tag;
        break;
    }
  }

  return dimensions;
}

function tagsFromDimensions(dimensions: TagDimensions) {
  return sortTags([
    ...dimensions.legacy,
    ...(dimensions.family ? [dimensions.family] : []),
    ...dimensions.maths,
    ...(dimensions.frame ? [dimensions.frame] : []),
    ...dimensions.markers,
    ...(dimensions.reasoning ? [dimensions.reasoning] : []),
  ]);
}

function mergeDimensions(
  explicitTags: string[],
  inheritedTags: string[],
  isRootNode: boolean,
  inheritEnabled: boolean,
) {
  const explicit = dimensionsFromTags(explicitTags);
  const inherited = dimensionsFromTags(inheritedTags);

  if (isRootNode || !inheritEnabled) {
    return tagsFromDimensions(explicit);
  }

  return tagsFromDimensions({
    family: explicit.family ?? inherited.family,
    frame: explicit.frame ?? inherited.frame,
    legacy: sortTags([...inherited.legacy, ...explicit.legacy]).filter(
      tag => tagKind(tag) === 'legacy',
    ),
    maths: explicit.maths.length ? explicit.maths : inherited.maths,
    markers: explicit.markers.length ? explicit.markers : inherited.markers,
    reasoning: explicit.reasoning ?? inherited.reasoning,
  });
}

function displayTags(
  explicitTags: string[],
  inheritedTags: string[],
  isRootNode: boolean,
  inheritEnabled: boolean,
) {
  const effective = mergeDimensions(
    explicitTags,
    inheritedTags,
    isRootNode,
    inheritEnabled,
  );

  return effective.map((tag): DisplayTag => ({
    source:
      explicitTags.includes(tag) || isRootNode || !inheritEnabled
        ? 'explicit'
        : inheritedTags.includes(tag)
          ? 'inherited'
          : 'implicit',
    value: tag,
  }));
}

function normalizeRagLabel(value: string) {
  return ragStateFromValue(value).replace(/[_-]+/g, ' ').trim().toUpperCase();
}

function ragStateFromValue(value: string) {
  const parts = value.trim().toLowerCase().split('_').filter(Boolean);

  if (parts[0] === 'rag' && parts.length >= 3) {
    return parts[2];
  }

  return parts.at(-1) ?? '';
}

function ragTone(value: string): RagState['tone'] {
  const state = ragStateFromValue(value);
  const validStates = new Set<RagState['tone']>([
    'blocked',
    'comingsoon',
    'g0',
    'ng0',
    'ng1',
    'ng2',
    'ng3',
    'ng4',
    'ng5',
    'ng6',
    'ng7',
    'ng8',
    'notstarted',
  ]);

  return validStates.has(state as RagState['tone'])
    ? (state as RagState['tone'])
    : 'unknown';
}

function ragStateFromRecordValue(
  record: Record<string, unknown>,
  key: string,
  label: string,
): RagState | null {
  const value = asString(record[key]).trim();

  if (!value) {
    return null;
  }

  return {
    key,
    label,
    rawValue: value,
    tone: ragTone(value),
    value: normalizeRagLabel(value),
  };
}

function sheetCodeFromRag(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  const state = ragStateFromValue(value);

  if (state === 'notstarted' || state === 'ns') {
    return 'NS';
  }

  if (state === 'g0' || /^ng[0-8]$/.test(state)) {
    return state.toUpperCase();
  }

  return null;
}

function ragStatesFromRecord(
  record: Record<string, unknown>,
  isRootNode: boolean,
) {
  if (!isRootNode) {
    return [];
  }

  const keys = ['rtq-answer-rag'];
  const labels: Record<string, string> = {
    'rtq-answer-rag': 'Answer',
  };

  return keys.flatMap((key): RagState[] => {
    const state = ragStateFromRecordValue(record, key, labels[key]);

    return state ? [state] : [];
  });
}

function reviewMetadataFromRecord(
  record: Record<string, unknown>,
): ReviewMetadata {
  const answerSourceRag = ragStateFromRecordValue(
    record,
    'rtq-answer-rag',
    'Answer',
  );
  const questionSourceRag = ragStateFromRecordValue(
    record,
    'rtq-question-rag',
    'Question',
  );

  return {
    answer: {
      comments: asString(record['rtq-review-comments']).trim(),
      reviewRag: ragStateFromRecordValue(
        record,
        'rtq-review-rag',
        'Answer review',
      ),
      sheet: sheetCodeFromRag(answerSourceRag?.rawValue),
      sourceRag: answerSourceRag,
    },
    question: {
      comments: asString(record['rtq-question-review-comments']).trim(),
      reviewRag: ragStateFromRecordValue(
        record,
        'rtq-question-review-rag',
        'Question review',
      ),
      sheet: sheetCodeFromRag(questionSourceRag?.rawValue),
      sourceRag: questionSourceRag,
    },
  };
}

function explicitTagsFromRecord(record: Record<string, unknown>) {
  return sortTags([
    ...asStringArray(record['rtq-tags']),
    ...asStringArray(record.tags),
  ]);
}

async function buildNode(
  rawNode: Record<string, unknown>,
  context: BuildContext,
  kind: NodeKind,
  inheritedTags: string[],
  isRootNode: boolean,
): Promise<QuestionNode> {
  const questionId = asString(rawNode['rtq-question-id']) || null;
  const sourceId = questionId ?? context.inheritedSourceId;
  const assetContext = assetContextFromQuestionId(questionId, {
    ...context,
    inheritedSourceId: sourceId,
  });
  const explicitTags = explicitTagsFromRecord(rawNode);
  const inheritEnabled =
    !isRootNode &&
    (typeof rawNode['rtq-inherit-tags'] === 'boolean'
      ? Boolean(rawNode['rtq-inherit-tags'])
      : true);
  const effectiveTags = displayTags(
    explicitTags,
    inheritedTags,
    isRootNode,
    inheritEnabled,
  );
  const effectiveTagValues = effectiveTags.map(tag => tag.value);
  const childContext = {
    ...assetContext,
    inheritedSourceId: sourceId,
  };
  const children =
    kind === 'subsubquestion'
      ? []
      : kind === 'question'
        ? await buildSubquestionNodes(
            rawNode.subquestions,
            childContext,
            effectiveTagValues,
          )
        : await buildSubsubquestionNodes(
            rawNode.subquestions,
            childContext,
            effectiveTagValues,
          );

  return {
    children,
    content: await buildNodeContent(rawNode, assetContext),
    depth: kind === 'question' ? 0 : kind === 'subquestion' ? 1 : 2,
    effectiveTags,
    explicitTags,
    hierarchyLabel: hierarchyLabel(
      kind,
      context.sectionIndex,
      context.questionIndex,
      context.subquestionIndex,
      context.subsubquestionIndex,
    ),
    inheritedTags: isRootNode || !inheritEnabled ? [] : inheritedTags,
    isRootNode,
    kind,
    path: nodePath(
      context.sectionIndex,
      context.questionIndex,
      context.subquestionIndex,
      context.subsubquestionIndex,
    ),
    originalSource: originalSourceFromQuestionId(questionId),
    questionId,
    ragStates: ragStatesFromRecord(rawNode, isRootNode),
    review: reviewMetadataFromRecord(rawNode),
    sourceId,
    uuid: asString(rawNode['rtq-uuid']) || null,
  };
}

async function buildSubsubquestionNodes(
  rawChildren: unknown,
  baseContext: BuildContext,
  inheritedTags: string[],
) {
  if (!Array.isArray(rawChildren)) {
    return [];
  }

  const children: QuestionNode[] = [];

  for (const [index, rawChild] of rawChildren.entries()) {
    if (!rawChild || typeof rawChild !== 'object') {
      continue;
    }

    children.push(
      await buildNode(
        rawChild as Record<string, unknown>,
        {
          ...baseContext,
          subsubquestionIndex: index,
        },
        'subsubquestion',
        inheritedTags,
        false,
      ),
    );
  }

  return children;
}

async function buildSubquestionNodes(
  rawChildren: unknown,
  baseContext: BuildContext,
  inheritedTags: string[],
) {
  if (!Array.isArray(rawChildren)) {
    return [];
  }

  const children: QuestionNode[] = [];

  for (const [index, rawChild] of rawChildren.entries()) {
    if (!rawChild || typeof rawChild !== 'object') {
      continue;
    }

    children.push(
      await buildNode(
        rawChild as Record<string, unknown>,
        {
          ...baseContext,
          subquestionIndex: index,
          subsubquestionIndex: null,
        },
        'subquestion',
        inheritedTags,
        false,
      ),
    );
  }

  return children;
}

async function buildTopLevelQuestion(
  rawQuestion: Record<string, unknown>,
  context: BuildContext,
) {
  return buildNode(rawQuestion, context, 'question', [], true);
}

function flattenNodes(node: QuestionNode): QuestionNode[] {
  return [node, ...node.children.flatMap(flattenNodes)];
}

function hasNestedUuid(node: QuestionNode, uuid: string) {
  return flattenNodes(node)
    .filter(candidate => !candidate.isRootNode)
    .find(candidate => candidate.uuid === uuid);
}

export async function readQuestionPayload(
  target: ViewerTarget,
): Promise<QuestionPayload> {
  const { absolutePath, normalized } = resolvePaperFile(
    target.relativePathFromPapers,
  );
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = parse(raw) as ParsedPaper;
  const fileStem = fileStemFromPaperPath(normalized);
  let nestedMatch: QuestionNode | null = null;

  for (const [sectionIndex, rawSection] of (parsed.sections ?? []).entries()) {
    const section = rawSection as Record<string, unknown>;
    const questions = Array.isArray(section.questions) ? section.questions : [];

    for (const [questionIndex, rawQuestion] of questions.entries()) {
      if (!rawQuestion || typeof rawQuestion !== 'object') {
        continue;
      }

      const question = await buildTopLevelQuestion(
        rawQuestion as Record<string, unknown>,
        {
          fileStem,
          inheritedSourceId: normalized,
          questionIndex,
          relativePathFromPapers: normalized,
          sectionIndex,
          subquestionIndex: null,
          subsubquestionIndex: null,
        },
      );

      if (question.uuid === target.questionUuid) {
        return {
          document: {
            fileName: path.basename(normalized),
            relativePathFromPapers: normalized,
            title: titleFromPaperPath(normalized),
            versionHash: hashContent(raw),
          },
          question,
          target: {
            questionUuid: target.questionUuid,
            relativePathFromPapers: normalized,
          },
        };
      }

      nestedMatch ??= hasNestedUuid(question, target.questionUuid) ?? null;
    }
  }

  if (nestedMatch) {
    throw new NestedQuestionUuidError(nestedMatch.path);
  }

  throw new QuestionUuidNotFoundError();
}
