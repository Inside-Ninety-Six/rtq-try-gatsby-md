import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import * as paperPaths from './paper-paths.ts';

test('resolves the canonical @rtq/papers package in the supported layout', () => {
  assert.equal(
    paperPaths.SOURCE_PAPERS_PACKAGE_ROOT,
    path.resolve(paperPaths.REPO_ROOT, '../rtq-content/packages/papers'),
  );
  assert.equal(
    paperPaths.SOURCE_PAPERS_ROOT,
    path.join(paperPaths.SOURCE_PAPERS_PACKAGE_ROOT, 'papers'),
  );
});

test('keeps paper paths contained in the nested package papers directory', () => {
  assert.throws(
    () => paperPaths.resolvePaperFile('../outside.toml'),
    /must stay inside the @rtq\/papers papers directory/,
  );
});
