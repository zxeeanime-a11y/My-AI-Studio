import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCandidateFrameTimestamps,
  computeFocalCoverCrop,
  getThumbnailDimensions,
  normalizeThumbnailAspectRatio,
  sanitizeThumbnailAnalysisResponse,
  suggestDefaultAspectRatio,
  wrapHeadlineLines,
} from './thumbnailLogic';
import { countCharacters } from './studioLogic';

test('getThumbnailDimensions returns exact platform aspect resolutions', () => {
  assert.deepEqual(getThumbnailDimensions('16:9'), { width: 1280, height: 720 });
  assert.deepEqual(getThumbnailDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(getThumbnailDimensions('1.91:1'), { width: 1200, height: 628 });
  assert.deepEqual(getThumbnailDimensions('1:1'), { width: 1080, height: 1080 });
  assert.equal(normalizeThumbnailAspectRatio('invalid'), '16:9');
});

test('suggestDefaultAspectRatio matches natural orientation of source video', () => {
  assert.equal(suggestDefaultAspectRatio(1920, 1080), '16:9');
  assert.equal(suggestDefaultAspectRatio(1080, 1920), '9:16');
  assert.equal(suggestDefaultAspectRatio(1080, 1080), '1:1');
});

test('computeCandidateFrameTimestamps avoids 0s black frames and video tail', () => {
  const ts = computeCandidateFrameTimestamps(20, 6);
  assert.equal(ts.length, 6);
  assert.ok(ts[0] >= 1.5);
  assert.ok(ts[ts.length - 1] <= 18);
  for (let i = 1; i < ts.length; i++) {
    assert.ok(ts[i] > ts[i - 1]);
  }
});

test('computeFocalCoverCrop centers vertical 9:16 crop on right-side subject focusX', () => {
  // Source is 1920x1080 landscape, subject sits at x=80%
  const crop = computeFocalCoverCrop(1920, 1080, 1080, 1920, 80, 50);
  assert.equal(crop.sHeight, 1080);
  assert.equal(Math.round(crop.sWidth), 608);
  // Ideal left = 0.8 * 1920 - 304 = 1232 (clamped within 1920 - 607.5 = 1312.5)
  assert.ok(crop.sx > 1000 && crop.sx + crop.sWidth <= 1920);
  assert.equal(crop.sy, 0);
});

test('computeFocalCoverCrop centers ultra-wide 1.91:1 crop on upper subject focusY', () => {
  // Source is 1080x1080 square, target is 1200x628, subject sits near y=25%
  const crop = computeFocalCoverCrop(1080, 1080, 1200, 628, 50, 25);
  assert.equal(crop.sWidth, 1080);
  assert.ok(crop.sHeight < 600);
  assert.ok(crop.sy >= 0 && crop.sy < 120);
});

test('sanitizeThumbnailAnalysisResponse validates subject category and avoids covering low subjects', () => {
  const res = sanitizeThumbnailAnalysisResponse(
    {
      bestFrameIndex: 3,
      subjectCategory: 'food',
      subjectSummaryMy: 'ပူပူနွေးနွေး မုန့်ဟင်းခါးပွဲ',
      headlineMy: 'ရန်ကုန်အကောင်းဆုံး မုန့်ဟင်းခါးဆိုင် 🔥',
      focusX: 52,
      focusY: 74, // lower third subject -> text must auto-place at 'top'
      accentTheme: 'gold',
    },
    [1, 3, 5, 7, 9, 11],
    ['/f0.jpg', '/f1.jpg', '/f2.jpg', '/f3.jpg', '/f4.jpg', '/f5.jpg'],
    '9:16',
    'မထင်မှတ်ထားတဲ့အလှည့်',
    true
  );

  assert.equal(res.bestFrameIndex, 3);
  assert.equal(res.frameTimestamp, 7);
  assert.equal(res.subjectCategory, 'food');
  assert.equal(res.textPosition, 'top');
  assert.equal(res.aspectRatio, '9:16');
  assert.ok(countCharacters(res.headlineMy) <= 24);
});

test('wrapHeadlineLines splits long headlines into 2 balanced lines', () => {
  const lines = wrapHeadlineLines('မထင်မှတ်ထားတဲ့ နောက်ဆုံးအလှည့် 🔥', 16);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].length > 0 && lines[1].length > 0);
});
