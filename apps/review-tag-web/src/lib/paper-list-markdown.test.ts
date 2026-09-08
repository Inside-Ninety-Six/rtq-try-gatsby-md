import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  remarkPaperList,
  remarkPaperListMdx,
} from '@rtq/review-paper-markdown';
import { validatePaperListMarkdown } from '@rtq/review-paper-markdown/validate';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';

const sourceRoot = new URL('..', import.meta.url);

function render(markdown: string) {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkMath, remarkPaperListMdx, remarkPaperList],
      },
      markdown,
    ),
  );
}

test('renders validated PaperList markers with isolated list semantics', () => {
  const html = render(
    [
      '<PaperList listStyleType="upper-alpha">',
      '',
      '3. $\\dfrac{1}{3}$',
      '   - Native nested list',
      '',
      '</PaperList>',
    ].join('\n'),
  );

  assert.match(html, /<ol start="3" style="list-style-type:upper-alpha">/);
  assert.match(html, /<ul>\s*<li>Native nested list<\/li>\s*<\/ul>/);
  assert.doesNotMatch(html, /PaperList|listStyleType/);
});

test('rejects malformed wrappers without rejecting ordinary LaTeX', () => {
  assert.doesNotThrow(() =>
    validatePaperListMarkdown(String.raw`$\large{\boxed{?}}$`),
  );
  assert.throws(
    () => validatePaperListMarkdown('<PaperList>\n\nParagraph\n\n</PaperList>'),
    /exactly one ordered or unordered Markdown list/,
  );
});

test('uses the shared contract at the central read-only Tag Web boundaries', async () => {
  const [assets, component, css, data, folderMetadata] = await Promise.all([
    fs.readFile(new URL('lib/paper-assets.ts', sourceRoot), 'utf8'),
    fs.readFile(new URL('components/rtq-markdown.tsx', sourceRoot), 'utf8'),
    fs.readFile(new URL('app/globals.css', sourceRoot), 'utf8'),
    fs.readFile(new URL('lib/paper-data.ts', sourceRoot), 'utf8'),
    fs.readFile(new URL('lib/paper-folder-metadata.ts', sourceRoot), 'utf8'),
  ]);

  assert.match(assets, /validatePaperListMarkdown\(text\)/);
  assert.match(component, /remarkPaperListMdx/);
  assert.match(component, /remarkPaperList/);
  assert.match(css, /\.rtq-markdown ul\s*{[^}]*list-style-type:\s*disc/s);
  assert.match(css, /\.rtq-markdown ol\s*{[^}]*list-style-type:\s*decimal/s);
  assert.doesNotMatch(css, /\.rtq-markdown ul ul\s*{[^}]*lower-alpha/s);
  assert.match(data, /children: await buildSubquestionNodes/);
  assert.match(data, /formulas: await Promise\.all/);
  assert.match(data, /tips: await Promise\.all/);
  assert.match(data, /scopeType: 'answer'/);
  const editableFolders = folderMetadata.match(
    /EDITABLE_FOLDER_ORDER[^=]*=\s*\[([\s\S]*?)\];/,
  )?.[1];
  const visibleFolders = folderMetadata.match(
    /export const FOLDER_ORDER[^=]*=\s*\[([\s\S]*?)\];/,
  )?.[1];

  assert.ok(editableFolders);
  assert.ok(visibleFolders);
  assert.doesNotMatch(editableFolders, /allTopicsToml/);
  assert.match(visibleFolders, /allTopicsToml/);
});
