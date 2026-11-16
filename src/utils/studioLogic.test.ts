import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTtsVoicePersonaDirective,
  calculateCreditCost,
  CAPTION_BOTTOM_SAFETY_MARGIN_PCT,
  CAPTION_BOX_MAX_WIDTH_PCT,
  CAPTION_LINE_HEIGHT,
  clampOverlayPosition,
  clampPointerToVideoViewport,
  computeContainedVideoRect,
  computeUploadChunkPlan,
  countCharacters,
  DEFAULT_CAPTION_DECORATION,
  extractMediaDurationSeconds,
  formatTimecode,
  formatVoiceGenderLabelMy,
  formatVoiceSpeedLabel,
  generateAssSubtitles,
  getActiveCaptionAtTime,
  getVoiceSpeedFactor,
  hexToAssColor,
  hexToRgba,
  normalizeVoiceGender,
  normalizeVoiceSpeed,
  parseDurationTagToSeconds,
  sanitizeCaptionDecoration,
  splitLongCaptionsToMaxTwoLines,
  truncateThumbnailTitle,
  UPLOAD_CHUNK_SIZE_BYTES,
  validateUploadFileSize,
  validateVideoDuration,
  validateVideoUrl,
  validateVoiceGenderForTool,
  VOICE_SPEED_STEPS,
  wrapCaptionTextToLines,
  wrapWavHeaderIfNeeded,
} from './studioLogic';

test('validateVideoUrl accepts supported public platforms and rejects unsupported links', () => {
  assert.deepEqual(validateVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
    valid: true,
    platform: 'YouTube',
  });
  assert.deepEqual(validateVideoUrl('https://youtu.be/abc123'), {
    valid: true,
    platform: 'YouTube',
  });
  assert.deepEqual(validateVideoUrl('https://www.tiktok.com/@movie/video/12345'), {
    valid: true,
    platform: 'TikTok',
  });
  assert.deepEqual(validateVideoUrl('https://fb.watch/xyz99/'), {
    valid: true,
    platform: 'Facebook',
  });
  assert.deepEqual(validateVideoUrl('https://www.instagram.com/reel/C9abc/'), {
    valid: true,
    platform: 'Instagram',
  });

  const invalid = validateVideoUrl('https://vimeo.com/12345');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errorMy);

  const empty = validateVideoUrl('   ');
  assert.equal(empty.valid, false);
});

test('validateVideoDuration enforces maximum 120 minutes (7200 seconds)', () => {
  assert.equal(validateVideoDuration(120).valid, true);
  assert.equal(validateVideoDuration(7200).valid, true);
  assert.equal(validateVideoDuration(7201).valid, false);
  assert.equal(validateVideoDuration(0).valid, false);
  assert.equal(validateVideoDuration(-10).valid, false);
});

test('clampOverlayPosition keeps dragged captions and logos within 8%-92% bounds', () => {
  assert.deepEqual(clampOverlayPosition(-5, 110), { x: 8, y: 92 });
  assert.deepEqual(clampOverlayPosition(52.34, 81.26), { x: 52.3, y: 81.3 });
});

test('truncateThumbnailTitle enforces strictly under 25 characters without splitting graphemes', () => {
  const short = 'လူသတ်သမားဘယ်သူလဲ';
  assert.equal(truncateThumbnailTitle(short), short);
  assert.ok(countCharacters(short) < 25);

  const longTitle = 'ဒီဇာတ်ကားရဲ့ နောက်ဆုံးအလှည့်အပြောင်းက အရမ်းကြောက်စရာကောင်းတယ်';
  const truncated = truncateThumbnailTitle(longTitle);
  assert.ok(countCharacters(truncated) < 25);
});

test('calculateCreditCost computes deterministic tool + 4K + long duration pricing', () => {
  assert.equal(calculateCreditCost('recap', false, 600), 10);
  assert.equal(calculateCreditCost('recap', true, 600), 14);
  assert.equal(calculateCreditCost('dubbing', false, 600), 8);
  assert.equal(calculateCreditCost('captions', true, 600), 9);
  assert.equal(calculateCreditCost('recap', false, 2400), 20);
});

test('getVoiceSpeedFactor, normalizeVoiceSpeed, formatVoiceSpeedLabel and VOICE_SPEED_STEPS behave accurately', () => {
  assert.deepEqual([...VOICE_SPEED_STEPS], [1.0, 1.2, 1.4, 1.6, 1.8, 2.0]);
  assert.equal(getVoiceSpeedFactor('slow'), 0.85);
  assert.equal(getVoiceSpeedFactor('normal'), 1.0);
  assert.equal(getVoiceSpeedFactor('fast'), 1.22);
  assert.equal(getVoiceSpeedFactor('2x'), 2.0);
  for (const step of VOICE_SPEED_STEPS) {
    assert.equal(normalizeVoiceSpeed(step), step);
    assert.equal(getVoiceSpeedFactor(step), step);
    assert.equal(formatVoiceSpeedLabel(step), `${step.toFixed(1)}x`);
  }
  assert.equal(normalizeVoiceSpeed(2.5), 2.0);
  assert.equal(normalizeVoiceSpeed(0.4), 1.0);
  assert.equal(formatTimecode(65), '01:05');
  assert.equal(formatTimecode(3665), '01:01:05');
});

