import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { validatePaperListMarkdown } from '@rtq/review-paper-markdown/validate';

import {
  PAPER_IMAGE_EXTENSIONS,
  resolveCanonicalPaperImageExtension,
} from '@/lib/paper-asset-reader';
import { EXTERNAL_ASSETS_ROOT } from '@/lib/paper-paths';
import { prepareInlineLongDivisionSvg } from '@/lib/prepare-inline-long-division';

const API_ASSET_PREFIX = '/api/assets';
const PAPER_IMAGE_REGEX = /(?:%image%|TODOIMAGE|<PaperImage\b[^\n>]*\/>)/g;
const PAPER_IMAGE_PREPARATION_ATTRIBUTES = [
  'alt',
  'asset',
  'className',
  'description',
  'extension',
  'format',
  'height',
  'margin',
  'padding',
  'renderMode',
  'size',
  'src',
  'srcSet',
  'svgMarkup',
  'title',
  'width',
] as const;
const PAPER_IMAGE_AUTHORED_ATTRIBUTES = [
  'align',
  'assetScope',
  'displaySize',
  'indent',
  'kind',
] as const;
const LONG_DIVISION_REGEX = /<LongDivision\b[^\n>]*\/>/g;
const LONG_DIVISION_AUTHORED_ATTRIBUTES = [
  'align',
  'dividend',
  'divisor',
  'indent',
  'variant',
] as const;
const WORKING_SECTION_OPEN_REGEX = /^\s*<WorkingSection\b([^>]*)>\s*$/;
const WORKING_SECTION_CLOSE_REGEX = /^\s*<\/WorkingSection>\s*$/;
const WORKING_SECTION_ATTRIBUTE_REGEX =
  /([A-Za-z][A-Za-z0-9-]*)\s*=\s*["']([^"']*)["']/g;

type AssetContext = {
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

type LongDivisionScope = 'answer' | 'working';
type LongDivisionVariant = 'bus' | 'long';
type PreparedLongDivision = {
  alt: string;
  description: string;
  minimumReadableWidth: number;
  naturalHeight: number;
  naturalWidth: number;
  svgMarkup: string;
};
type LongDivisionMetadata = {
  alt: string;
  description: string;
  kind: 'long-division';
  provenance: {
    craftedBy: string;
    copyright: string;
  };
  title?: string;
  values: {
    dividend: string;
    divisor: string;
    quotient: string;
    remainder: string;
    variant: LongDivisionVariant;
  };
  version: 1;
};
type PaperImageAssetScope = 'answer' | 'question' | 'working';
type PaperImageMetadata = {
  alt: string | null;
  assetScope: PaperImageAssetScope;
  description: string | null;
  renderMode: 'external' | 'inline';
  version: 1;
};
type PaperImageTechnicalEntry = {
  fingerprint: string;
  format: (typeof PAPER_IMAGE_EXTENSIONS)[number];
  intrinsicHeight: number;
  intrinsicWidth: number;
};

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const keys = Object.keys(value);
  return (
    required.every(key => keys.includes(key)) &&
    keys.every(key => required.includes(key) || optional.includes(key))
  );
}

function decimalParts(value: string) {
  const [whole = '0', fractional = ''] = value.split('.');
  return {
    fractionalDigits: fractional.length,
    integer: BigInt(`${whole}${fractional}`),
  };
}

function scaledInteger(value: string, fractionalDigits: number) {
  const parsed = decimalParts(value);
  return (
    parsed.integer *
    BigInt(10) ** BigInt(fractionalDigits - parsed.fractionalDigits)
  );
}

