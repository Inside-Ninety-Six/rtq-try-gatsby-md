import assert from "node:assert/strict";
import test from "node:test";

import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
  hasActivePaperList,
  PAPER_LIST_STYLE_TYPES,
  normalizePaperListStyleType,
  remarkPaperList,
  remarkPaperListMdx,
  stripPaperListWrapperLines,
} from "./index.ts";
import { validatePaperListMarkdown } from "./validate.ts";

async function render(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkPaperListMdx)
    .use(remarkPaperList)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);
  return String(result);
}

async function renderCompatibility(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkPaperList)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(result);
}

test("normalizes the exact supported values and semantic fallbacks", () => {
  for (const listStyleType of PAPER_LIST_STYLE_TYPES) {
    assert.equal(
      normalizePaperListStyleType(` ${listStyleType.toUpperCase()} `, true),
      listStyleType,
    );
  }
  assert.equal(normalizePaperListStyleType(undefined, true), "decimal");
  assert.equal(normalizePaperListStyleType("symbols(x)", true), "decimal");
  assert.equal(normalizePaperListStyleType("", false), "disc");
  assert.equal(normalizePaperListStyleType("inherit", false), "disc");
});

test("renders every supported browser list style without a wrapper host", async () => {
  for (const listStyleType of PAPER_LIST_STYLE_TYPES) {
    const html = await render(
      `<PaperList listStyleType="${listStyleType}">\n\n1. Alpha\n2. Beta\n\n</PaperList>`,
    );
    assert.match(
      html,
      new RegExp(`<ol style="list-style-type: ${listStyleType}">`),
    );
    assert.doesNotMatch(html, /PaperList/);
  }
});

test("uses the direct list semantics for wrapped and raw defaults", async () => {
  assert.match(
    await render("<PaperList>\n\n1. One\n2. Two\n\n</PaperList>"),
    /<ol style="list-style-type: decimal">/,
  );
  assert.match(
    await render(
      '<PaperList listStyleType="made-up">\n\n- One\n- Two\n\n</PaperList>',
    ),
    /<ul style="list-style-type: disc">/,
  );
  assert.equal(
    await render("1. One\n2. Two"),
    "<ol>\n<li>One</li>\n<li>Two</li>\n</ol>",
  );
  assert.equal(
    await render("- One\n- Two"),
    "<ul>\n<li>One</li>\n<li>Two</li>\n</ul>",
  );
});

test("preserves ordered start values and rich Markdown descendants", async () => {
  const html = await render(
    '<PaperList listStyleType="upper-roman">\n\n4. **Four** with $x$.\n5. [Five](/five)\n\n</PaperList>',
  );
  assert.match(html, /<ol start="4" style="list-style-type: upper-roman">/);
  assert.match(html, /<strong>Four<\/strong>/);
  assert.match(html, /\$x\$/);
  assert.match(html, /<a href="\/five">Five<\/a>/);
});

test("keeps nested PaperList styles independent", async () => {
  const html = await render(
    [
      '<PaperList listStyleType="upper-roman">',
      "",
      "1. Parent",
      '   <PaperList listStyleType="square">',
      "",
      "   - Child",
      "",
      "   </PaperList>",
      "",
      "</PaperList>",
    ].join("\n"),
  );
  assert.match(html, /<ol style="list-style-type: upper-roman">/);
  assert.match(html, /<ul style="list-style-type: square">/);
});

test("leaves literal fenced examples unchanged", async () => {
  const source =
    '```md\n<PaperList listStyleType="square">\n- A\n</PaperList>\n```';
  const html = await render(source);
  assert.match(html, /&#x3C;PaperList listStyleType="square">/);
  assert.match(html, /&#x3C;\/PaperList>/);
  assert.equal(hasActivePaperList(source), false);
});

test("validates PaperList content without treating LaTeX braces as JavaScript", () => {
  const workingWithoutPaperList = String.raw`$
\begin{array}{cc}
{}^{\subtractBorrow{7}} \cancel{8} & \boxed{?}
\end{array}
$`;
  const listWithMaths = String.raw`<PaperList listStyleType="upper-alpha">

- $\dfrac{1}{3}$
- $\large{\boxed{\text{X}}}$

</PaperList>`;

  assert.equal(hasActivePaperList(workingWithoutPaperList), false);
  assert.doesNotThrow(() => validatePaperListMarkdown(workingWithoutPaperList));
  assert.equal(hasActivePaperList(listWithMaths), true);
  assert.doesNotThrow(() => validatePaperListMarkdown(listWithMaths));
});

test("strips active wrapper lines for a readable error fallback only", () => {
  const source = [
    '<PaperList listStyleType="square">',
    "- A",
    "</PaperList>",
    "```md",
    '<PaperList listStyleType="circle">',
    "- Example",
    "</PaperList>",
    "```",
  ].join("\n");
  assert.equal(
    stripPaperListWrapperLines(source),
    [
      "- A",
      "```md",
      '<PaperList listStyleType="circle">',
      "- Example",
      "</PaperList>",
      "```",
    ].join("\n"),
  );
  assert.equal(
    stripPaperListWrapperLines("Before <PaperList>- A</PaperList> after"),
    "Before - A after",
  );
});

test("rejects empty, non-list, multiple-list, and unbalanced wrappers", () => {
  for (const source of [
    "<PaperList>\n\n</PaperList>",
    "<PaperList>\n\nParagraph\n\n</PaperList>",
    "<PaperList>\n\n- One\n\n1. Two\n\n</PaperList>",
    "<PaperList>\n\n- Unclosed",
    "Before <PaperList>- Inline</PaperList>",
  ]) {
    assert.throws(() => validatePaperListMarkdown(source));
  }
});

test("consumes inert generated-Markdown compatibility metadata", async () => {
  const html = await renderCompatibility(
    "<!-- RTQ_PAPER_LIST_STYLE: upper-alpha -->\n\n3. Three\n4. Four",
  );
  assert.match(html, /<ol start="3" style="list-style-type: upper-alpha">/);
  assert.doesNotMatch(html, /RTQ_PAPER_LIST_STYLE/);
});

test("uses semantic defaults for unsupported compatibility values", async () => {
  assert.match(
    await renderCompatibility(
      "<!-- RTQ_PAPER_LIST_STYLE: symbols(x) -->\n\n- One",
    ),
    /<ul style="list-style-type: disc">/,
  );
});

test("keeps generated nested styles independent", async () => {
  const html = await renderCompatibility(
    [
      "<!-- RTQ_PAPER_LIST_STYLE: upper-roman -->",
      "",
      "1. Parent",
      "   <!-- RTQ_PAPER_LIST_STYLE: square -->",
      "",
      "   - Child",
    ].join("\n"),
  );
  assert.match(html, /<ol style="list-style-type: upper-roman">/);
  assert.match(html, /<ul style="list-style-type: square">/);
});

test("rejects malformed or detached compatibility metadata", async () => {
  await assert.rejects(() =>
    renderCompatibility("<!-- RTQ_PAPER_LIST_STYLE upper-alpha -->\n\nText"),
  );
  await assert.rejects(() =>
    renderCompatibility("<!-- RTQ_PAPER_LIST_STYLE: square -->\n\nText"),
  );
});
