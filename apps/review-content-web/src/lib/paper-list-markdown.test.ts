import assert from 'node:assert/strict';
import test from 'node:test';

import {
  remarkPaperList,
  remarkPaperListMdx,
} from '@rtq/review-paper-markdown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { preparePaperListMarkdown } from './paper-list-markdown.ts';

test('preserves a valid PaperList for the shared render transform', () => {
  const markdown = [
    '<PaperList listStyleType="lower-alpha">',
    '',
    '1. One',
    '2. Two',
    '',
    '</PaperList>',
  ].join('\n');
  assert.deepEqual(preparePaperListMarkdown(markdown), { markdown });
});

test('keeps malformed PaperList content readable and reports the issue', () => {
  const prepared = preparePaperListMarkdown(
    '<PaperList listStyleType="square">\n\n- One\n- Two',
  );
  assert.match(prepared.issue ?? '', /PaperList|closing|end of file/i);
  assert.equal(prepared.markdown, '\n- One\n- Two');
});

test('does not parse LaTeX braces as MDX expressions during preparation', () => {
  const ordinaryWorking = String.raw`$
\begin{array}{cc}
{}^{\subtractBorrow{7}} \cancel{8} & \boxed{?}
\end{array}
$`;
  const listWithMaths = String.raw`<PaperList listStyleType="upper-alpha">

- $\dfrac{1}{3}$
- $\large{\boxed{\text{X}}}$

</PaperList>`;

  assert.deepEqual(preparePaperListMarkdown(ordinaryWorking), {
    markdown: ordinaryWorking,
  });
  assert.deepEqual(preparePaperListMarkdown(listWithMaths), {
    markdown: listWithMaths,
  });
});

test('renders PaperList through the Review Content ReactMarkdown stack', () => {
  const markdown = [
    '<PaperList listStyleType="upper-roman">',
    '',
    '3. Parent',
    '   - Unwrapped child',
    '',
    '</PaperList>',
  ].join('\n');
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        remarkPlugins: [
          remarkGfm,
          remarkMath,
          remarkPaperListMdx,
          remarkPaperList,
        ],
      },
      markdown,
    ),
  );

  assert.match(html, /<ol start="3" style="list-style-type:upper-roman">/);
  assert.match(html, /<ul>\s*<li>Unwrapped child<\/li>\s*<\/ul>/);
  assert.doesNotMatch(html, /PaperList|listStyleType/);
});

test('renders unordered styles and semantic invalid-value defaults', () => {
  const render = (markdown: string) =>
    renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkPaperListMdx, remarkPaperList] },
        markdown,
      ),
    );

  assert.match(
    render(
      '<PaperList listStyleType="square">\n\n- One\n- Two\n\n</PaperList>',
    ),
    /<ul style="list-style-type:square">/,
  );
  assert.match(
    render(
      '<PaperList listStyleType="unsafe-value">\n\n1. One\n\n</PaperList>',
    ),
    /<ol style="list-style-type:decimal">/,
  );
});
