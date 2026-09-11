import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const componentUrl = new URL(
  '../components/review-surface.tsx',
  import.meta.url,
);
const siteHeaderUrl = new URL('../components/site-header.tsx', import.meta.url);
const cssUrl = new URL('../app/globals.css', import.meta.url);
const homeUrl = new URL('../app/page.tsx', import.meta.url);
const paperIndexUrl = new URL('../components/paper-index.tsx', import.meta.url);
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

test('review requests use descriptive canonical actions in both modes', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(component, /controlMode === 'simple'/);
  assert.match(component, /SIMPLE_REVIEW_OUTCOME_OPTIONS\.map/);
  assert.match(component, /REVIEW_OUTCOME_OPTIONS\.map/);
  assert.match(component, /option\.actionLabel/);
  assert.match(component, /submitOutcome\(null\)/);
  assert.match(component, />\s*Reset\s*<\/button>/);
  assert.match(
    css,
    /\.outcome-action--approved\s*{[^}]*background:\s*var\(--review-option-background\)/s,
  );
  assert.match(css, /\.outcome-action--change-requested\s*{/);
  assert.match(css, /\.outcome-action--change-complete\s*{/);
  assert.match(css, /\.outcome-action--blocked\s*{/);
  assert.match(css, /\.outcome-action--coming-soon\s*{/);
  assert.match(css, /\.review-scope--success\s*{[^}]*background:\s*#eaf7f0/s);
  assert.match(
    css,
    /\.review-action-status--success\s*{[^}]*font-weight:\s*800/s,
  );
});

test('review outcome filters are independent, URL-backed, and failure-safe', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.match(component, /<strong>Peer-review outcome<\/strong>/);
  assert.match(
    component,
    /reviewOutcomeFacets=\{result\.reviewOutcomeFacets\}/,
  );
  assert.match(component, /reviewOutcomeFilterLabel\(option\.value\)/);
  assert.match(component, /reviewOutcomeError=\{outcomeLoad\.error\}/);
  assert.match(component, /selection\.questionReview\.length/);
  assert.match(component, /selection\.answerReview\.length/);
  assert.match(
    component,
    /filterReviewPaper\(paper, selection, reviewOutcomeFilterContext\)/,
  );
});

test('top-level questions expose current outcomes and feedback as scan badges', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(component, /function QuestionReviewActivity/);
  assert.match(component, /node\.depth === 0/);
  assert.match(component, /aria-label="Current review activity"/);
  assert.match(component, /reviewOutcomeLabel\(outcome\)/);
  assert.match(component, /commentGroups\.current\.length/);
  assert.match(component, /runtime\.showPreviousFeedback/);
  assert.match(css, /--review-approved-background:/);
  assert.match(css, /--review-change-requested-background:/);
  assert.match(css, /--review-change-complete-background:/);
  assert.match(css, /--review-blocked-background:/);
  assert.match(css, /--review-coming-soon-background:/);
  assert.match(
    css,
    /\.review-activity-badge\s*{[^}]*background:\s*var\(--review-option-background/s,
  );
});

test('the sticky toolbar keeps compact filter access with focus and return controls', async () => {
  const [component, css] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(component, /aria-controls="review-filters"/);
  assert.match(component, /selectedFilterCount/);
  assert.match(component, /aria-label="Page navigation"/);
  assert.match(component, /Scroll to top \(keyboard shortcut: t\)/);
  assert.match(component, /Scroll to bottom \(keyboard shortcut: b\)/);
  assert.match(component, /key === 't' \|\| key === 'b'/);
  assert.match(component, /id="paper-bottom"/);
  assert.match(component, /id="review-filters"/);
  assert.match(component, /panel\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(component, /Back to \{returnQuestionLabel/);
  assert.match(
    css,
    /\.review-toolbar\s*{[^}]*position:\s*sticky;[^}]*top:\s*0/s,
  );
  assert.match(
    css,
    /@media \(max-width: 560px\)[\s\S]*\.review-toolbar\s*{[^}]*overflow-x:\s*auto;[^}]*position:\s*sticky/s,
  );
});

test('reports the active outcome destination once in the page header', async () => {
  const [component, siteHeader] = await Promise.all([
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(siteHeaderUrl, 'utf8'),
  ]);

  assert.match(
    component,
    /<SiteHeader compact outcomeDestination={outcomeLoad\.destination} \/>/,
  );
  assert.doesNotMatch(component, /Outcomes → Sheets/);
  assert.match(siteHeader, /Outcomes & comments → local SQLite/);
  assert.match(siteHeader, /Outcomes → Sheets · comments → local SQLite/);
});

test('paper header omits source-paper filename badges', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.doesNotMatch(component, /sourcePaperStems\.map/);
  assert.doesNotMatch(component, /<code key=\{stem\}>Source \{stem\}<\/code>/);
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

test('question bodies do not navigate when clicked or focused', async () => {
  const component = await fs.readFile(componentUrl, 'utf8');

  assert.doesNotMatch(component, /onFocusCapture=/);
  assert.doesNotMatch(component, /tabIndex=\{node\.depth === 0 \? 0 : -1\}/);
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
  const [home, paperIndex, browser, component, css] = await Promise.all([
    fs.readFile(homeUrl, 'utf8'),
    fs.readFile(paperIndexUrl, 'utf8'),
    fs.readFile(browserUrl, 'utf8'),
    fs.readFile(componentUrl, 'utf8'),
    fs.readFile(cssUrl, 'utf8'),
  ]);

  assert.match(home, /<PaperIndex initialQuery=/);
  assert.match(paperIndex, /<h1>Choose a paper<\/h1>/);
  assert.doesNotMatch(paperIndex, /Change the lens/);
  assert.match(browser, /href=\{collectionRoute\(collection\.id\)\}/);
  assert.match(browser, /aria-current=/);
  assert.match(browser, /window\.history\.replaceState/);
  assert.match(browser, /parameters\.set\('q', normalized\)/);
  assert.match(browser, /paper\.relativePath,\s*query,/);
  assert.match(
    component,
    /collectionRoute\(\s*paper\.source\.collection\.id,\s*searchParams\.get\('q'\)/,
  );
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
