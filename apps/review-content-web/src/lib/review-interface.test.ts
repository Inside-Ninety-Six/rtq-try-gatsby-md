import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const componentUrl = new URL(
  '../components/review-surface.tsx',
  import.meta.url,
);
const cssUrl = new URL('../app/globals.css', import.meta.url);
const homeUrl = new URL('../app/page.tsx', import.meta.url);
const browserUrl = new URL('../components/file-browser.tsx', import.meta.url);
const macrosPageUrl = new URL('../app/macros/page.tsx', import.meta.url);
const macrosListUrl = new URL(
  '../components/macro-review-list.tsx',
  import.meta.url,
);
const markdownUrl = new URL('../components/rtq-markdown.tsx', import.meta.url);
const preparePaperUrl = new URL('../lib/prepare-paper.ts', import.meta.url);

test('display preferences use accessible switches and independent review sides', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.match(component, /role="switch"/);
  assert.match(component, /label="Question review"/);
  assert.match(component, /label="Answer review"/);
  assert.match(component, /label="Simple review"/);
  assert.match(component, /label="Show previous feedback"/);
  assert.doesNotMatch(component, /label="Review panel"/);
  assert.doesNotMatch(component, /label="Show everything"/);
});

test('simple review exposes approve and reset while advanced review keeps all outcomes', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(component, /controlMode === 'simple'/);
  assert.match(component, />\s*Approved\s*<\/button>/);
  assert.match(component, /submitOutcome\(null\)/);
  assert.match(component, />\s*Reset\s*<\/button>/);
  assert.match(component, /REVIEW_OUTCOMES\.map/);
  assert.match(
    css,
    /\.simple-outcome-approve\s*{[^}]*background:\s*var\(--ready\)/s,
  );
  assert.match(css, /\.review-scope--success\s*{[^}]*background:\s*#eaf7f0/s);
  assert.match(
    css,
    /\.review-action-status--success\s*{[^}]*font-weight:\s*800/s,
  );
});

test('the filtered paper rail links every visible question hierarchy level', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(component, /function QuestionIndexNode/);
  assert.match(component, /href=\{`#question-\$\{node\.id\}`\}/);
  assert.match(component, /node\.children\.map/);
  assert.match(component, /sections=\{result\.matchingSections\}/);
  assert.match(component, /aria-label="Filtered question navigation"/);
  assert.match(
    css,
    /\.question-index\s*{[^}]*position:\s*sticky;[^}]*top:\s*5rem/s,
  );
});

test('previous feedback is controlled globally without repeated hidden-history prompts', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.match(component, /label="Show previous feedback"/);
  assert.match(component, /runtime\.showPreviousFeedback/);
  assert.doesNotMatch(component, /previous comments are hidden/i);
  assert.doesNotMatch(component, /Use Show previous feedback above/i);
});

test('feedback follows the stable composer in a full-width review flow', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);
  const composerPosition = component.indexOf('className="comment-form"');
  const feedbackPosition = component.indexOf('className={`feedback-region');

  assert.ok(composerPosition >= 0, 'comment composer should render');
  assert.ok(
    feedbackPosition > composerPosition,
    'growing feedback should render after the stable composer',
  );
  assert.match(
    css,
    /\.review-scopes\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
  );
  assert.match(
    css,
    /\.feedback-region--populated\s*{[^}]*border:\s*2px solid var\(--signal\)/s,
  );
});

test('focusing an interactive review control does not navigate its question', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.match(component, /onFocusCapture=\{\(event\) =>/);
  assert.match(component, /event\.target === event\.currentTarget/);
  assert.doesNotMatch(component, /onFocusCapture=\{onActivate\}/);
});

