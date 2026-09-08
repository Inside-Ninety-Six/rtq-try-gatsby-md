# RTQ Review Paper Markdown

Renderer-neutral Markdown compatibility shared by the maintained RTQ review
applications. It does not import application UI or content repositories.

## PaperList

`PaperList` wraps exactly one Markdown ordered or unordered list and accepts an
optional `listStyleType`:

```mdx
<PaperList listStyleType="lower-alpha">

1. First
2. Second

</PaperList>
```

The supported values are `none`, `disc`, `circle`, `square`, `decimal`,
`decimal-leading-zero`, `lower-alpha`, `upper-alpha`, `lower-roman`, and
`upper-roman`. Values are trimmed and normalized case-insensitively. Missing or
unsupported values resolve from the direct list semantics: ordered lists use
`decimal` and unordered lists use `disc`.

The remark transform removes the wrapper and applies the validated native CSS
`list-style-type` to that list. It does not add marker artwork, layout,
typography, colour, or context-specific styling. Nested wrappers are resolved
independently, and fenced source examples remain literal.

Use `validatePaperListMarkdown` from `@rtq/review-paper-markdown/validate` on a
server preparation boundary when malformed content needs to become a
reviewer-facing preparation issue rather than a render failure.
