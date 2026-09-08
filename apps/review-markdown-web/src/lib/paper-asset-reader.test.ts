import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REVIEW_WORKSPACE_ROOT } from '@rtq/review-repository-paths';

import * as paperAssetReader from './paper-asset-reader.ts';

const {
  createPaperAssetResponse,
  resolveConfiguredMathsAssetsRoot,
  resolveCanonicalPaperAsset,
  resolveCanonicalPaperImageExtension,
} = paperAssetReader;

const PAPER_STEM = 'alpha-school--11-plus--maths--2020--paper-1';

test('resolves canonical assets from the review workspace layout', () => {
  assert.equal(
    resolveConfiguredMathsAssetsRoot(),
    path.resolve(
      REVIEW_WORKSPACE_ROOT,
      '../rtq-content/packages/assets/assets',
    ),
  );
});

async function createFixture() {
  const repositoryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'rtq-paper-assets-'),
  );
  const assetsRoot = path.join(repositoryRoot, 'assets');
  const paperRoot = path.join(assetsRoot, 'papers', PAPER_STEM);
  const missingRoot = path.join(assetsRoot, 'papers', 'missing');

  await fs.mkdir(path.join(paperRoot, 'questions'), { recursive: true });
  await fs.mkdir(path.join(paperRoot, 'workings', 'manual'), {
    recursive: true,
  });
  await fs.mkdir(path.join(paperRoot, 'answers', 'manual'), {
    recursive: true,
  });
  await fs.mkdir(missingRoot, { recursive: true });
  await fs.writeFile(
    path.join(repositoryRoot, 'package.json'),
    JSON.stringify({ name: '@rtq/maths-assets' }),
  );
  await fs.writeFile(
    path.join(missingRoot, 'missing_image.svg'),
    '<svg data-missing="true" />',
  );

  return {
    assetsRoot,
    cleanup: () => fs.rm(repositoryRoot, { force: true, recursive: true }),
    paperRoot,
    repositoryRoot,
  };
}

test('serves canonical PaperImage formats without a local public mirror', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const formats = [
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['svg', 'image/svg+xml'],
  ] as const;

  for (const [extension, contentType] of formats) {
    const fileName = `s01-q01-i00.${extension}`;
    await fs.writeFile(
      path.join(fixture.paperRoot, 'questions', fileName),
      `fixture-${extension}`,
    );

    const response = await createPaperAssetResponse(
      `papers/alpha-school/2020/paper-1/questions/${fileName}`,
      { assetsRoot: fixture.assetsRoot },
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), `fixture-${extension}`);
  }
});

test('serves manual working and answer PaperImage assets', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const paths = [
    'workings/manual/s01-q01-w01-i00.png',
    'answers/manual/s01-q01-a01-i00.png',
  ];

  for (const relativePath of paths) {
    await fs.writeFile(
      path.join(fixture.paperRoot, ...relativePath.split('/')),
      relativePath,
    );

    const resolved = await resolveCanonicalPaperAsset(
      `papers/alpha-school/2020/paper-1/${relativePath}`,
      { assetsRoot: fixture.assetsRoot },
    );

    assert.equal(await fs.readFile(resolved, 'utf8'), relativePath);
  }
});

test('uses the canonical missing image for an absent file in a known paper', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const response = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/s01-q99-i00.png',
    { assetsRoot: fixture.assetsRoot },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/svg+xml');
  assert.match(await response.text(), /data-missing/);
});

test('rejects ambiguous shortened paper routes', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  await fs.mkdir(
    path.join(
      fixture.assetsRoot,
      'papers',
      'alpha-school--13-plus--maths--2020--paper-1',
    ),
    { recursive: true },
  );

  const response = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/s01-q01-i00.png',
    { assetsRoot: fixture.assetsRoot },
  );

  assert.equal(response.status, 409);
  assert.match(await response.text(), /Ambiguous canonical paper asset route/);
});

test('rejects multiple physical formats for one canonical PaperImage key', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  await fs.writeFile(
    path.join(fixture.paperRoot, 'questions', 's01-q01-i00.png'),
    'png',
  );
  await fs.writeFile(
    path.join(fixture.paperRoot, 'questions', 's01-q01-i00.svg'),
    '<svg />',
  );

  assert.throws(
    () =>
      resolveCanonicalPaperImageExtension(
        PAPER_STEM,
        'questions/s01-q01-i00',
        fixture.assetsRoot,
      ),
    /Ambiguous PaperImage asset/,
  );
});

test('rejects metadata, generated sources, traversal, and escaping symlinks', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const metadataResponse = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/s01-q01-i00.json',
    { assetsRoot: fixture.assetsRoot },
  );
  assert.equal(metadataResponse.status, 415);

  const generatedResponse = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/workings/generated/long-division/example.svg',
    { assetsRoot: fixture.assetsRoot },
  );
  assert.equal(generatedResponse.status, 404);

  const traversalResponse = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/%2e%2e',
    { assetsRoot: fixture.assetsRoot },
  );
  assert.equal(traversalResponse.status, 400);

  const outsidePath = path.join(fixture.repositoryRoot, 'outside.png');
  const linkedPath = path.join(
    fixture.paperRoot,
    'questions',
    's01-q01-i99.png',
  );
  await fs.writeFile(outsidePath, 'outside');
  await fs.symlink(outsidePath, linkedPath);

  const symlinkResponse = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/s01-q01-i99.png',
    { assetsRoot: fixture.assetsRoot },
  );
  assert.equal(symlinkResponse.status, 403);
});

test('rejects an invalid canonical repository identity', async t => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  await fs.writeFile(
    path.join(fixture.repositoryRoot, 'package.json'),
    JSON.stringify({ name: 'wrong-package' }),
  );

  const response = await createPaperAssetResponse(
    'papers/alpha-school/2020/paper-1/questions/s01-q01-i00.png',
    { assetsRoot: fixture.assetsRoot },
  );

  assert.equal(response.status, 500);
  assert.match(await response.text(), /Expected @rtq\/maths-assets/);
});
