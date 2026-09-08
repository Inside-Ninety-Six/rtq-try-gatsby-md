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

test('renders PaperList for an isolated nested question without wrapper metadata', () => {
  const html = render(
    '<PaperList listStyleType="square">\n\n- $x^2$\n- Two\n\n</PaperList>',
  );

  assert.match(html, /<ul style="list-style-type:square">/);
  assert.doesNotMatch(html, /PaperList|listStyleType/);
});

test('falls back by semantics and rejects malformed wrappers safely', () => {
  assert.match(
    render(
      '<PaperList listStyleType="not-supported">\n\n1. One\n\n</PaperList>',
    ),
    /<ol style="list-style-type:decimal">/,
  );
  assert.throws(
    () => validatePaperListMarkdown('<PaperList>\n\n- One'),
    /closing tag|end of file/i,
  );
});

test('integrates through the viewer preparation, raw, and API error boundaries', async () => {
  const [assets, component, css, data, route] = await Promise.all([
    fs.readFile(new URL('lib/paper-assets.ts', sourceRoot), 'utf8'),
    fs.readFile(new URL('components/rtq-markdown.tsx', sourceRoot), 'utf8'),
    fs.readFile(new URL('app/globals.css', sourceRoot), 'utf8'),
    fs.readFile(new URL('lib/paper-data.ts', sourceRoot), 'utf8'),
    fs.readFile(
      new URL('app/api/current-question/route.ts', sourceRoot),
      'utf8',
    ),
  ]);

  assert.match(assets, /validatePaperListMarkdown\(text\)/);
  assert.match(component, /remarkPaperListMdx/);
  assert.match(component, /remarkPaperList/);
  assert.match(css, /\.rtq-markdown ul\s*{[^}]*list-style-type:\s*disc/s);
  assert.match(css, /\.rtq-markdown ol\s*{[^}]*list-style-type:\s*decimal/s);
  assert.match(data, /rawQuestion = asString\(rawNode\.question\)/);
  assert.match(data, /raw:\s*{[\s\S]*answers: rawAnswers/);
  assert.match(data, /formulas: renderedWorkings\.flatMap/);
  assert.match(data, /tips: renderedWorkings\.flatMap/);
  assert.match(data, /kind === 'subsubquestion'/);
  assert.match(route, /catch \(error\)/);
  assert.match(route, /messageForError\(error\)/);
});