test('getActiveCaptionAtTime finds matching segment for timestamp', () => {
  const segments = [
    { id: '1', start: 0, end: 3.5, text: 'အစပိုင်း', emoji: '🎬' },
    { id: '2', start: 3.6, end: 7.0, text: 'အလှည့်အပြောင်း', emoji: '😱' },
  ];
  assert.equal(getActiveCaptionAtTime(segments, 2.0)?.id, '1');
  assert.equal(getActiveCaptionAtTime(segments, 5.2)?.id, '2');
  assert.equal(getActiveCaptionAtTime(segments, 8.0), null);
});

test('wrapWavHeaderIfNeeded adds RIFF header only when missing', () => {
  const rawPcm = new Uint8Array([1, 2, 3, 4]);
  const wrapped = wrapWavHeaderIfNeeded(rawPcm);
  assert.equal(wrapped.length, 48);
  assert.equal(String.fromCharCode(...wrapped.slice(0, 4)), 'RIFF');

  const alreadyWav = wrapWavHeaderIfNeeded(wrapped);
  assert.equal(alreadyWav.length, 48);
});

test('generateAssSubtitles produces positioned ASS dialogue events', () => {
  const ass = generateAssSubtitles(
    [{ id: '1', start: 0.5, end: 3.2, text: 'စုံထောက်ကြီး ရောက်လာပြီ', emoji: '🔥' }],
    1920,
    1080,
    { x: 50, y: 80 }
  );
  assert.ok(ass.includes('PlayResX: 1920'));
  assert.ok(ass.includes('\\pos(960,864)'));
  assert.ok(ass.includes('စုံထောက်ကြီး ရောက်လာပြီ 🔥'));
});

test('computeUploadChunkPlan splits files larger than 4MB into chunked uploads safe for Cloud Run 32MB cap', () => {
  const small = computeUploadChunkPlan(2 * 1024 * 1024);
  assert.equal(small.useChunked, false);
  assert.equal(small.totalChunks, 1);

  const large = computeUploadChunkPlan(45 * 1024 * 1024);
  assert.equal(large.useChunked, true);
  assert.equal(large.chunkSizeBytes, UPLOAD_CHUNK_SIZE_BYTES);
  assert.equal(large.totalChunks, 12);

  assert.equal(validateUploadFileSize(0).valid, false);
  assert.equal(validateUploadFileSize(10 * 1024 * 1024).valid, true);
  assert.equal(validateUploadFileSize(3 * 1024 * 1024 * 1024).valid, false);
});

test('extractMediaDurationSeconds parses format, stream, and HH:MM:SS.ms tag durations accurately', () => {
  assert.equal(parseDurationTagToSeconds('00:01:23.50'), 83.5);
  assert.equal(
    extractMediaDurationSeconds({
      format: { duration: '0' },
      streams: [{ codec_type: 'video', tags: { DURATION: '00:02:10.25' } }],
    }),
    130.25
  );
  assert.equal(
    extractMediaDurationSeconds({
      format: { duration: '15.4' },
      streams: [{ codec_type: 'audio', duration: '15.2' }],
    }),
    15.4
  );
});

test('computeContainedVideoRect preserves portrait 9:16 and ultrawide aspect ratios without stretching', () => {
  // Portrait 1080x1920 video inside a 800x450 landscape stage -> pillarboxed cleanly
  const portrait = computeContainedVideoRect(800, 450, 1080, 1920);
  assert.equal(portrait.height, 450);
  assert.equal(portrait.width, 253); // 450 * (1080 / 1920) = 253.125
  assert.ok(Math.abs(portrait.width / portrait.height - 9 / 16) < 0.01);

  // Square 1080x1080 inside 800x450
  const square = computeContainedVideoRect(800, 450, 1080, 1080);
  assert.equal(square.width, 450);
  assert.equal(square.height, 450);

  // Wide 21:9 (2520x1080) inside 800x450
  const wide = computeContainedVideoRect(800, 450, 2520, 1080);
  assert.equal(wide.width, 800);
  assert.equal(wide.height, 343);
});

