import { stripPaperTableWrapperLines } from '@rtq/review-paper-markdown';
import { validatePaperTableMarkdown } from '@rtq/review-paper-markdown/validate';

export type PreparedPaperTableMarkdown = Readonly<{
  issue?: string;
  markdown: string;
}>;

/** Validate authored PaperTable configuration while preserving it for render. */
export function preparePaperTableMarkdown(
  markdown: string,
): PreparedPaperTableMarkdown {
  try {
    validatePaperTableMarkdown(markdown);
    return { markdown };
  } catch (error) {
    return {
      issue:
        error instanceof Error
          ? error.message
          : 'PaperTable preparation failed.',
      markdown: stripPaperTableWrapperLines(markdown),
    };
  }
}
