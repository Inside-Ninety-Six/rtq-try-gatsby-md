import { unified } from "unified";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";

import {
  hasActivePaperList,
  remarkPaperList,
  remarkPaperListMdx,
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
