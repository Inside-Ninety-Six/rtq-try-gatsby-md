import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as publicApi from './index.ts';
import {
  getContentWorkspaceStatus,
  resolvePaperCollectionRoot,
  resolvePaperSourcePath,
} from './index.ts';

function createContentWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'rtq-review-paper-model-'));
  const papersPackageRoot = join(root, 'packages', 'papers');
  const assetsPackageRoot = join(root, 'packages', 'assets');

  mkdirSync(join(papersPackageRoot, 'papers', 'toml'), { recursive: true });
  mkdirSync(join(assetsPackageRoot, 'assets'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@rtq/content-workspace' }),
  );
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(
    join(papersPackageRoot, 'package.json'),
    JSON.stringify({ name: '@rtq/papers' }),
  );
  writeFileSync(
    join(assetsPackageRoot, 'package.json'),
    JSON.stringify({ name: '@rtq/maths-assets' }),
  );

  return root;
}

test('exports a read-only public surface', () => {
  for (const expectedExport of [
    'DIMENSIONAL_TAG_AXES',
    'REVIEWABLE_COLLECTION_IDS',
    'clearReviewOutcomeFilters',
    'getContentWorkspaceStatus',
    'filterReviewPaper',
    'inspectPaperSource',
    'listPaperCollections',
    'listPaperSources',
    'parseDimensionalFilterSearchParams',
    'readReviewMacros',
    'readReviewPaper',
    'resolveReviewPaperTags',
    'resolvePaperCollectionRoot',
    'resolvePaperSourcePath',
  ]) {
    assert.equal(expectedExport in publicApi, true, expectedExport);
  }
  assert.equal(
    Object.keys(publicApi).some((name) =>
      /write|save|update|delete/i.test(name),
    ),
    false,
  );
});

test('reports a serializable validated workspace without exposing paths', () => {
  const root = createContentWorkspace();

  try {
    const status = getContentWorkspaceStatus({
      environment: { RTQ_CONTENT_ROOT: root },
    });

    assert.deepEqual(JSON.parse(JSON.stringify(status)), {
      assetsPackage: '@rtq/maths-assets',
      papersPackage: '@rtq/papers',
      source: 'rtq-content',
      state: 'ready',
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('resolves existing TOML only inside a validated collection', () => {
  const root = createContentWorkspace();
  const source = join(
    root,
    'packages',
    'papers',
    'papers',
    'toml',
    'paper.toml',
  );
  writeFileSync(source, 'title = "Paper"\n');
  const options = { environment: { RTQ_CONTENT_ROOT: root } };

  try {
    assert.equal(
      resolvePaperCollectionRoot('toml', options),
      realpathSync(join(root, 'packages', 'papers', 'papers', 'toml')),
    );
    assert.equal(
      resolvePaperSourcePath('toml', 'paper.toml', options),
      realpathSync(source),
    );
    assert.throws(
      () => resolvePaperSourcePath('toml', '../paper.toml', options),
      /safe repository-relative path/,
    );
    assert.throws(
      () => resolvePaperSourcePath('toml', 'paper.md', options),
      /TOML file/,
    );
    assert.throws(
      () => resolvePaperCollectionRoot('../assets', options),
      /single relative directory name/,
    );
    assert.throws(
      () => resolvePaperCollectionRoot('questionNodeToml', options),
      /Unsupported paper collection/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects a TOML symlink that escapes its validated collection', () => {
  const root = createContentWorkspace();
  const outside = mkdtempSync(join(tmpdir(), 'rtq-review-paper-outside-'));
  const outsideSource = join(outside, 'outside.toml');
  const linkedSource = join(
    root,
    'packages',
    'papers',
    'papers',
    'toml',
    'linked.toml',
  );
  writeFileSync(outsideSource, 'title = "Outside"\n');
  symlinkSync(outsideSource, linkedSource);

  try {
    assert.throws(
      () =>
        resolvePaperSourcePath('toml', 'linked.toml', {
          environment: { RTQ_CONTENT_ROOT: root },
        }),
      /escapes the validated papers root/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
    rmSync(outside, { force: true, recursive: true });
  }
});