function parseLongDivisionMetadata(
  input: unknown,
  expected: {
    dividend: string | undefined;
    divisor: string | undefined;
    variant: LongDivisionVariant;
  },
  metadataPath: string,
): LongDivisionMetadata {
  if (
    !isRecord(input) ||
    !hasExactKeys(
      input,
      ['alt', 'description', 'kind', 'provenance', 'values', 'version'],
      ['title'],
    ) ||
    input.version !== 1 ||
    input.kind !== 'long-division' ||
    typeof input.alt !== 'string' ||
    !input.alt.trim() ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    (input.title !== undefined &&
      (typeof input.title !== 'string' || !input.title.trim())) ||
    !isRecord(input.provenance) ||
    !hasExactKeys(input.provenance, ['craftedBy', 'copyright']) ||
    typeof input.provenance.craftedBy !== 'string' ||
    !input.provenance.craftedBy.trim() ||
    typeof input.provenance.copyright !== 'string' ||
    !input.provenance.copyright.trim() ||
    !isRecord(input.values) ||
    !hasExactKeys(input.values, [
      'dividend',
      'divisor',
      'quotient',
      'remainder',
      'variant',
    ]) ||
    typeof input.values.dividend !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.values.dividend) ||
    typeof input.values.divisor !== 'string' ||
    !/^[1-9]\d*$/.test(input.values.divisor) ||
    typeof input.values.quotient !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input.values.quotient) ||
    typeof input.values.remainder !== 'string' ||
    !/^\d+$/.test(input.values.remainder) ||
    !(input.values.variant === 'long' || input.values.variant === 'bus') ||
    input.values.variant !== expected.variant ||
    input.values.dividend !== expected.dividend ||
    input.values.divisor !== expected.divisor
  ) {
    throw new Error(
      `Invalid or inconsistent LongDivision metadata at ${metadataPath}.`,
    );
  }

  const fractionalDigits = Math.max(
    decimalParts(input.values.dividend).fractionalDigits,
    decimalParts(input.values.quotient).fractionalDigits,
  );
  const divisor = BigInt(input.values.divisor);
  const remainder = BigInt(input.values.remainder);
  if (
    scaledInteger(input.values.dividend, fractionalDigits) !==
      divisor * scaledInteger(input.values.quotient, fractionalDigits) +
        remainder * BigInt(10) ** BigInt(fractionalDigits) ||
    remainder >= divisor
  ) {
    throw new Error(
      `Invalid or inconsistent LongDivision metadata at ${metadataPath}.`,
    );
  }

  return input as LongDivisionMetadata;
}

function compactAssetPrefix(context: AssetContext) {
  const sectionIndex = context.assetSectionIndex ?? context.sectionIndex;
  const questionIndex = context.assetQuestionIndex ?? context.questionIndex;
  const subquestionIndex =
    context.assetSubquestionIndex ?? context.subquestionIndex;
  const subsubquestionIndex =
    context.assetSubsubquestionIndex ?? context.subsubquestionIndex;
  const parts = [
    `s${String(sectionIndex + 1).padStart(2, '0')}`,
    `q${String(questionIndex + 1).padStart(2, '0')}`,
  ];

  if (subquestionIndex !== null) {
    parts.push(`s${String(subquestionIndex + 1).padStart(2, '0')}`);
  }

  if (subsubquestionIndex !== null) {
    parts.push(`ss${String(subsubquestionIndex + 1).padStart(2, '0')}`);
  }

  return parts.join('-');
}

function paperAssetPathSegments(fileStem: string) {
  const parts = fileStem.split('--');

  if (parts.length < 4) {
    return ['missing'];
  }

  const schoolSlug = parts[0];
  const year = parts.at(-2);
  const paperSlug = parts.at(-1);

  if (!year || !paperSlug || !(year === 'undated' || /^\d{4}$/.test(year))) {
    return ['missing'];
  }

  return [schoolSlug, year === '9999' ? 'sample' : year, paperSlug];
}

function parseComponentAttributes(componentKey: string) {
  const attrs: Record<string, string> = {};

  for (const match of componentKey.matchAll(
    /([A-Za-z][A-Za-z0-9_-]*)="([^"]*)"/g,
  )) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseWorkingSectionAttributes(rawAttributes: string) {
  const attrs: Record<string, string> = {};

  for (const match of rawAttributes.matchAll(WORKING_SECTION_ATTRIBUTE_REGEX)) {
    attrs[match[1].toLowerCase()] = match[2];
  }

  return attrs;
}

