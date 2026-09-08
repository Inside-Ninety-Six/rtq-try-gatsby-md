import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { renderMarkdownToHtml } from './markdown-renderer.ts';

test('renders generated PaperList compatibility metadata as a native list', async () => {
  const html = await renderMarkdownToHtml(
    '<!-- RTQ_PAPER_LIST_STYLE: upper-alpha -->\n\n3. Three\n4. Four',
    {},
  );

  assert.match(html, /<ol start="3" style="list-style-type: upper-alpha">/);
  assert.doesNotMatch(html, /RTQ_PAPER_LIST_STYLE/);
});

test('keeps nested generated styles independent and defaults invalid values', async () => {
  const nested = await renderMarkdownToHtml(
    [
      '<!-- RTQ_PAPER_LIST_STYLE: upper-roman -->',
      '',
      '1. Parent',
      '   <!-- RTQ_PAPER_LIST_STYLE: square -->',
      '',
      '   - Child',
    ].join('\n'),
    {},
  );
  const fallback = await renderMarkdownToHtml(
    '<!-- RTQ_PAPER_LIST_STYLE: unsupported -->\n\n- One',
    {},
  );

  assert.match(nested, /<ol style="list-style-type: upper-roman">/);
  assert.match(nested, /<ul style="list-style-type: square">/);
  assert.match(fallback, /<ul style="list-style-type: disc">/);
});

test('rejects malformed compatibility metadata', async () => {
  await assert.rejects(() =>
    renderMarkdownToHtml(
      '<!-- RTQ_PAPER_LIST_STYLE: square -->\n\nNot a list',
      {},
    ),
  );
});

test('keeps semantic defaults in CSS without depth-derived marker overrides', async () => {
  const css = await fs.readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );

  assert.match(css, /\.rtq-document ul\s*{[^}]*list-style-type:\s*disc/s);
  assert.match(css, /\.rtq-document ol\s*{[^}]*list-style-type:\s*decimal/s);
  assert.doesNotMatch(css, /\.rtq-document ul ul\s*{[^}]*lower-alpha/s);
});
