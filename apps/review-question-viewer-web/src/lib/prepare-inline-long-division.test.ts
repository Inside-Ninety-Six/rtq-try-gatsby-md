import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { resolveRtqContentPaths } from '@rtq/review-repository-paths';

import { prepareInlineLongDivisionSvg } from './prepare-inline-long-division.ts';

async function findLongDivisionSvg(root: string): Promise<string | undefined> {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const nestedMatch = await findLongDivisionSvg(entryPath);
      if (nestedMatch) return nestedMatch;
    } else if (entry.name.endsWith('-long.svg')) {
      return entryPath;
    }
  }

  return undefined;
}

test('prepares canonical LongDivision SVG through the maths-assets package command', async () => {
  const { assetsRoot } = resolveRtqContentPaths();
  const repositoryRoot = path.dirname(assetsRoot);
  const generatedRoot = path.join(assetsRoot, 'papers');
  const svgPath = await findLongDivisionSvg(generatedRoot);

  assert.ok(
    svgPath,
    `Expected a generated LongDivision SVG under ${generatedRoot}.`,
  );

  const prepared = prepareInlineLongDivisionSvg(
    repositoryRoot,
    svgPath,
    'review-integration-test',
  );

  assert.equal(typeof prepared.svgMarkup, 'string');
  assert.match(String(prepared.svgMarkup), /^<svg\b/);
  assert.equal(typeof prepared.naturalWidth, 'number');
  assert.equal(typeof prepared.naturalHeight, 'number');
  assert.equal(typeof prepared.minimumReadableWidth, 'number');
});