function paperImageStyle(size: string, align: string) {
  const sizeMap: Record<string, string> = {
    full: 'width:100%;max-width:100%;',
    lg: 'width:100%;max-width:36rem;',
    md: 'width:100%;max-width:20rem;',
    sm: 'width:100%;max-width:16rem;',
  };
  const alignMap: Record<string, string> = {
    center: 'margin:1rem auto;',
    end: 'margin:1rem 0 1rem auto;',
    start: 'margin:1rem auto 1rem 0;',
  };

  return `${sizeMap[size]}${alignMap[align]}height:auto;display:block;`;
}

function normalizePaperImageDisplaySize(value: string | undefined) {
  if (value === undefined) return 'sm';
  if (['sm', 'md', 'lg', 'full'].includes(value)) return value;
  throw new Error(
    `Unsupported PaperImage displaySize: ${JSON.stringify(value)}; expected sm, md, lg, or full.`,
  );
}

function normalizePaperImageAlign(value: string | undefined) {
  if (value === undefined) return 'center';
  if (['start', 'center', 'end'].includes(value)) return value;
  throw new Error(
    `Unsupported PaperImage align: ${JSON.stringify(value)}; expected start, center, or end.`,
  );
}

function normalizePaperContentIndent(
  value: string | undefined,
  componentName: 'LongDivision' | 'PaperImage',
) {
  if (value === undefined) return 'none';
  if (['none', 'sm', 'md'].includes(value)) return value;
  throw new Error(
    `Unsupported ${componentName} indent: ${JSON.stringify(value)}; expected none, sm, or md.`,
  );
}

function workingSectionOpenMarkup(rawAttributes: string) {
  const attrs = parseWorkingSectionAttributes(rawAttributes);
  const phase =
    attrs.phase?.trim().toLowerCase() ||
    attrs.face?.trim().toLowerCase() ||
    'custom';
  const title = attrs.title?.trim();
  const parts = [
    `<div class="paper-working-section" data-phase="${escapeHtmlAttribute(phase)}">`,
  ];

  if (title) {
    parts.push(
      `<div class="paper-working-section-header">`,
      `<div class="paper-working-section-rule"></div>`,
      `<div class="paper-working-section-title">${escapeHtmlAttribute(title)}</div>`,
      `<div class="paper-working-section-rule"></div>`,
      `</div>`,
    );
  }

  parts.push(`<div class="paper-working-section-body">`);
  return parts.join('\n');
}

function replaceWorkingSections(text: string) {
  return text
    .split('\n')
    .map(line => {
      const openMatch = line.match(WORKING_SECTION_OPEN_REGEX);

      if (openMatch) {
        return workingSectionOpenMarkup(openMatch[1]);
      }

      if (WORKING_SECTION_CLOSE_REGEX.test(line)) {
        return '</div>\n</div>';
      }

      return line;
    })
    .join('\n');
}

function paperImageAssetRelativePath(
  context: AssetContext,
  assetScope: PaperImageAssetScope,
  scopeIndex: number | undefined,
  imageIndex: number,
) {
  const ownerSegments =
    assetScope === 'question'
      ? ['questions']
      : [assetScope === 'working' ? 'workings' : 'answers', 'manual'];
  const scopeToken =
    assetScope === 'question'
      ? ''
      : `-${assetScope === 'working' ? 'w' : 'a'}${String((scopeIndex ?? 0) + 1).padStart(2, '0')}`;

  const logicalPath = [
    'papers',
    ...paperAssetPathSegments(context.assetFileStem ?? context.fileStem),
    ...ownerSegments,
    `${compactAssetPrefix(context)}${scopeToken}-i${String(imageIndex).padStart(2, '0')}`,
  ].join('/');
  const sourceRelativeStem = [
    ...ownerSegments,
    `${compactAssetPrefix(context)}${scopeToken}-i${String(imageIndex).padStart(2, '0')}`,
  ].join('/');
  const extension = resolveCanonicalPaperImageExtension(
    context.assetFileStem ?? context.fileStem,
    sourceRelativeStem,
    EXTERNAL_ASSETS_ROOT,
  );

  return {
    extension,
    relativePath: `${logicalPath}.${extension ?? 'png'}`,
    sourceRelativePath: `${sourceRelativeStem}.${extension ?? 'png'}`,
  };
}