test('review surfaces stay light and reviewer-facing rem sizes stay readable', async () => {
  const css = await fs.readFile(cssUrl, 'utf8');
  const remSizes = [...css.matchAll(/font-size:\s*(0\.\d+)rem/g)].map((match) =>
    Number(match[1]),
  );

  assert.doesNotMatch(css, /#1d2822/i);
  assert.doesNotMatch(css, /repeating-linear-gradient/);
  assert.match(
    css,
    /\.raw-source pre\s*{[^}]*background:\s*var\(--paper-deep\)/s,
  );
  assert.ok(
    remSizes.every((size) => size >= 0.875),
    `found a reviewer-facing rem size below 0.875rem: ${Math.min(...remSizes)}`,
  );
});

test('review Markdown uses the shared PaperList contract and semantic defaults', async () => {
  const [markdown, preparation, css] = await Promise.all([
    fs.readFile(markdownUrl, 'utf8'),
    fs.readFile(preparePaperUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(markdown, /@rtq\/review-paper-markdown/);
  assert.match(markdown, /remarkPaperListMdx/);
  assert.match(markdown, /remarkPaperList/);
  assert.match(
    preparation,
    /const paperLists = preparePaperListMarkdown\(tables\)/,
  );
  assert.match(preparation, /rendered: normalizeWorkingSections\(prepared/);
  assert.match(preparation, /children: node\.children\.map\(prepareNode\)/);
  assert.match(
    preparation,
    /question: prepareField\(node\.content\.question\)/,
  );
  assert.match(preparation, /answer: prepareField\(answer\.answer\)/);
  assert.match(preparation, /key: prepareField\(answer\.key\)/);
  assert.match(preparation, /option: prepareField\(answer\.option\)/);
  assert.match(preparation, /formulas: working\.formulas\.map/);
  assert.match(preparation, /tips: working\.tips\.map/);
  assert.match(preparation, /working: prepareField\(working\.working/);
  assert.match(css, /\.rtq-markdown ul\s*{[^}]*list-style-type:\s*disc/s);
  assert.match(css, /\.rtq-markdown ol\s*{[^}]*list-style-type:\s*decimal/s);
});

test('the landing page uses a compact paper-first introduction', async () => {
  const [home, css] = await Promise.all([
    fs.readFile(homeUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(home, /<h1>Choose a paper<\/h1>/);
  assert.doesNotMatch(home, /Change the lens/);
  assert.match(css, /\.index-intro\s*{[^}]*padding:\s*1\.5rem 0/s);
  assert.match(
    css,
    /\.collection-rail\s*{[^}]*background:\s*var\(--paper-deep\)/s,
  );
});

test('the paper rail links to a read-only whole-file macro review', async () => {
  const [browser, macrosPage, macrosList, css] = await Promise.all([
    fs.readFile(browserUrl, 'utf8'),
    fs.readFile(macrosPageUrl, 'utf8'),
    fs.readFile(macrosListUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(browser, /href="\/macros"/);
  assert.match(macrosPage, /readReviewMacros/);
  assert.match(
    macrosPage,
    /<MacroReviewList entries=\{macroDocument\.entries\}/,
  );
  assert.match(macrosPage, /Show complete raw file/);
  assert.match(macrosList, /entries\.map/);
  assert.match(macrosList, /role="switch"/);
  assert.match(macrosList, /Show original source/);
  assert.match(macrosList, /showOriginalSource \? \(/);
  assert.match(macrosList, /<RtqMarkdown markdown=\{entry\.expanded\}/);
  assert.doesNotMatch(macrosList, /Show expansion source/);
  assert.doesNotMatch(macrosList, /<details className="macro-entry-source"/);
  assert.doesNotMatch(macrosPage, /ReviewSurface|reviewContentReviewer/);
  assert.match(
    css,
    /\.review-toolbar\s*{[^}]*position:\s*sticky;[^}]*top:\s*0/s,
  );
  assert.match(
    css,
    /\.macro-preview\s*{[^}]*border-left:\s*3px solid var\(--ink\)/s,
  );
});

test('working content mirrors the production row hierarchy and stage rail', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  const formulasPosition = component.indexOf('label="Formulas used"');
  const tipsPosition = component.indexOf('label="Keep in mind"');
  const bodyPosition = component.indexOf('solution-row--working');

  assert.ok(formulasPosition >= 0, 'formula row label should render');
  assert.ok(tipsPosition > formulasPosition, 'tips should follow formulas');
  assert.ok(bodyPosition > tipsPosition, 'working body should follow tips');
  assert.match(component, /className="working-method-divider"/);
  assert.match(component, /className="working-stage-track"/);
  assert.match(component, /className="working-stage-title-rule"/);
  assert.match(component, /segment\.visibility === 'hidden'/);
  assert.match(
    css,
    /\.working-stage\s*{[^}]*grid-template-columns:\s*0\.8rem minmax\(0, 1fr\)/s,
  );
  assert.match(css, /\.working-stage-rail\s*{[^}]*width:\s*1px/s);
  assert.match(
    css,
    /@media \(max-width: 800px\)[\s\S]*\.solution-row\s*{[^}]*grid-template-columns:\s*1fr/s,
  );
});