test('clampPointerToVideoViewport constrains dragged captions/logos strictly inside rendered video bounds', () => {
  // Rendered portrait video box sits centered at left=273, width=253, height=450
  const videoBox = { left: 273, top: 100, width: 253, height: 450 };

  // Pointer dragged far outside left edge into black pillarbox -> clamped strictly inside video box!
  const leftEdge = clampPointerToVideoViewport({
    clientX: 50,
    clientY: 325,
    rect: videoBox,
    overlayWidthPx: 100,
    overlayHeightPx: 40,
  });
  // halfWPct = (100 / 253) * 50 = 19.76% -> clamped >= 19.8%
  assert.ok(leftEdge.x >= 19.5 && leftEdge.x <= 20.5);
  assert.equal(leftEdge.y, 50);

  // Pointer dragged past bottom edge -> clamped cleanly inside bottom bound
  const bottomEdge = clampPointerToVideoViewport({
    clientX: 400,
    clientY: 999,
    rect: videoBox,
    overlayWidthPx: 100,
    overlayHeightPx: 45,
  });
  assert.ok(bottomEdge.y <= 95.5);
  assert.ok(bottomEdge.y >= 94.0);
});

test('sanitizeCaptionDecoration clamps styling values and hexToAssColor/hexToRgba format accurately', () => {
  const sanitized = sanitizeCaptionDecoration({
    fontSizePreset: 'large',
    fontSizeScale: 2.5,
    textColor: '#facc15',
    borderEnabled: true,
    borderThickness: 18,
    borderColor: '#ef4444',
    blurBgEnabled: true,
    blurIntensity: 40,
    bgOpacity: 150,
    bgCornerRadius: -4,
  });
  assert.equal(sanitized.fontSizeScale, 1.7);
  assert.equal(sanitized.textColor, '#FACC15');
  assert.equal(sanitized.borderThickness, 10);
  assert.equal(sanitized.borderColor, '#EF4444');
  assert.equal(sanitized.blurIntensity, 24);
  assert.equal(sanitized.bgOpacity, 100);
  assert.equal(sanitized.bgCornerRadius, 0);

  assert.equal(hexToRgba('#090B10', 50), 'rgba(9, 11, 16, 0.5)');
  // ASS uses &HAABBGGRR (00=opaque, FF=transparent)
  assert.equal(hexToAssColor('#FF0000', 100), '&H000000FF');
  assert.equal(hexToAssColor('#00FF00', 0), '&HFF00FF00');
});

test('generateAssSubtitles applies custom text color, outline toggle/thickness, and background mask layer', () => {
  const styledAss = generateAssSubtitles(
    [{ id: '1', start: 0.5, end: 3.0, text: 'စာတန်းအလှဆင်', emoji: '✨' }],
    1080,
    1920,
    { x: 50, y: 80 },
    {
      ...DEFAULT_CAPTION_DECORATION,
      fontSizePreset: 'large',
      fontSizeScale: 1.4,
      textColor: '#FACC15',
      borderEnabled: true,
      borderThickness: 6,
      borderColor: '#EF4444',
      blurBgEnabled: false,
    }
  );
  // 1920 * 0.045 * 1.4 = 120.96 -> 121px font size
  assert.ok(styledAss.includes('Style: RecapMain,Noto Sans Myanmar,121,&H0015CCFA,&H003B82F6,&H004444EF'));
  assert.ok(styledAss.includes(',1,6,1,5,'));
  assert.equal(styledAss.includes('Dialogue: 0,'), false); // background mask toggled OFF

  const withMask = generateAssSubtitles(
    [{ id: '1', start: 0.5, end: 3.0, text: 'စာတန်းအလှဆင်', emoji: '✨' }],
    1080,
    1920,
    { x: 50, y: 80 },
    {
      ...DEFAULT_CAPTION_DECORATION,
      borderEnabled: false,
      blurBgEnabled: true,
      bgOpacity: 60,
      bgColor: '#090B10',
    }
  );
  assert.ok(withMask.includes('Dialogue: 0,')); // semi-transparent bg mask enabled
  assert.ok(withMask.includes(',1,0,0,5,')); // border disabled -> outline=0
});

