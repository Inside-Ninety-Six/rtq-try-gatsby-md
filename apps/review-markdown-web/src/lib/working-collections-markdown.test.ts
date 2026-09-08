import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { renderMarkdownToHtml } from './markdown-renderer.ts';

const generatedMarkdown = `
<div class="workings">
<div class="tips" style="margin: 1rem 0;">
**Tips**
<div class="tip">

Use **inverse operations**.

</div>
<div class="tip">

Check the result is positive.

</div>
</div>
<div class="formulas" style="margin: 1rem 0;">
**Formulas**
<div class="formula">

$x^2 + y^2$

</div>
<div class="formula">

$\\frac{a}{b}$

</div>
</div>
<div class="working">The working remains associated with these collections.</div>
<div class="tipcodeblock"><pre class="language-latex"><code class="language-latex">Use **inverse operations**.</code></pre></div>
<div class="formulacodeblock"><pre class="language-latex"><code class="language-latex">&#36;x^2 + y^2&#36;</code></pre></div>
</div>
`;

test('renders repeated generated formula and tip items in source order', async () => {
  const html = await renderMarkdownToHtml(generatedMarkdown, {});

  assert.equal((html.match(/class="tip"/g) ?? []).length, 2);
  assert.equal((html.match(/class="formula"/g) ?? []).length, 2);
  assert.ok(html.indexOf('inverse operations') < html.indexOf('positive'));
  assert.ok(html.indexOf('x^2') < html.indexOf('frac'));
  assert.match(html, /class="katex"/);
  assert.match(html, /<strong>inverse operations<\/strong>/);
  assert.match(html, /class="tipcodeblock"/);
  assert.match(html, /class="formulacodeblock"/);
});

test('keeps the established empty wrapper free of visible placeholder text', async () => {
  const html = await renderMarkdownToHtml(
    '<div class="formulas placeholder">\n**Formulas**\n</div>\n<div class="tips placeholder">\n**Tips**\n</div>',
    {},
  );

  assert.match(html, /class="formulas placeholder"/);
  assert.match(html, /class="tips placeholder"/);
  assert.doesNotMatch(html, /%empty%/);
});

test('working visibility controls cover collection, item, and raw item classes', async () => {
  const css = await fs.readFile(
    new URL('../app/globals.css', import.meta.url),
    'utf8',
  );

  for (const selector of [
    '.rtq-document .formulas',
    '.rtq-document .formula',
    '.rtq-document .tips',
    '.rtq-document .tip',
    '.rtq-document .formulacodeblock',
    '.rtq-document .tipcodeblock',
  ]) {
    assert.ok(
      css.includes(selector),
      `missing visibility selector ${selector}`,
    );
  }
});
