import assert from 'node:assert/strict';

const baseUrl = process.env.REVIEW_CONTENT_BASE_URL ?? 'http://127.0.0.1:3001';
const paperPath =
  '/papers/toml/dulwich-college--11-plus--maths--undated--specimen-paper-f.toml';

async function read(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return { response, text: await response.text() };
}

const home = await read('/');
assert.match(home.text, /Choose a paper/);
assert.match(home.text, /Live TOML index/);
assert.doesNotMatch(home.text, /Change the lens/);

const paper = await read(paperPath);
for (const expected of [
  'Review filters',
  'Question state',
  'Answer state',
  'Workings &amp; answers',
  'Raw source',
  'Review workflow',
  'Node feedback',
  'Add comment',
  'Simple review',
  'Approved',
  'Reset',
  'S1 Q1',
  'S1 Q5a',
  'J / K',
]) {
  assert.match(paper.text, new RegExp(expected));
}
assert.match(paper.text, /api\/assets\/papers/);
assert.match(paper.text, /aria-label="Filtered question navigation"/);
assert.match(paper.text, /href="#question-s0\.q4\.sq0"/);
assert.doesNotMatch(paper.text, /rtq-question-id is unavailable/);
assert.doesNotMatch(paper.text, /previous comments are hidden/i);
assert.match(paper.text, /Own UUID · RAG inherited from S1 Q5/);
const formulaPosition = paper.text.indexOf('Formulas used');
const tipPosition = paper.text.indexOf('Keep in mind');
const workingPosition = paper.text.indexOf('solution-row--working');
assert.ok(formulaPosition >= 0, 'the formula row should render');
assert.ok(tipPosition > formulaPosition, 'the tip row should follow formulas');
assert.ok(
  workingPosition > tipPosition,
  'workings should follow formulas and tips',
);

const sourceVersion = await read(
  '/api/papers/source-version?collection=toml&path=dulwich-college--11-plus--maths--undated--specimen-paper-f.toml',
);
const sourceVersionPayload = JSON.parse(sourceVersion.text);
assert.equal(sourceVersionPayload.state, 'ready');
assert.match(sourceVersionPayload.version, /^[a-f0-9]{64}$/);
assert.equal(sourceVersion.response.headers.get('cache-control'), 'no-store');

const unsafeSourceVersion = await fetch(
  `${baseUrl}/api/papers/source-version?collection=toml&path=..%2Fpackage.json`,
);
assert.equal(unsafeSourceVersion.status, 400);
assert.deepEqual(await unsafeSourceVersion.json(), {
  message: 'The selected paper route is not reviewable.',
  state: 'unavailable',
});

const derivedPaperPath =
  '/papers/focusTopicToml/topicpapers_math.number.order_1.toml';
const derivedPaper = await read(derivedPaperPath);
assert.match(
  derivedPaper.text,
  /sevenoaks-school--11-plus--maths--2018--paper-1:1:6/,
);
assert.match(derivedPaper.text, /Add feedback as <!-- -->ap/);

const positive = await read(
  `${paperPath}?family=family.unknown&frame=frame.columnar`,
);
assert.match(positive.text, /1<!-- --> \/ <!-- -->4<!-- --> matching/);
assert.match(positive.text, /question-node--active/);

const independentStates = await read(
  `${paperPath}?question-rag=rag_wf_g0&answer-rag=rag_wf_notstarted`,
);
assert.match(independentStates.text, /1<!-- --> \/ <!-- -->1<!-- --> matching/);
assert.match(independentStates.text, /S1 Q21/);

const empty = await read(`${paperPath}?family=family.age&frame=frame.algebra`);
assert.match(empty.text, /No question shares that exact lens/);
assert.match(empty.text, /0 \/ <!-- -->26/);

const unsupportedOutcome = await fetch(`${baseUrl}/api/review/outcome`, {
  body: JSON.stringify({ outcome: 'MADE_UP', reviewer: 'up', target: {} }),
  headers: { 'Content-Type': 'application/json' },
  method: 'POST',
});
assert.equal(unsupportedOutcome.status, 400);

const spoofedComment = await fetch(`${baseUrl}/api/review/comments`, {
  body: JSON.stringify({
    comment: 'This must not be stored.',
    reviewer: 'up',
    submissionId: 'browser-smoke-spoof',
    target: {
      collectionId: 'toml',
      nodeId: 's0.q4.sq0',
      questionId: null,
      ragState: 'rag_wf_ng3',
      relativePath:
        'dulwich-college--11-plus--maths--undated--specimen-paper-f.toml',
      side: 'question',
      uuid: '3FEB7908-C2C1-4D2D-8BA6-FA61E0590DC2',
    },
  }),
  headers: { 'Content-Type': 'application/json' },
  method: 'POST',
});
assert.equal(spoofedComment.status, 409);

for (const method of ['DELETE', 'GET', 'PATCH']) {
  const response = await fetch(`${baseUrl}/api/review/comments`, { method });
  assert.equal(
    response.status,
    405,
    `${method} comments must remain unavailable`,
  );
}

const asset = await fetch(
  `${baseUrl}/api/assets/papers/dulwich-college--11-plus--maths--undated--specimen-paper-f/workings/generated/long-division/s01-q03-w01-ld00-bus.svg`,
);
assert.equal(asset.status, 200);
assert.equal(asset.headers.get('content-type'), 'image/svg+xml');
assert.match(await asset.text(), /<svg/);

console.log(`Review Content Web smoke passed at ${baseUrl}.`);