function paperImageTechnicalEntry(
  context: AssetContext,
  sourceRelativePath: string,
  extension: (typeof PAPER_IMAGE_EXTENSIONS)[number] | undefined,
): PaperImageTechnicalEntry {
  if (extension === undefined) {
    return {
      fingerprint: 'missing-image',
      format: 'svg',
      intrinsicHeight: 120,
      intrinsicWidth: 160,
    };
  }
  const paperRoot = path.join(
    EXTERNAL_ASSETS_ROOT,
    'papers',
    context.assetFileStem ?? context.fileStem,
  );
  const manifestPath = path.join(paperRoot, 'paper-images.generated.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Paper image technical manifest not found: ${manifestPath}`,
    );
  }
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    assets?: Record<string, PaperImageTechnicalEntry>;
    version?: unknown;
  };
  const entry = parsed.assets?.[sourceRelativePath];
  if (
    parsed.version !== 1 ||
    !entry ||
    entry.format !== extension ||
    !Number.isInteger(entry.intrinsicWidth) ||
    entry.intrinsicWidth <= 0 ||
    !Number.isInteger(entry.intrinsicHeight) ||
    entry.intrinsicHeight <= 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(entry.fingerprint)
  ) {
    throw new Error(
      `Invalid paper image technical manifest entry at ${manifestPath}: ${sourceRelativePath}`,
    );
  }
  const sourcePath = path.join(paperRoot, ...sourceRelativePath.split('/'));
  const fingerprint = `sha256:${createHash('sha256')
    .update(readFileSync(sourcePath))
    .digest('hex')}`;
  if (fingerprint !== entry.fingerprint) {
    throw new Error(
      `Stale paper image technical manifest entry at ${manifestPath}: ${sourceRelativePath}`,
    );
  }
  return entry;
}

