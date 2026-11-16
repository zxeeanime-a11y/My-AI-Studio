import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAutoBlurRegions, sanitizeAutoBlurRegions } from './autoBlur';

test('sanitizeAutoBlurRegions clamps detections to the video frame', () => {
  assert.deepEqual(
    sanitizeAutoBlurRegions([
      { x: -20, y: 120, width: 140, height: 950 },
      { x: 900, y: 900, width: 300, height: 300 },
    ]),
    [
      { x: 0, y: 120, width: 120, height: 880 },
      { x: 900, y: 900, width: 100, height: 100 },
    ]
  );
});

test('sanitizeAutoBlurRegions drops malformed and empty detections', () => {
  assert.deepEqual(
    sanitizeAutoBlurRegions([
      null,
      { x: 10, y: 10, width: 0, height: 40 },
      { x: 'bad', y: 10, width: 20, height: 40 },
      { x: null, y: 10, width: 20, height: 40 },
    ]),
    []
  );
});

test('mergeAutoBlurRegions combines repeated detections of the same overlay', () => {
  assert.deepEqual(
    mergeAutoBlurRegions([
      { x: 100, y: 800, width: 300, height: 60 },
      { x: 110, y: 805, width: 290, height: 55 },
      { x: 700, y: 80, width: 150, height: 40 },
    ]),
    [
      { x: 100, y: 800, width: 300, height: 60 },
      { x: 700, y: 80, width: 150, height: 40 },
    ]
  );
});
