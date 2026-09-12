import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";

import {
  hasActivePaperList,
  hasActivePaperTable,
  remarkPaperList,
  remarkPaperListMdx,
  remarkPaperTable,
} from "./index.ts";

export function validatePaperListMarkdown(markdown: string): void {
  if (!hasActivePaperList(markdown)) return;

  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkPaperListMdx)
    .use(remarkPaperList);
  processor.runSync(processor.parse(markdown));
}

export function validatePaperTableMarkdown(markdown: string): void {
  if (!hasActivePaperTable(markdown)) return;

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkPaperListMdx)
    .use(remarkPaperTable);
  processor.runSync(processor.parse(markdown));
}