function paperImageMetadata(
  context: AssetContext,
  assetScope: PaperImageAssetScope,
  scopeIndex: number | undefined,
  imageIndex: number,
  extension: (typeof PAPER_IMAGE_EXTENSIONS)[number] | undefined,
): PaperImageMetadata {
  const ownerSegments =
    assetScope === 'question'
      ? ['questions']
      : [assetScope === 'working' ? 'workings' : 'answers', 'manual'];
  const scopeToken =
    assetScope === 'question'
      ? ''
      : `-${assetScope === 'working' ? 'w' : 'a'}${String((scopeIndex ?? 0) + 1).padStart(2, '0')}`;
  const metadataPath = path.join(
    EXTERNAL_ASSETS_ROOT,
    'papers',
    context.assetFileStem ?? context.fileStem,
    ...ownerSegments,
    `${compactAssetPrefix(context)}${scopeToken}-i${String(imageIndex).padStart(2, '0')}.json`,
  );
  if (!existsSync(metadataPath))
    throw new Error(`PaperImage metadata sidecar not found: ${metadataPath}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Malformed PaperImage metadata JSON at ${metadataPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      `Invalid PaperImage metadata at ${metadataPath}: expected object.`,
    );
  const metadata = value as Record<string, unknown>;
  const keys = ['alt', 'assetScope', 'description', 'renderMode', 'version'];
  if (Object.keys(metadata).sort().join() !== keys.sort().join())
    throw new Error(
      `Invalid PaperImage metadata at ${metadataPath}: fields must match version 1.`,
    );
  if (
    metadata.version !== 1 ||
    metadata.assetScope !== assetScope ||
    !(
      metadata.alt === null ||
      (typeof metadata.alt === 'string' &&
        (metadata.alt === '' || metadata.alt.trim()))
    ) ||
    !(
      metadata.description === null ||
      (typeof metadata.description === 'string' && metadata.description.trim())
    ) ||
    !(metadata.renderMode === 'external' || metadata.renderMode === 'inline')
  )
    throw new Error(
      `Invalid or inconsistent PaperImage metadata at ${metadataPath}.`,
    );
  if (extension !== 'svg' && metadata.renderMode !== 'external')
    throw new Error(
      `Incompatible PaperImage metadata at ${metadataPath}: raster or missing assets require external rendering.`,
    );
  if (metadata.renderMode === 'inline')
    throw new Error(
      `Inline PaperImage SVG is not supported by this review renderer: ${metadataPath}`,
    );
  return metadata as PaperImageMetadata;
}

function longDivisionAssetRelativePath(
  context: AssetContext,
  scopeType: LongDivisionScope,
  scopeIndex: number,
  assetIndex: number,
  variant: LongDivisionVariant,
) {
  const scopePrefix = scopeType === 'answer' ? 'a' : 'w';
  const basename = `${compactAssetPrefix(context)}-${scopePrefix}${String(scopeIndex + 1).padStart(2, '0')}-ld${String(
    assetIndex,
  ).padStart(2, '0')}-${variant}.svg`;

  return {
    sourceRelativePath: [
      'papers',
      context.assetFileStem ?? context.fileStem,
      scopeType === 'answer' ? 'answers' : 'workings',
      'generated',
      'long-division',
      basename,
    ].join('/'),
  };
}

function prepareLongDivision(
  componentKey: string,
  sourceRelativePath: string,
  variant: LongDivisionVariant,
): PreparedLongDivision {
  const attrs = parseComponentAttributes(componentKey);
  const unknownAttribute = Object.keys(attrs).find(
    attribute =>
      !LONG_DIVISION_AUTHORED_ATTRIBUTES.includes(
        attribute as (typeof LONG_DIVISION_AUTHORED_ATTRIBUTES)[number],
      ),
  );
  if (unknownAttribute) {
    throw new Error(
      `LongDivision must not author ${unknownAttribute}; geometry, size, and overflow are supplied during content preparation.`,
    );
  }
  if (
    attrs.align !== undefined &&
    !['start', 'center', 'end'].includes(attrs.align)
  ) {
    throw new Error(
      `Unsupported LongDivision align: ${JSON.stringify(attrs.align)}; expected start, center, or end.`,
    );
  }
  normalizePaperContentIndent(attrs.indent, 'LongDivision');

  const svgPath = path.join(EXTERNAL_ASSETS_ROOT, sourceRelativePath);
  const metadataPath = svgPath.replace(/\.svg$/, '.json');
  const sourceRepositoryRoot = path.dirname(EXTERNAL_ASSETS_ROOT);
  if (!existsSync(svgPath))
    throw new Error(`LongDivision source SVG not found: ${svgPath}`);
  if (!existsSync(metadataPath)) {
    throw new Error(`LongDivision metadata sidecar not found: ${metadataPath}`);
  }
  const metadata = parseLongDivisionMetadata(
    JSON.parse(readFileSync(metadataPath, 'utf8')),
    { dividend: attrs.dividend, divisor: attrs.divisor, variant },
    metadataPath,
  );

  const namespace = sourceRelativePath.replace(/[^a-zA-Z0-9]+/g, '-');
  const prepared = prepareInlineLongDivisionSvg(
    sourceRepositoryRoot,
    svgPath,
    namespace,
  );
  if (
    typeof prepared.svgMarkup !== 'string' ||
    !prepared.svgMarkup ||
    typeof prepared.naturalWidth !== 'number' ||
    prepared.naturalWidth <= 0 ||
    typeof prepared.naturalHeight !== 'number' ||
    prepared.naturalHeight <= 0 ||
    typeof prepared.minimumReadableWidth !== 'number' ||
    prepared.minimumReadableWidth <= 0
  ) {
    throw new Error(`Invalid prepared LongDivision contract for ${svgPath}.`);
  }
  return {
    alt: metadata.alt,
    description: metadata.description,
    minimumReadableWidth: prepared.minimumReadableWidth,
    naturalHeight: prepared.naturalHeight,
    naturalWidth: prepared.naturalWidth,
    svgMarkup: prepared.svgMarkup,
  };
}

function paperImageMarkup(
  componentKey: string,
  relativePath: string,
  assetScope: PaperImageAssetScope,
  metadata: PaperImageMetadata,
  technical: PaperImageTechnicalEntry,
) {
  const attrs = parseComponentAttributes(componentKey);
  const kind = attrs.kind ?? 'essential';
  const displaySize = normalizePaperImageDisplaySize(attrs.displaySize);
  const align = normalizePaperImageAlign(attrs.align);
  const indent = normalizePaperContentIndent(attrs.indent, 'PaperImage');
  const alt = metadata.alt ?? '';
  const reviewState =
    metadata.alt === null
      ? 'pending'
      : metadata.alt === ''
        ? 'reviewed-decorative'
        : 'reviewed-informative';
  const descriptionId = `paper-image-${relativePath.replace(/[^a-zA-Z0-9]+/g, '-')}-description`;
  const describedBy = metadata.description
    ? ` aria-describedby="${escapeHtmlAttribute(descriptionId)}"`
    : '';
  const description = metadata.description
    ? `<span id="${escapeHtmlAttribute(descriptionId)}" class="sr-only">${escapeHtmlAttribute(metadata.description)}</span>`
    : '';

  return `<div class="paper-image-layout" data-indent="${indent}"><img src="${escapeHtmlAttribute(`${API_ASSET_PREFIX}/${relativePath}`)}" alt="${escapeHtmlAttribute(
    alt,
  )}" width="${technical.intrinsicWidth}" height="${technical.intrinsicHeight}"${describedBy} data-slot="paper-image" data-alt-review="${reviewState}" data-kind="${escapeHtmlAttribute(
    kind,
  )}" data-asset-scope="${escapeHtmlAttribute(assetScope)}" data-display-size="${escapeHtmlAttribute(displaySize)}" data-align="${escapeHtmlAttribute(
    align,
  )}" data-indent="${indent}" class="paper-image" style="${escapeHtmlAttribute(paperImageStyle(displaySize, align))}" /></div>${description}`;
}