test('Long caption readability: enforces 70%-75% width, comfortable line height, max 2 lines, auto-splits with new timestamps, and respects 8%-10% bottom margin', () => {
  assert.ok(CAPTION_BOX_MAX_WIDTH_PCT >= 70 && CAPTION_BOX_MAX_WIDTH_PCT <= 75);
  assert.ok(CAPTION_LINE_HEIGHT >= 1.4 && CAPTION_LINE_HEIGHT <= 1.6);
  assert.ok(CAPTION_BOTTOM_SAFETY_MARGIN_PCT >= 8 && CAPTION_BOTTOM_SAFETY_MARGIN_PCT <= 10);

  const lines = wrapCaptionTextToLines(
    'Detective walks carefully through the pouring midnight rain toward the abandoned warehouse door looking for hidden evidence',
    22
  );
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    assert.ok(line.length <= 22);
  }

  // Automatic split into separate captions with sequential timestamps when exceeding 2 lines
  const split = splitLongCaptionsToMaxTwoLines(
    [
      {
        id: 'cap_long',
        start: 1.0,
        end: 7.0,
        text: 'မိုးရွာနေတဲ့ညမှာ စုံထောက်ကြီး တစ်ယောက်တည်း တံတားပေါ်ကနေ ဆင်းလာပြီး နောက်ကွယ်က လျှို့ဝှက်ချက်ကြီးကို ဖော်ထုတ်ဖို့ အရမ်းအရေးကြီးတဲ့ သဲလွန်စတစ်ခုကို ရှာဖွေနေခဲ့တယ်',
        emoji: '🌧️',
      },
    ],
    { maxCharsPerLine: 22 }
  );
  assert.ok(split.length >= 2);
  assert.equal(split[0].start, 1.0);
  assert.equal(split[split.length - 1].end, 7.0);
  for (let i = 0; i < split.length; i++) {
    const lineCount = split[i].text.split('\n').length;
    assert.ok(lineCount >= 1 && lineCount <= 2, `Chunk ${i} exceeded 2 lines: ${lineCount}`);
    assert.ok(split[i].end > split[i].start);
    if (i > 0) {
      assert.equal(split[i].start, split[i - 1].end);
    }
  }

  // Bottom safety margin 9% prevents caption box bottom edge from reaching bottom 0%-8%
  const vpBox = { left: 0, top: 0, width: 800, height: 500 };
  const clamped = clampPointerToVideoViewport({
    clientX: 400,
    clientY: 495,
    rect: vpBox,
    overlayWidthPx: 560, // 70% width
    overlayHeightPx: 50, // halfHeight = 5%
    bottomSafetyMarginPct: CAPTION_BOTTOM_SAFETY_MARGIN_PCT, // 9%
    sideSafetyMarginPct: 4,
  });
  // Max center Y = 100 - 5 - 9 = 86% -> bottom edge sits at 86% + 5% = 91% (9% bottom margin!)
  assert.ok(clamped.y <= 86.1, `Expected Y <= 86%, got ${clamped.y}%`);
  assert.equal(clamped.x, 50);

  // ASS subtitles encode 72% box width (14% side margins) and split overly long captions into <=2 lines per Dialogue
  const assOut = generateAssSubtitles(
    [
      {
        id: 'cap_long',
        start: 0.5,
        end: 6.5,
        text: 'One very long sentence that definitely wraps across four separate lines inside a video subtitle box without shrinking',
        emoji: '🎬',
      },
    ],
    1920,
    1080,
    { x: 50, y: 95 }, // pushed toward bottom -> should clamp cleanly above bottom 9% safety zone
    DEFAULT_CAPTION_DECORATION
  );
  // 1920 * 0.14 = 269 margin left/right
  assert.ok(assOut.includes(',5,269,269,97,1'));
  // Multiple Dialogue layer 1 events created cleanly for split caption parts
  const mainDialogues = assOut.split('\n').filter((l) => l.startsWith('Dialogue: 1,'));
  assert.ok(mainDialogues.length >= 2);
});

test('Male/Female AI voice gender selection is required for Movie Recap & Myanmar Dubbing and excluded for Captions Only', () => {
  assert.equal(normalizeVoiceGender('male'), 'male');
  assert.equal(normalizeVoiceGender('FEMALE'), 'female');
  assert.equal(normalizeVoiceGender(''), null);
  assert.equal(normalizeVoiceGender(null), null);

  // Required for recap and dubbing
  assert.equal(validateVoiceGenderForTool('recap', null).valid, false);
  assert.equal(validateVoiceGenderForTool('dubbing', undefined).valid, false);
  assert.deepEqual(validateVoiceGenderForTool('recap', 'male'), { valid: true, gender: 'male' });
  assert.deepEqual(validateVoiceGenderForTool('dubbing', 'female'), { valid: true, gender: 'female' });

  // Not required / excluded for captions-only
  assert.deepEqual(validateVoiceGenderForTool('captions', null), { valid: true, gender: null });

  assert.equal(formatVoiceGenderLabelMy('male'), 'အမျိုးသားအသံ (Male)');
  assert.equal(formatVoiceGenderLabelMy('female'), 'အမျိုးသမီးအသံ (Female)');

  assert.ok(buildTtsVoicePersonaDirective('male', 'street_bro').includes('MALE'));
  assert.ok(buildTtsVoicePersonaDirective('female', 'thriller_narrator').includes('FEMALE'));
});





