import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { enrichRtqMarkdown } from '@/lib/paper-assets';
import { applyPaperMacros } from '@/lib/paper-macros';
import {
  FOLDER_ORDER,
  SOURCE_PAPERS_ROOT,
  buildFileHref,
  buildRelativePathFromSlug,
  buildSlugSegments,
  compareFolderKeys,
  folderLabel,
  isExemplarFolderKey,
  relativePaperSlug,
  resolveFolderPath,
  resolvePaperFilePath,
} from '@/lib/paper-paths';
import {
  type ParsedPaper,
  parsePaperToml,
  workingCollectionValues,
} from '@/lib/paper-toml';
import type {
  DisplayTag,
  ExemplarFolderKey,
  FileIndexItem,
  FolderKey,
  NodeKind,
  OriginalQuestionSource,
  PaperDocument,
  PaperNode,
  PaperSection,
  StatusTone,
} from '@/lib/paper-types';
import { sortPersistedTags, tagKindFor } from '@/lib/tag-taxonomy';
import { humanizeStem, lowerAlpha, lowerRoman } from '@/lib/utils';

type NodeContext = {
  assetFileStem?: string;
  assetQuestionIndex?: number;
  assetSectionIndex?: number;
  assetSubquestionIndex?: number | null;
  assetSubsubquestionIndex?: number | null;
  fileStem: string;
  questionIndex: number;
  sectionIndex: number;
  subquestionIndex: number | null;
  subsubquestionIndex: number | null;
};

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
  fallback: NodeContext,
): NodeContext {
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

type DerivedDimensions = {
  family: string | null;
  frame: string | null;
  legacy: string[];
  maths: string[];
  markers: string[];
  reasoning: string | null;
};

const FOCUS_GROUP_PATTERN = /rtq-focus-group\s*=\s*\[(.*?)\]/i;
const FOCUS_GROUP_VALUE_PATTERN = /"([^"]+)"/g;

