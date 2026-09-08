import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveRtqContentPaths } from '@rtq/review-repository-paths';
import type {
  ReviewAssetContext,
  ReviewContentField,
  ReviewPaper,
} from '@rtq/review-paper-model';

import type {
  DisplayContentField,
  DisplayPaperNode,
  DisplayReviewPaper,
  DisplayWorkingSegment,
} from './display-model';
import { preparePaperListMarkdown } from './paper-list-markdown';
import { normalizePaperTableMarkdown } from './paper-table-markdown';
import {
  parseWorkingSections,
  type WorkingSectionParseResult,
} from './working-sections';

const IMAGE = /(?:%image%|TODOIMAGE|<PaperImage\b[^\n>]*\/>)/g;
const LONG_DIVISION = /<LongDivision\b[^\n>]*\/>/g;
const ATTRIBUTE = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*["']([^"']*)["']/g;
const IMAGE_EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg'] as const;
const MISSING_IMAGE = 'papers/missing/missing_image.svg';
const MDX_COMMENT = /\{\/\*[\s\S]*?\*\/\}/g;

type ImageScope = 'answer' | 'question' | 'working';

function attributes(value: string): Record<string, string> {
  return Object.fromEntries(
    [...value.matchAll(ATTRIBUTE)].map((match) => [match[1], match[2]]),
  );
}

