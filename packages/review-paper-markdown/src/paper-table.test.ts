import assert from "node:assert/strict";
import test from "node:test";

import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import {
  PAPER_TABLE_DEFAULTS,
  PAPER_TABLE_PROP_VALUES,
  rehypePaperTable,
  remarkPaperTable,
  stripPaperTableWrapperLines,
} from "./paper-table.ts";
import { remarkPaperListMdx } from "./index.ts";
import { validatePaperTableMarkdown } from "./validate.ts";

function tableSource(
  attributes = "",
  options: Readonly<{ header?: string; rows?: readonly string[] }> = {},
): string {
  return [
    attributes ? `<PaperTable ${attributes}>` : "<PaperTable>",
    "",
    options.header ?? "| Label | Value |",
    "| :--- | ---: |",
    ...(options.rows ?? ["| Alpha | $12$ |"]),
    "",
    "</PaperTable>",
  ].join("\n");
}

async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPaperListMdx)
    .use(remarkPaperTable)
    .use(remarkRehype)
    .use(rehypePaperTable)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

test("uses the exact RTQ web PaperTable values and defaults", () => {
  assert.deepEqual(PAPER_TABLE_DEFAULTS, {
    align: "start",
    blankCorner: "ruled",
    cellAlign: "center",
    columnHeaders: "first-row",
    density: "default",
    firstColumnStartPadding: "default",
    grid: "horizontal",
    indent: "none",
    rowHeaders: "none",
    width: "fit",
  });
  assert.deepEqual(PAPER_TABLE_PROP_VALUES.grid, [
    "framed",
    "horizontal",
    "interior",
    "none",
    "rows",
    "vertical",
  ]);
});

test("accepts every canonical PaperTable prop value", () => {
  for (const [name, values] of Object.entries(PAPER_TABLE_PROP_VALUES)) {
    for (const value of values) {
      const blankCornerContext =
        name === "blankCorner" && value === "open"
          ? ' columnHeaders="first-row" rowHeaders="first-column"'
          : "";
      const source = tableSource(`${name}="${value}"${blankCornerContext}`, {
        header:
          name === "blankCorner" && value === "open"
            ? "| | Value |"
            : undefined,
      });
      assert.doesNotThrow(() => validatePaperTableMarkdown(source));
    }
  }
});

test("renders configured presentation state and preserves GFM alignment", async () => {
  const html = await render(
    tableSource(
      'align="end" cellAlign="right" density="compact" firstColumnStartPadding="none" grid="interior" indent="md" width="full"',
    ),
  );

  assert.match(
    html,
    /<div class="rtq-paper-table" data-align="end" data-blank-corner="ruled" data-cell-align="right" data-cell-align-authored="" data-density="compact" data-first-column-start-padding="none" data-grid="interior" data-indent="md" data-paper-table="" data-width="full">/,
  );
  assert.match(html, /<th align="left" scope="col">Label<\/th>/);
  assert.match(html, /<th align="right" scope="col">Value<\/th>/);
  assert.match(html, /<td align="left">Alpha<\/td>/);
  assert.match(html, /<td align="right">/);
  assert.doesNotMatch(html, /data-column-headers|data-row-headers/);
});

test("applies column, row, and open-corner semantics", async () => {
  const html = await render(
    tableSource(
      'columnHeaders="first-row" rowHeaders="first-column" blankCorner="open"',
      { header: "| | Value |", rows: ["| Alpha | 12 |", "| Beta | 20 |"] },
    ),
  );

  assert.match(html, /<th align="left"><\/th>/);
  assert.match(html, /<th align="right" scope="col">Value<\/th>/);
  assert.match(html, /<th align="left" scope="row">Alpha<\/th>/);
  assert.match(html, /<th align="left" scope="row">Beta<\/th>/);
});

test("demotes the GFM header row when columnHeaders is none", async () => {
  const html = await render(tableSource('columnHeaders="none"'));

  assert.doesNotMatch(html, /<thead>/);
  assert.match(html, /<tbody>\s*<tr>\s*<td align="left">Label<\/td>/);
});

test("wraps raw GFM tables with the same visual defaults", async () => {
  const html = await render("| A | B |\n| - | - |\n| 1 | 2 |");

  assert.match(html, /<div class="rtq-paper-table" data-align="start"/);
  assert.match(html, /data-grid="horizontal"/);
  assert.match(html, /data-width="fit"/);
  assert.doesNotMatch(html, /data-paper-table/);
  assert.doesNotMatch(html, /scope="col"/);
});

test("rejects non-canonical attributes and invalid structures", () => {
  const invalidSources = [
    tableSource('density="giant"'),
    tableSource('density=" compact"'),
    tableSource('densitty="compact"'),
    tableSource('density="compact" density="roomy"'),
    tableSource("density"),
    tableSource("density={value}"),
    tableSource("{...props}"),
    "<PaperTable>\n\nParagraph\n\n</PaperTable>",
    "<PaperTable>\n\n| A |\n| - |\n| 1 |\n\n| B |\n| - |\n| 2 |\n\n</PaperTable>",
    tableSource('blankCorner="open"'),
    tableSource(
      'blankCorner="open" columnHeaders="first-row" rowHeaders="first-column"',
    ),
  ];

  for (const source of invalidSources) {
    assert.throws(() => validatePaperTableMarkdown(source), /PaperTable/);
  }
});

test("leaves fenced examples literal and strips only active fallback wrappers", async () => {
  const fenced = '```md\n<PaperTable width="full">\n</PaperTable>\n```';
  assert.doesNotThrow(() => validatePaperTableMarkdown(fenced));
  assert.match(await render(fenced), /&#x3C;PaperTable width="full">/);

  const source = `Before\n\n${tableSource('width="full"')}\n\nAfter`;
  const stripped = stripPaperTableWrapperLines(source);
  assert.doesNotMatch(stripped, /<\/?PaperTable/);
  assert.match(stripped, /Before[\s\S]*\| Label \| Value \|[\s\S]*After/);
});