function hashContent(raw: string) {
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function focusGroupsFromRaw(raw: string) {
  const match = FOCUS_GROUP_PATTERN.exec(raw);

  if (!match) {
    return [];
  }

  return [...match[1].matchAll(FOCUS_GROUP_VALUE_PATTERN)].map(
    entry => entry[1],
  );
}

function topLevelQuestionCount(parsed: ParsedPaper) {
  return (parsed.sections ?? []).reduce((sum, section) => {
    const questions = section.questions;
    return sum + (Array.isArray(questions) ? questions.length : 0);
  }, 0);
}

async function readFileIndexDetails(
  absolutePath: string,
  folderKey: FolderKey,
) {
  const raw = await fs.readFile(absolutePath, 'utf8');

  if (isExemplarFolderKey(folderKey)) {
    return {
      navFocusGroups: focusGroupsFromRaw(raw),
      questionCount: [...raw.matchAll(/^\[\[sections\.questions\]\]\s*$/gm)]
        .length,
    };
  }

  const parsed = parsePaperToml(raw, isExemplarFolderKey(folderKey));

  return {
    navFocusGroups: focusGroupsFromRaw(raw),
    questionCount: topLevelQuestionCount(parsed),
  };
}

function startCase(value: string) {
  return value
    .split(/[\s.-]+/g)
    .filter(Boolean)
    .map(part => {
      if (/^\d+$/.test(part)) {
        return part;
      }

      if (/^[a-z]{1,3}\d+$/i.test(part)) {
        return part.toUpperCase();
      }

      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(' ');
}

function formatTopicKey(value: string) {
  return value
    .split('.')
    .map(part => startCase(part))
    .join(' / ');
}

function formatRagStatus(value: string) {
  return value
    .split(/[-_]+/g)
    .filter(Boolean)
    .map(part =>
      /^[a-z]{1,3}\d+$/i.test(part) ? part.toUpperCase() : startCase(part),
    )
    .join(' ');
}

function statusToneFor(value: string | null): StatusTone | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, '').toLowerCase();

  switch (normalized) {
    case 'notstarted':
      return 'statusGray';
    case 'blocked':
      return 'statusBlocked';
    case 'g0':
    case 'ng0':
      return 'statusGreen1';
    case 'ng1':
      return 'statusGreen1';
    case 'ng2':
      return 'statusGreen2';
    case 'ng3':
      return 'statusGreen3';
    case 'ng4':
    case 'ng5':
    case 'ng6':
    case 'ng7':
    case 'ng8':
      return 'statusGreen4';
    default:
      return 'status';
  }
}

function parseCanonicalStem(stem: string) {
  const parts = stem.split('--');

  if (parts.length < 3) {
    return null;
  }

  const schoolSlug = parts[0];
  const year = parts.at(-2);
  const paperSlug = parts.at(-1);

  if (!schoolSlug || !year || !paperSlug || !/^\d{4}$/.test(year)) {
    return null;
  }

  return {
    navMeta: `${year} · ${startCase(paperSlug)}`,
    navStatusKey: null,
    navStatus: null,
    navStatusTone: null,
    navTopicKey: null,
    navTopicLabel: null,
    navTitle: startCase(schoolSlug),
  };
}

function parseTopicStem(stem: string) {
  const match = /^topicpapers_(.+)_(\d+)$/i.exec(stem);

  if (!match) {
    return null;
  }

  return {
    navMeta: `Topic paper ${match[2]}`,
    navStatusKey: null,
    navStatus: null,
    navStatusTone: null,
    navTopicKey: match[1],
    navTopicLabel: formatTopicKey(match[1]),
    navTitle: formatTopicKey(match[1]),
  };
}

function parseRagTopicStem(stem: string) {
  const match = /^topicpapers_(.+)_rag_([^_]+)_(\d+)$/i.exec(stem);

  if (!match) {
    return null;
  }

  const navStatus = formatRagStatus(match[2]);

  return {
    navMeta: `Topic paper ${match[3]}`,
    navStatusKey: match[2].toLowerCase(),
    navStatus,
    navStatusTone: statusToneFor(navStatus),
    navTopicKey: match[1],
    navTopicLabel: formatTopicKey(match[1]),
    navTitle: formatTopicKey(match[1]),
  };
}

function parseRagStem(stem: string) {
  const match = /^(.*)_rag_([^_]+)_(\d+)$/i.exec(stem);

  if (!match) {
    return null;
  }

  const canonical = parseCanonicalStem(match[1]);

  if (!canonical) {
    return null;
  }

  const navStatus = formatRagStatus(match[2]);

  return {
    navMeta: `${canonical.navMeta} · Set ${match[3]}`,
    navStatusKey: match[2].toLowerCase(),
    navStatus,
    navStatusTone: statusToneFor(navStatus),
    navTopicKey: null,
    navTopicLabel: null,
    navTitle: canonical.navTitle,
  };
}

function navigationCopyForFile(folderKey: FolderKey, stem: string) {
  switch (folderKey) {
    case 'toml':
    case 'focusToml':
      return parseCanonicalStem(stem);
    case 'allTopicsToml':
    case 'focusTopicToml':
    case 'topicToml':
      return parseTopicStem(stem);
    case 'focusRagToml':
    case 'ragToml':
      return parseRagStem(stem);
    case 'focusRagTopicToml':
    case 'ragTopicToml':
      return parseRagTopicStem(stem);
  }
}

async function listSourceFolderKeys(): Promise<FolderKey[]> {
  const entries = await fs.readdir(SOURCE_PAPERS_ROOT, { withFileTypes: true });
  const directoryNames = new Set(
    entries.filter(entry => entry.isDirectory()).map(entry => entry.name),
  );
  const registeredFolderKeys = FOLDER_ORDER.filter(folderKey =>
    directoryNames.has(folderKey),
  );
  const exemplarFolderKeys = entries
    .filter(entry => entry.isDirectory() && isExemplarFolderKey(entry.name))
    .map(entry => entry.name as ExemplarFolderKey)
    .sort(compareFolderKeys);

  return [...registeredFolderKeys, ...exemplarFolderKeys];
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  if (value.trim() === '%empty%') {
    return '';
  }

  return value;
}

function answerMarkdownFromRecord(record: Record<string, unknown>) {
  const answer = normalizeString(record.answer).trim();
  const key = normalizeString(record.key).trim();
  const option = normalizeString(record.option).trim();

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

  return normalizeString(record.answer);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
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

async function hydrateMarkdown(
  text: string,
  context: NodeContext,
  options?: {
    scopeIndex?: number;
    scopeType?: 'answer' | 'working';
  },
) {
  const withMacros = await applyPaperMacros(normalizeString(text));
  return enrichRtqMarkdown(withMacros, context, options);
}

async function buildNodeContent(
  rawNode: Record<string, unknown>,
  context: NodeContext,
) {
  const question = await hydrateMarkdown(
    normalizeString(rawNode.question),
    context,
  );
  const workings = Array.isArray(rawNode.workings)
    ? await Promise.all(
        rawNode.workings.map(async (entry, index) => {
          if (!entry || typeof entry !== 'object') {
            return {
              formulas: [],
              tips: [],
              working: '',
            };
          }

          const record = entry as Record<string, unknown>;

          return {
            formulas: await Promise.all(
              workingCollectionValues(record, 'formulas', 'formula').map(
                value => hydrateMarkdown(value, context),
              ),
            ),
            tips: await Promise.all(
              workingCollectionValues(record, 'tips', 'tip').map(value =>
                hydrateMarkdown(value, context),
              ),
            ),
            working: await hydrateMarkdown(
              normalizeString(record.working),
              context,
              {
                scopeIndex: index,
                scopeType: 'working',
              },
            ),
          };
        }),
      )
    : [];
  const answers = Array.isArray(rawNode.answers)
    ? await Promise.all(
        rawNode.answers.map(async (entry, index) => {
          if (!entry || typeof entry !== 'object') {
            return '';
          }

          const record = entry as Record<string, unknown>;
          return hydrateMarkdown(answerMarkdownFromRecord(record), context, {
            scopeIndex: index,
            scopeType: 'answer',
          });
        }),
      )
    : [];

  return {
    answers: answers.filter(Boolean),
    formulas: workings.flatMap(entry => entry.formulas),
    question,
    tips: workings.flatMap(entry => entry.tips),
    workings: workings.map(entry => entry.working).filter(Boolean),
  };
}

async function buildSubsubquestionNodes(
  rawChildren: unknown,
  baseContext: NodeContext,
): Promise<PaperNode[]> {
  if (!Array.isArray(rawChildren)) {
    return [];
  }

  const children: PaperNode[] = [];

  for (const [index, rawChild] of rawChildren.entries()) {
    if (!rawChild || typeof rawChild !== 'object') {
      continue;
    }

    const context: NodeContext = {
      ...baseContext,
      subsubquestionIndex: index,
    };
    const record = rawChild as Record<string, unknown>;
    const questionId =
      typeof record['rtq-question-id'] === 'string'
        ? record['rtq-question-id']
        : null;
    const assetContext = assetContextFromQuestionId(questionId, context);
    const explicitTags = sortPersistedTags(asStringArray(record['rtq-tags']));
    const explicitInherit =
      typeof record['rtq-inherit-tags'] === 'boolean'
        ? (record['rtq-inherit-tags'] as boolean)
        : true;

    children.push({
      children: [],
      content: await buildNodeContent(record, assetContext),
      depth: 2,
      effectiveDisplayTags: [],
      effectiveTags: [],
      explicitDisplayTags: [],
      explicitInherit,
      explicitTags,
      hierarchyLabel: hierarchyLabel(
        'subsubquestion',
        context.sectionIndex,
        context.questionIndex,
        context.subquestionIndex,
        index,
      ),
      inheritedDisplayTags: [],
      inheritedTags: [],
      isRootNode: false,
      kind: 'subsubquestion',
      path: nodePath(
        context.sectionIndex,
        context.questionIndex,
        context.subquestionIndex,
        index,
      ),
      originalSource: originalSourceFromQuestionId(questionId),
      questionId,
      sectionIndex: context.sectionIndex,
      shortLabel: lowerRoman(index + 1),
      subquestionIndex: context.subquestionIndex,
      subsubquestionIndex: index,
      uuid: typeof record['rtq-uuid'] === 'string' ? record['rtq-uuid'] : null,
    });
  }

  return children;
}

async function buildSubquestionNodes(
  rawChildren: unknown,
  baseContext: NodeContext,
) {
  if (!Array.isArray(rawChildren)) {
    return [];
  }

  const children: PaperNode[] = [];

  for (const [index, rawChild] of rawChildren.entries()) {
    if (!rawChild || typeof rawChild !== 'object') {
      continue;
    }

    const context: NodeContext = {
      ...baseContext,
      subquestionIndex: index,
    };
    const record = rawChild as Record<string, unknown>;
    const questionId =
      typeof record['rtq-question-id'] === 'string'
        ? record['rtq-question-id']
        : null;
    const assetContext = assetContextFromQuestionId(questionId, context);
    const explicitTags = sortPersistedTags(asStringArray(record['rtq-tags']));
    const explicitInherit =
      typeof record['rtq-inherit-tags'] === 'boolean'
        ? (record['rtq-inherit-tags'] as boolean)
        : true;

    children.push({
      children: await buildSubsubquestionNodes(
        record.subquestions,
        assetContext,
      ),
      content: await buildNodeContent(record, assetContext),
      depth: 1,
      effectiveDisplayTags: [],
      effectiveTags: [],
      explicitDisplayTags: [],
      explicitInherit,
      explicitTags,
      hierarchyLabel: hierarchyLabel(
        'subquestion',
        context.sectionIndex,
        context.questionIndex,
        index,
        null,
      ),
      inheritedDisplayTags: [],
      inheritedTags: [],
      isRootNode: false,
      kind: 'subquestion',
      path: nodePath(context.sectionIndex, context.questionIndex, index),
      originalSource: originalSourceFromQuestionId(questionId),
      questionId,
      sectionIndex: context.sectionIndex,
      shortLabel: lowerAlpha(index),
      subquestionIndex: index,
      subsubquestionIndex: null,
      uuid: typeof record['rtq-uuid'] === 'string' ? record['rtq-uuid'] : null,
    });
  }

  return children;
}

async function buildQuestionNodes(
  sectionIndex: number,
  rawQuestions: unknown,
  fileStem: string,
) {
  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  const questions: PaperNode[] = [];

  for (const [index, rawQuestion] of rawQuestions.entries()) {
    if (!rawQuestion || typeof rawQuestion !== 'object') {
      continue;
    }

    const record = rawQuestion as Record<string, unknown>;
    const context: NodeContext = {
      fileStem,
      questionIndex: index,
      sectionIndex,
      subquestionIndex: null,
      subsubquestionIndex: null,
    };
    const questionId =
      typeof record['rtq-question-id'] === 'string'
        ? record['rtq-question-id']
        : null;
    const assetContext = assetContextFromQuestionId(questionId, context);

    questions.push({
      children: await buildSubquestionNodes(record.subquestions, assetContext),
      content: await buildNodeContent(record, assetContext),
      depth: 0,
      effectiveDisplayTags: [],
      effectiveTags: [],
      explicitDisplayTags: [],
      explicitInherit: null,
      explicitTags: sortPersistedTags(asStringArray(record['rtq-tags'])),
      hierarchyLabel: hierarchyLabel(
        'question',
        sectionIndex,
        index,
        null,
        null,
      ),
      inheritedDisplayTags: [],
      inheritedTags: [],
      isRootNode: true,
      kind: 'question',
      path: nodePath(sectionIndex, index),
      originalSource: originalSourceFromQuestionId(questionId),
      questionId,
      sectionIndex,
      shortLabel: `Q${index + 1}`,
      subquestionIndex: null,
      subsubquestionIndex: null,
      uuid: typeof record['rtq-uuid'] === 'string' ? record['rtq-uuid'] : null,
    });
  }

  return questions;
}

function dimensionsFromTags(tags: string[]) {
  const dimensions: DerivedDimensions = {
    family: null,
    frame: null,
    legacy: [],
    maths: [],
    markers: [],
    reasoning: null,
  };

  for (const tag of sortPersistedTags(tags)) {
    switch (tagKindFor(tag)) {
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

function explicitDisplayTags(tags: string[]): DisplayTag[] {
  return sortPersistedTags(tags).map(tag => ({
    active: true,
    dimensionLabel: tagKindFor(tag),
    implicitLabel: null,
    kind: tagKindFor(tag),
    source: 'explicit',
    value: tag,
  }));
}

function mergeLegacy(parentLegacy: string[], explicitLegacy: string[]) {
  return sortPersistedTags([...parentLegacy, ...explicitLegacy]).filter(
    tag => tagKindFor(tag) === 'legacy',
  );
}

function deriveNodeState(
  node: PaperNode,
  parentDimensions: DerivedDimensions | null,
): PaperNode {
  const explicitDimensions = dimensionsFromTags(node.explicitTags);
  const inheritEnabled = node.explicitInherit ?? false;
  const inheritedDimensions = parentDimensions ?? {
    family: null,
    frame: null,
    legacy: [],
    maths: [],
    markers: [],
    reasoning: null,
  };

  const nextDimensions: DerivedDimensions = node.isRootNode
    ? explicitDimensions
    : !inheritEnabled
      ? explicitDimensions
      : {
          family: explicitDimensions.family ?? inheritedDimensions.family,
          frame: explicitDimensions.frame ?? inheritedDimensions.frame,
          legacy: mergeLegacy(
            inheritedDimensions.legacy,
            explicitDimensions.legacy,
          ),
          maths: explicitDimensions.maths.length
            ? explicitDimensions.maths
            : inheritedDimensions.maths,
          markers: explicitDimensions.markers.length
            ? explicitDimensions.markers
            : inheritedDimensions.markers,
          reasoning:
            explicitDimensions.reasoning ?? inheritedDimensions.reasoning,
        };

  const inheritedReferenceTags = parentDimensions
    ? sortPersistedTags([
        ...parentDimensions.legacy,
        ...(parentDimensions.family ? [parentDimensions.family] : []),
        ...parentDimensions.maths,
        ...(parentDimensions.frame ? [parentDimensions.frame] : []),
        ...parentDimensions.markers,
        ...(parentDimensions.reasoning ? [parentDimensions.reasoning] : []),
      ])
    : [];

  const inheritedDisplayTags: DisplayTag[] = inheritedReferenceTags.map(
    tag => ({
      active: inheritEnabled,
      dimensionLabel: tagKindFor(tag),
      implicitLabel: null,
      kind: tagKindFor(tag),
      source: 'inherited' as const,
      value: tag,
    }),
  );

  const effectiveTags = sortPersistedTags([
    ...nextDimensions.legacy,
    ...(nextDimensions.family ? [nextDimensions.family] : []),
    ...nextDimensions.maths,
    ...(nextDimensions.frame ? [nextDimensions.frame] : []),
    ...nextDimensions.markers,
    ...(nextDimensions.reasoning ? [nextDimensions.reasoning] : []),
  ]);

  const sourceMap = new Map<string, 'explicit' | 'inherited'>();

  for (const tag of node.explicitTags) {
    sourceMap.set(tag, 'explicit');
  }

  if (inheritEnabled) {
    for (const tag of inheritedReferenceTags) {
      if (!sourceMap.has(tag)) {
        sourceMap.set(tag, 'inherited');
      }
    }
  }

  const effectiveDisplay: DisplayTag[] = effectiveTags.map(tag => ({
    active: true,
    dimensionLabel: tagKindFor(tag),
    implicitLabel: null,
    kind: tagKindFor(tag),
    source: sourceMap.get(tag) ?? 'explicit',
    value: tag,
  }));

  if (!nextDimensions.family) {
    effectiveDisplay.unshift({
      active: true,
      dimensionLabel: 'family',
      implicitLabel: 'implicit unknown',
      kind: 'family',
      source: 'implicit',
      value: 'family.unknown',
    });
  }

  if (!nextDimensions.maths.length) {
    effectiveDisplay.splice(
      effectiveDisplay.filter(
        tag => tag.kind === 'family' || tag.kind === 'legacy',
      ).length,
      0,
      {
        active: true,
        dimensionLabel: 'math',
        implicitLabel: 'implicit unknown',
        kind: 'math',
        source: 'implicit',
        value: 'math.unknown',
      },
    );
  }

  if (!nextDimensions.frame) {
    const insertIndex = effectiveDisplay.filter(
      tag =>
        tag.kind === 'family' || tag.kind === 'math' || tag.kind === 'legacy',
    ).length;
    effectiveDisplay.splice(insertIndex, 0, {
      active: true,
      dimensionLabel: 'frame',
      implicitLabel: 'implicit raw',
      kind: 'frame',
      source: 'implicit',
      value: 'frame.raw',
    });
  }

  if (!nextDimensions.reasoning) {
    const insertIndex = effectiveDisplay.filter(
      tag =>
        tag.kind === 'family' ||
        tag.kind === 'math' ||
        tag.kind === 'frame' ||
        tag.kind === 'marker' ||
        tag.kind === 'legacy',
    ).length;
    effectiveDisplay.splice(insertIndex, 0, {
      active: true,
      dimensionLabel: 'reasoning',
      implicitLabel: 'implicit direct',
      kind: 'reasoning',
      source: 'implicit',
      value: 'reasoning.direct',
    });
  }

  const nextNode: PaperNode = {
    ...node,
    children: node.children.map(child =>
      deriveNodeState(child, nextDimensions),
    ),
    effectiveDisplayTags: effectiveDisplay,
    effectiveTags,
    explicitDisplayTags: explicitDisplayTags(node.explicitTags),
    inheritedDisplayTags,
    inheritedTags: inheritedReferenceTags,
  };

  return nextNode;
}

function flattenNodes(nodes: PaperNode[]): PaperNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children)]);
}

export function recomputeDerivedDocument(
  document: PaperDocument,
): PaperDocument {
  const sections = document.sections.map(section => ({
    ...section,
    questions: section.questions.map(question =>
      deriveNodeState(question, null),
    ),
  }));

  return {
    ...document,
    nodesFlat: flattenNodes(sections.flatMap(section => section.questions)),
    sections,
  };
}

export function updateNodeInDocument(
  document: PaperDocument,
  nodePathValue: string,
  nextValues: { explicitInherit: boolean | null; explicitTags: string[] },
) {
  const clone = structuredClone(document) as PaperDocument;

  function visit(nodes: PaperNode[]): boolean {
    for (const node of nodes) {
      if (node.path === nodePathValue) {
        node.explicitInherit = nextValues.explicitInherit;
        node.explicitTags = sortPersistedTags(nextValues.explicitTags);
        return true;
      }

      if (visit(node.children)) {
        return true;
      }
    }

    return false;
  }

  for (const section of clone.sections) {
    visit(section.questions);
  }

  return recomputeDerivedDocument(clone);
}

export async function listPaperFiles(): Promise<FileIndexItem[]> {
  const folderKeys = await listSourceFolderKeys();
  const groups = await Promise.all(
    folderKeys.map(async folderKey => {
      const entries = await fs.readdir(resolveFolderPath(folderKey), {
        withFileTypes: true,
      });

      const files = await Promise.all(
        entries
          .filter(entry => entry.isFile() && entry.name.endsWith('.toml'))
          .map(async entry => {
            const absolutePath = path.join(
              resolveFolderPath(folderKey),
              entry.name,
            );
            const stem = relativePaperSlug(entry.name);
            const slugSegments = buildSlugSegments(entry.name);
            const navigationCopy = navigationCopyForFile(folderKey, stem);
            const navTitle = navigationCopy?.navTitle ?? humanizeStem(stem);
            const navMeta = navigationCopy?.navMeta ?? entry.name;
            const navStatusKey = navigationCopy?.navStatusKey ?? null;
            const navStatus = navigationCopy?.navStatus ?? null;
            const navStatusTone = navigationCopy?.navStatusTone ?? null;
            const navTopicKey = navigationCopy?.navTopicKey ?? null;
            const navTopicLabel = navigationCopy?.navTopicLabel ?? null;
            const { navFocusGroups, questionCount } =
              await readFileIndexDetails(absolutePath, folderKey);

            return {
              fileName: entry.name,
              folderKey,
              href: buildFileHref(folderKey, slugSegments),
              navFocusGroups,
              navMeta,
              navStatusKey,
              navStatus,
              navStatusTone,
              navTopicKey,
              navTopicLabel,
              navTitle,
              questionCount,
              relativePath: entry.name,
              searchText: [
                navTitle,
                navMeta,
                `${questionCount} questions`,
                navTopicKey ?? '',
                navTopicLabel ?? '',
                navStatusKey ?? '',
                navStatus ?? '',
                navFocusGroups.join(' '),
                entry.name,
                folderKey,
                folderLabel(folderKey),
                stem,
              ]
                .join(' ')
                .toLowerCase(),
              slugSegments,
              stem,
              title: humanizeStem(stem),
            } satisfies FileIndexItem;
          }),
      );

      return files.sort((left, right) =>
        left.navTitle.localeCompare(right.navTitle, undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
      );
    }),
  );

  return groups.flat();
}

export async function readPaperDocument(
  folderKey: FolderKey,
  relativePath: string,
): Promise<PaperDocument> {
  const absolutePath = resolvePaperFilePath(folderKey, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = parsePaperToml(raw, isExemplarFolderKey(folderKey));
  const fileName = path.basename(relativePath);
  const fileStem = relativePaperSlug(fileName);
  const sections: PaperSection[] = [];

  for (const [sectionIndex, rawSection] of (parsed.sections ?? []).entries()) {
    const section = rawSection as Record<string, unknown>;

    sections.push({
      index: sectionIndex,
      name: normalizeString(section.name) || `Section ${sectionIndex + 1}`,
      path: `section-${sectionIndex}`,
      questions: await buildQuestionNodes(
        sectionIndex,
        section.questions,
        fileStem,
      ),
    });
  }

  const document: PaperDocument = {
    fileName,
    folderKey,
    meta: {
      accessTier:
        typeof parsed.meta?.['access-tier'] === 'string'
          ? (parsed.meta['access-tier'] as string)
          : null,
      paperId:
        typeof parsed.meta?.['rtq-paper-id'] === 'string'
          ? (parsed.meta['rtq-paper-id'] as string)
          : null,
      schoolId:
        typeof parsed.meta?.['school-id'] === 'string'
          ? (parsed.meta['school-id'] as string)
          : null,
      year:
        typeof parsed.meta?.year === 'string'
          ? (parsed.meta.year as string)
          : null,
    },
    nodesFlat: [],
    questionCount: sections.reduce(
      (sum, section) => sum + section.questions.length,
      0,
    ),
    relativePath,
    sections,
    slugSegments: buildSlugSegments(relativePath),
    title: humanizeStem(fileStem),
    versionHash: hashContent(raw),
  };

  return recomputeDerivedDocument(document);
}

export async function readPaperDocumentBySlug(
  folderKey: FolderKey,
  slugSegments: string[],
) {
  return readPaperDocument(folderKey, buildRelativePathFromSlug(slugSegments));
}

export async function readPaperDocumentVersionHash(
  folderKey: FolderKey,
  relativePath: string,
) {
  const absolutePath = resolvePaperFilePath(folderKey, relativePath);
  const raw = await fs.readFile(absolutePath, 'utf8');

  return hashContent(raw);
}

export function groupedFilesByFolder(files: FileIndexItem[]) {
  const folderKeys = [...new Set(files.map(file => file.folderKey))].sort(
    compareFolderKeys,
  );

  return folderKeys.map(folderKey => ({
    description: folderLabel(folderKey),
    files: files.filter(file => file.folderKey === folderKey),
    folderKey,
    label: folderLabel(folderKey),
  }));
}