function markdownText(value: string): string {
  return value
    .replace(/[\\\[\]]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim();
}

function markdownTitle(value: string): string {
  return value.replace(/["\r\n]+/g, ' ').trim();
}

function assetUrl(relativePath: string): string {
  return `/api/assets/${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

function compactPrefix(context: ReviewAssetContext): string {
  const parts = [
    `s${String(context.sectionIndex + 1).padStart(2, '0')}`,
    `q${String(context.questionIndex + 1).padStart(2, '0')}`,
  ];
  if (context.subquestionIndex !== undefined) {
    parts.push(`s${String(context.subquestionIndex + 1).padStart(2, '0')}`);
  }
  if (context.subSubquestionIndex !== undefined) {
    parts.push(`ss${String(context.subSubquestionIndex + 1).padStart(2, '0')}`);
  }
  return parts.join('-');
}

function ownerPath(
  context: ReviewAssetContext,
  scope: ImageScope,
  imageIndex: number,
): Readonly<{ metadata: string; sourceStem: string }> {
  const owner =
    scope === 'question'
      ? 'questions'
      : `${scope === 'working' ? 'workings' : 'answers'}/manual`;
  const scopeIndex =
    scope === 'working' ? context.workingIndex : context.answerIndex;
  const scopeToken =
    scope === 'question'
      ? ''
      : `-${scope === 'working' ? 'w' : 'a'}${String((scopeIndex ?? 0) + 1).padStart(2, '0')}`;
  const basename = `${compactPrefix(context)}${scopeToken}-i${String(
    imageIndex,
  ).padStart(2, '0')}`;
  return {
    metadata: `${owner}/${basename}.json`,
    sourceStem: `${owner}/${basename}`,
  };
}

function imageMetadata(
  paperRoot: string,
  metadataPath: string,
): Readonly<{ alt: string; description: string }> {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(paperRoot, ...metadataPath.split('/')), 'utf8'),
    ) as Record<string, unknown>;
    return {
      alt: typeof parsed.alt === 'string' ? parsed.alt : '',
      description:
        typeof parsed.description === 'string' ? parsed.description : '',
    };
  } catch {
    return { alt: 'Paper image', description: '' };
  }
}

function paperImageMarkdown(
  component: string,
  context: ReviewAssetContext,
  imageIndex: number,
): string {
  const authored = attributes(component);
  const scope = (authored.assetScope ?? context.scope) as ImageScope;
  if (!['question', 'working', 'answer'].includes(scope)) {
    throw new Error(`Unsupported PaperImage assetScope: ${scope}`);
  }
  if (scope !== context.scope) {
    throw new Error(
      `PaperImage assetScope ${scope} does not match ${context.scope} content.`,
    );
  }

  const assetsRoot = resolveRtqContentPaths().assetsRoot;
  const paperRoot = path.join(assetsRoot, 'papers', context.paperStem);
  const location = ownerPath(context, scope, imageIndex);
  const matches = IMAGE_EXTENSIONS.filter((extension) =>
    existsSync(path.join(paperRoot, `${location.sourceStem}.${extension}`)),
  );
  if (matches.length > 1) {
    throw new Error(`Ambiguous PaperImage at ${location.sourceStem}.`);
  }
  if (matches.length === 0) {
    return `![Missing paper image](${assetUrl(MISSING_IMAGE)})`;
  }

  const metadata = imageMetadata(paperRoot, location.metadata);
  const relativePath = `papers/${context.paperStem}/${location.sourceStem}.${matches[0]}`;
  const title = metadata.description
    ? ` "${markdownTitle(metadata.description)}"`
    : '';
  return `![${markdownText(metadata.alt)}](${assetUrl(relativePath)}${title})`;
}

function longDivisionPath(
  context: ReviewAssetContext,
  assetIndex: number,
  variant: 'bus' | 'long',
): string {
  const scope = context.scope;
  if (scope !== 'working' && scope !== 'answer') {
    throw new Error('LongDivision is only supported in solution content.');
  }
  const scopeIndex =
    scope === 'working' ? context.workingIndex : context.answerIndex;
  const token = scope === 'working' ? 'w' : 'a';
  const basename = `${compactPrefix(context)}-${token}${String(
    (scopeIndex ?? 0) + 1,
  ).padStart(2, '0')}-ld${String(assetIndex).padStart(2, '0')}-${variant}`;
  return `${scope === 'working' ? 'workings' : 'answers'}/generated/long-division/${basename}`;
}

function longDivisionMarkdown(
  component: string,
  context: ReviewAssetContext,
  assetIndex: number,
): string {
  const authored = attributes(component);
  const requested: readonly ('bus' | 'long')[] =
    authored.variant === 'bus' || authored.variant === 'long'
      ? [authored.variant]
      : ['long', 'bus'];
  return requested
    .map((variant) => {
      const sourceStem = longDivisionPath(context, assetIndex, variant);
      const assetsRoot = resolveRtqContentPaths().assetsRoot;
      const metadataPath = path.join(
        assetsRoot,
        'papers',
        context.paperStem,
        `${sourceStem}.json`,
      );
      let alt = `${authored.dividend ?? 'Number'} divided by ${authored.divisor ?? 'number'}, ${variant} method`;
      let description = '';
      try {
        const metadata = JSON.parse(
          readFileSync(metadataPath, 'utf8'),
        ) as Record<string, unknown>;
        if (typeof metadata.alt === 'string') alt = metadata.alt;
        if (typeof metadata.description === 'string') {
          description = metadata.description;
        }
      } catch {
        // The same-origin route supplies the standard missing-image fallback.
      }
      const relativePath = `papers/${context.paperStem}/${sourceStem}.svg`;
      const title = description ? ` "${markdownTitle(description)}"` : '';
      return `![${markdownText(alt)}](${assetUrl(relativePath)}${title})`;
    })
    .join('\n\n');
}

function normalizeWorkingSections(
  value: string,
  parsed: WorkingSectionParseResult = parseWorkingSections(value),
): string {
  if (!parsed.segments) return value;
  return parsed.segments
    .flatMap((segment) => {
      if (segment.kind === 'flat') return segment.markdown;
      if (segment.visibility === 'hidden') return [];
      return segment.title
        ? `**${markdownText(segment.title)}**\n\n${segment.markdown}`
        : segment.markdown;
    })
    .join('\n\n');
}

function prepareField(
  field: ReviewContentField,
  options: Readonly<{ preserveWorkingSections?: boolean }> = {},
): DisplayContentField {
  try {
    let imageIndex = 0;
    let divisionIndex = 0;
    const tables = normalizePaperTableMarkdown(
      field.expanded.replace(MDX_COMMENT, ''),
    );
    const paperLists = preparePaperListMarkdown(tables);
    const images = paperLists.markdown.replace(IMAGE, (component) =>
      paperImageMarkdown(component, field.context, imageIndex++),
    );
    const prepared = images.replace(LONG_DIVISION, (component) =>
      longDivisionMarkdown(component, field.context, divisionIndex++),
    );
    const parsed = options.preserveWorkingSections
      ? parseWorkingSections(prepared)
      : {};
    const workingSegments = parsed.segments?.map<DisplayWorkingSegment>(
      (segment) =>
        segment.kind === 'flat'
          ? { kind: 'flat', rendered: segment.markdown }
          : {
              kind: 'section',
              phase: segment.phase,
              rendered: segment.markdown,
              ...(segment.title ? { title: segment.title } : {}),
              visibility: segment.visibility,
            },
    );
    return {
      ...field,
      ...(paperLists.issue || parsed.issue
        ? {
            preparationIssue: [paperLists.issue, parsed.issue]
              .filter(Boolean)
              .join(' '),
          }
        : {}),
      rendered: normalizeWorkingSections(prepared, parsed),
      ...(workingSegments ? { workingSegments } : {}),
    };
  } catch (error) {
    return {
      ...field,
      preparationIssue:
        error instanceof Error ? error.message : 'Content preparation failed.',
      rendered: field.expanded
        .replace(IMAGE, '**Paper image unavailable.**')
        .replace(LONG_DIVISION, '**Long division unavailable.**'),
    };
  }
}

function prepareNode(
  node: ReviewPaper['sections'][number]['questions'][number],
): DisplayPaperNode {
  return {
    ...node,
    children: node.children.map(prepareNode),
    content: {
      answers: node.content.answers.map((answer) => ({
        answer: prepareField(answer.answer),
        key: prepareField(answer.key),
        option: prepareField(answer.option),
      })),
      question: prepareField(node.content.question),
      workings: node.content.workings.map((working) => ({
        formulas: working.formulas.map((field) => prepareField(field)),
        tips: working.tips.map((field) => prepareField(field)),
        working: prepareField(working.working, {
          preserveWorkingSections: true,
        }),
      })),
    },
  };
}

export function prepareReviewPaperForDisplay(
  paper: ReviewPaper,
): DisplayReviewPaper {
  return {
    ...paper,
    sections: paper.sections.map((section) => ({
      ...section,
      questions: section.questions.map(prepareNode),
    })),
  };
}