function longDivisionMarkup(
  componentKey: string,
  sourceRelativePath: string,
  variant: LongDivisionVariant,
) {
  const attrs = parseComponentAttributes(componentKey);
  const align = attrs.align ?? 'start';
  const indent = normalizePaperContentIndent(attrs.indent, 'LongDivision');
  const prepared = prepareLongDivision(
    componentKey,
    sourceRelativePath,
    variant,
  );
  const descriptionId = `long-division-${sourceRelativePath.replace(/[^a-zA-Z0-9]+/g, '-')}-description`;

  return `<div class="paper-long-division-alignment" data-align="${align}" data-indent="${indent}"><div role="img" aria-label="${escapeHtmlAttribute(prepared.alt)}" aria-describedby="${escapeHtmlAttribute(descriptionId)}" data-slot="long-division" data-variant="${variant}" class="paper-long-division-viewport" style="--long-division-natural-width:${prepared.naturalWidth}px;--long-division-minimum-readable-width:${prepared.minimumReadableWidth}px"><div aria-hidden="true" class="paper-long-division-graphic">${prepared.svgMarkup}</div></div><span id="${escapeHtmlAttribute(descriptionId)}" class="sr-only">${escapeHtmlAttribute(prepared.description)}</span></div>`;
}

function replacePaperImages(
  text: string,
  context: AssetContext,
  expectedScope: PaperImageAssetScope,
  scopeIndex: number | undefined,
) {
  let imageIndex = 0;

  return text.replace(PAPER_IMAGE_REGEX, match => {
    const attrs = parseComponentAttributes(match);
    const preparationAttribute = PAPER_IMAGE_PREPARATION_ATTRIBUTES.find(
      attribute => attrs[attribute] !== undefined,
    );
    if (preparationAttribute) {
      throw new Error(
        `PaperImage must not author ${preparationAttribute}; asset paths, extensions, formats, and render modes are supplied during paper preparation.`,
      );
    }
    const unknownAttribute = Object.keys(attrs).find(
      attribute =>
        !PAPER_IMAGE_AUTHORED_ATTRIBUTES.includes(
          attribute as (typeof PAPER_IMAGE_AUTHORED_ATTRIBUTES)[number],
        ),
    );
    if (unknownAttribute) {
      throw new Error(
        `PaperImage must not author ${unknownAttribute}; allowed authored attributes are assetScope, kind, displaySize, align, and indent.`,
      );
    }
    if (match.startsWith('<PaperImage') && attrs.assetScope !== expectedScope) {
      throw new Error(
        `PaperImage requires assetScope="${expectedScope}" in ${expectedScope} content; received ${JSON.stringify(attrs.assetScope)}.`,
      );
    }
    if (!match.startsWith('<PaperImage') && expectedScope !== 'question') {
      throw new Error(`${match} is only supported in question content.`);
    }
    const resolution = paperImageAssetRelativePath(
      context,
      expectedScope,
      scopeIndex,
      imageIndex,
    );
    const metadata = paperImageMetadata(
      context,
      expectedScope,
      scopeIndex,
      imageIndex,
      resolution.extension,
    );
    const technical = paperImageTechnicalEntry(
      context,
      resolution.sourceRelativePath,
      resolution.extension,
    );
    imageIndex += 1;
    return paperImageMarkup(
      match,
      resolution.relativePath,
      expectedScope,
      metadata,
      technical,
    );
  });
}

