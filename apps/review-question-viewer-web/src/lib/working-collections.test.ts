import assert from 'node:assert/strict';
import test from 'node:test';

import * as workingCollections from './working-collections.ts';

const {
  hydrateWorkingCollection,
  rawWorkingFromEntry,
  visibleWorkingCollectionValues,
} = workingCollections;

test('maps ordered formula and tip child records without flattening raw data', () => {
  const working = rawWorkingFromEntry({
    formulas: [{ formula: '$x^2$' }, { formula: 'rtq_abbr_formula_example' }],
    tips: [{ tip: 'Prose tip' }, { tip: '**Markdown tip**' }],
    working: 'Calculate the result.',
  });

  assert.deepEqual(working, {
    formulas: [{ formula: '$x^2$' }, { formula: 'rtq_abbr_formula_example' }],
    tips: [{ tip: 'Prose tip' }, { tip: '**Markdown tip**' }],
    working: 'Calculate the result.',
  });
});

test('retains raw placeholders but excludes them from visible values', () => {
  const working = rawWorkingFromEntry({
    formulas: [{ formula: '%empty%' }],
    tips: [{ tip: '%empty%' }],
    working: 'Nested work',
  });

  assert.deepEqual(working.formulas, [{ formula: '%empty%' }]);
  assert.deepEqual(working.tips, [{ tip: '%empty%' }]);
  assert.deepEqual(
    visibleWorkingCollectionValues(working.formulas, 'formula'),
    [],
  );
  assert.deepEqual(visibleWorkingCollectionValues(working.tips, 'tip'), []);
});

test('hydrates each visible child independently and in source order', async () => {
  const working = rawWorkingFromEntry({
    formulas: [
      { formula: 'first' },
      { formula: 'alternate_rtq_abbr' },
      { formula: '%empty%' },
    ],
    tips: [],
    working: 'Top-level or nested working',
  });

  assert.deepEqual(
    await hydrateWorkingCollection(working.formulas, 'formula', async value =>
      value.toUpperCase(),
    ),
    ['FIRST', 'ALTERNATE_RTQ_ABBR'],
  );
});
