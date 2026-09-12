import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  rehypePaperTable,
  remarkPaperListMdx,
  remarkPaperTable,
} from '@rtq/review-paper-markdown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { rtqKatexOptions } from './rtq-katex.ts';
import { preparePaperTableMarkdown } from './paper-table-markdown.ts';

function render(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        rehypePlugins: [rehypePaperTable, [rehypeKatex, rtqKatexOptions]],
        remarkPlugins: [
          remarkGfm,
          remarkMath,
          remarkPaperListMdx,
          remarkPaperTable,
        ],
      },
      markdown,
    ),
  );
}

test('preserves a valid PaperTable for the shared render transform', () => {
  const markdown =
    '<PaperTable width="full">\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n</PaperTable>\n';
  assert.deepEqual(preparePaperTableMarkdown(markdown), { markdown });
});

test('leaves wrapper examples inside fences untouched', () => {
  const source = '```md\n<PaperTable>\n</PaperTable>\n```\n';
  assert.deepEqual(preparePaperTableMarkdown(source), { markdown: source });
});

test('keeps invalid PaperTable content readable and reports the issue', () => {
  const prepared = preparePaperTableMarkdown(
    '<PaperTable density="giant">\n\n| A |\n| - |\n| 1 |\n\n</PaperTable>',
  );
  assert.match(
    prepared.issue ?? '',
    /density.*giant.*compact.*default.*roomy/i,
  );
  assert.doesNotMatch(prepared.markdown, /<\/?PaperTable/);
  assert.match(prepared.markdown, /\| A \|/);
});

test('renders all presentation metadata and semantic headers', () => {
  const html = render(
    [
      '<PaperTable align="center" blankCorner="open" cellAlign="right" columnHeaders="first-row" density="compact" firstColumnStartPadding="none" grid="framed" indent="sm" rowHeaders="first-column" width="full">',
      '',
      '| | Value |',
      '| - | -: |',
      '| Alpha | $12$ |',
      '',
      '</PaperTable>',
    ].join('\n'),
  );

  assert.match(html, /class="rtq-paper-table"/);
  assert.match(html, /data-align="center"/);
  assert.match(html, /data-blank-corner="open"/);
  assert.match(html, /data-cell-align="right"/);
  assert.match(html, /data-cell-align-authored=""/);
  assert.match(html, /data-density="compact"/);
  assert.match(html, /data-first-column-start-padding="none"/);
  assert.match(html, /data-grid="framed"/);
  assert.match(html, /data-indent="sm"/);
  assert.match(html, /data-width="full"/);
  assert.match(html, /<th><\/th>/);
  assert.match(html, /<th scope="col" style="text-align:right">Value<\/th>/);
  assert.match(html, /<th scope="row">Alpha<\/th>/);
  assert.match(html, /class="katex"/);
});

test('renders raw GFM tables with the RTQ web defaults', () => {
  const html = render('| A | B |\n| - | - |\n| 1 | 2 |');
  assert.match(html, /class="rtq-paper-table"/);
  assert.match(html, /data-align="start"/);
  assert.match(html, /data-density="default"/);
  assert.match(html, /data-grid="horizontal"/);
  assert.match(html, /data-width="fit"/);
  assert.doesNotMatch(html, /data-paper-table/);
});

test('carries the RTQ web layout topology for every grid family', () => {
  const css = readFileSync(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );

  for (const grid of ['rows', 'horizontal', 'interior', 'framed']) {
    assert.match(css, new RegExp(`\\[data-grid=['"]${grid}['"]\\]`));
  }
  for (const grid of ['vertical', 'interior', 'framed']) {
    assert.match(css, new RegExp(`\\[data-grid=['"]${grid}['"]\\]`));
  }
  assert.match(css, /border-block-end:\s*1px solid/);
  assert.match(css, /border-block:\s*1\.5px solid/);
  assert.match(css, /border-inline-end:\s*1px solid/);
  assert.match(css, /\[data-grid='framed'\] table[\s\S]*border-inline:/);
  assert.match(css, /\[data-blank-corner='open'\][\s\S]*border-block-end: 0/);
  assert.match(css, /\[data-first-column-start-padding='none'\]/);
  assert.match(css, /\[data-density='compact'\]/);
  assert.match(css, /\[data-density='roomy'\]/);
  assert.match(css, /\[data-indent='sm'\]/);
  assert.match(css, /\[data-indent='md'\]/);
});
