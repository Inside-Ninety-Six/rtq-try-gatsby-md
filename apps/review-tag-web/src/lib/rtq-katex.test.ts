import assert from 'node:assert/strict';
import test from 'node:test';

import katex from 'katex';

import { rtqKatexOptions } from './rtq-katex.ts';

test('renders the shared equationNumber macro', () => {
  const html = katex.renderToString(
    String.raw`\equationNumber{7}`,
    rtqKatexOptions,
  );

  assert.match(html, /class="[^"]*rtq-maths-equation-number/);
  assert.ok(html.replace(/<[^>]+>/g, '').includes('(7)'));
});

test('renders sequenceStep with a fractional step', () => {
  const html = katex.renderToString(String.raw`\sequenceStep{\dfrac{1}{1}}`, {
    ...rtqKatexOptions,
    throwOnError: true,
  });

  assert.doesNotMatch(html, /katex-error/);
  assert.match(html, /color:#ed5fa6/);
});