function replaceLongDivisions(
  text: string,
  context: AssetContext,
  scopeType: LongDivisionScope,
  scopeIndex: number,
) {
  let assetIndex = 0;

  return text.replace(LONG_DIVISION_REGEX, match => {
    const attrs = parseComponentAttributes(match);
    const variant =
      attrs.variant === 'bus' || attrs.variant === 'long'
        ? attrs.variant
        : 'both';
    const variants: LongDivisionVariant[] =
      variant === 'both' ? ['long', 'bus'] : [variant];
    const output = variants
      .map(currentVariant => {
        const paths = longDivisionAssetRelativePath(
          context,
          scopeType,
          scopeIndex,
          assetIndex,
          currentVariant,
        );
        return longDivisionMarkup(
          match,
          paths.sourceRelativePath,
          currentVariant,
        );
      })
      .join('\n');

    assetIndex += 1;
    return output;
  });
}

export function enrichRtqMarkdown(
  text: string,
  context: AssetContext,
  options?: {
    scopeIndex?: number;
    scopeType?: LongDivisionScope;
  },
) {
  if (!text.trim()) {
    return '';
  }

  validatePaperListMarkdown(text);
  const withWorkingSections = replaceWorkingSections(text);
  const assetScope = options?.scopeType ?? 'question';
  if (assetScope !== 'question' && options?.scopeIndex === undefined) {
    throw new Error(`${assetScope} image resolution requires scopeIndex.`);
  }
  const withImages = replacePaperImages(
    withWorkingSections,
    context,
    assetScope,
    options?.scopeIndex,
  );

  if (!options?.scopeType || options.scopeIndex === undefined) {
    return withImages;
  }

  return replaceLongDivisions(
    withImages,
    context,
    options.scopeType,
    options.scopeIndex,
  );
}
