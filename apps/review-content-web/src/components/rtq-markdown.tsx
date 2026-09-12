'use client';

import {
  rehypePaperTable,
  remarkPaperList,
  remarkPaperListMdx,
  remarkPaperTable,
} from '@rtq/review-paper-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { rtqKatexOptions } from '@/lib/rtq-katex';

export function RtqMarkdown({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return null;
  return (
    <div className="rtq-markdown">
      <ReactMarkdown
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          img: ({ alt, src, title }) => (
            // Canonical local assets have dynamic dimensions and are deliberately
            // served by the narrow same-origin route rather than Next Image.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={alt ?? ''} src={src} title={title} />
          ),
        }}
        rehypePlugins={[rehypePaperTable, [rehypeKatex, rtqKatexOptions]]}
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          remarkPaperListMdx,
          remarkPaperTable,
          remarkPaperList,
        ]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
