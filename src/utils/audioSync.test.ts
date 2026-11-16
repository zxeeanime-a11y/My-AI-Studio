import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMyanmarScriptToTimeline,
  buildAtempoFilterChain,
  buildFullRecapBeats,
  buildOriginalAudioCaptions,
  buildProportionalCaptionsForDuration,
  buildSyncedCaptionsFromSegments,
  buildTimelineFromGroq,
  computeSegmentAwareTimelinePlan,
  computeSegmentSyncPlan,
  computeVideoSpeedSyncPlan,
  getAudioTtsPostFilter,
  normalizeTranscriptSegments,
  parseSilenceDetectOutput,
  scaleWordBudgetForVoiceSpeed,
  splitAudioBoundariesForSegments,
} from './audioSync';

test('buildAtempoFilterChain decomposes extreme stretch/compression ratios into [0.5, 2.0] stages', () => {
  assert.equal(buildAtempoFilterChain(1.0), 'atempo=1.0');
  assert.equal(buildAtempoFilterChain(1.45), 'atempo=1.4500');
  assert.equal(buildAtempoFilterChain(2.8), 'atempo=2.0000,atempo=1.4000');
  assert.equal(buildAtempoFilterChain(0.35), 'atempo=0.5000,atempo=0.7000');

  // Verify every stage stays within FFmpeg legal bounds [0.5, 2.0]
  for (const ratio of [0.25, 0.4, 0.75, 1.5, 2.6, 3.8]) {
    const chain = buildAtempoFilterChain(ratio);
    const values = chain.split(',').map((part) => Number(part.replace('atempo=', '')));
    for (const v of values) {
      assert.ok(v >= 0.5 && v <= 2.0, `Stage ${v} out of [0.5, 2.0] for ratio ${ratio}`);
    }
  }
});

test('normalizeTranscriptSegments prevents overlaps and assigns proportional Myanmar word budgets', () => {
  const normalized = normalizeTranscriptSegments(
    [
      { start: 0.0, end: 4.5, text: 'First line' },
      { start: 3.8, end: 8.2, text: 'Second overlapping line' },
      { start: 8.5, end: 14.0, text: 'Third beyond duration' },
    ],
    12.0
  );

  assert.equal(normalized.length, 3);
  assert.ok(normalized[0].end <= normalized[1].start);
  assert.ok(normalized[1].end <= normalized[2].start);
  assert.ok(normalized[2].end <= 12.0);
  assert.ok(normalized[0].maxMyanmarWords >= 4);
});

test('computeSegmentSyncPlan compresses long TTS audio to fit exactly inside original segment window', () => {
  // Original segment is 3.0s (from 2.0s to 5.0s), raw TTS came out as 4.5s
  const plan = computeSegmentSyncPlan(2.0, 5.0, 4.5, 'normal');
  assert.equal(plan.targetDuration, 3.0);
  assert.equal(plan.delayMs, 2000);
  assert.equal(plan.tempoRatio, 1.5);
  assert.equal(plan.atempoFilter, 'atempo=1.5000');
  assert.ok(plan.end <= 5.0);
});

test('computeSegmentSyncPlan stretches short TTS audio cleanly and never overflows boundary even in slow mode', () => {
  // Original segment is 4.0s, raw TTS came out as 2.0s
  const plan = computeSegmentSyncPlan(1.0, 5.0, 2.0, 'slow');
  assert.equal(plan.targetDuration, 4.0);
  assert.equal(plan.tempoRatio, 0.5);
  assert.equal(plan.atempoFilter, 'atempo=0.5000');
  assert.ok(plan.end <= 5.0);
});

test('buildSyncedCaptionsFromSegments outputs captions locked to synced segment timestamps', () => {
  const captions = buildSyncedCaptionsFromSegments([
    { id: 'c1', start: 0.5, end: 3.2, text: 'စုံထောက်ကြီး ရောက်လာပြီ', emoji: '🌧️' },
    { id: 'c2', start: 3.5, end: 7.4, text: 'တကယ်မထင်မှတ်ထားဘူး', emoji: '😱' },
  ]);
  assert.equal(captions.length, 2);
  assert.equal(captions[0].start, 0.5);
  assert.equal(captions[0].end, 3.2);
  assert.equal(captions[1].emoji, '😱');
});

test('parseSilenceDetectOutput extracts FFmpeg silence pauses accurately', () => {
  const sampleStderr = `
[silencedetect @ 0x5654080bc600] silence_start: 2.85
[silencedetect @ 0x5654080bc600] silence_end: 3.35 | silence_duration: 0.50
[silencedetect @ 0x5654080bc600] silence_start: 6.40
[silencedetect @ 0x5654080bc600] silence_end: 6.90 | silence_duration: 0.50
`;
  const silences = parseSilenceDetectOutput(sampleStderr);
  assert.equal(silences.length, 2);
  assert.equal(silences[0].start, 2.85);
  assert.equal(silences[0].end, 3.35);
  assert.equal(silences[1].midpoint, 6.65);
});

test('splitAudioBoundariesForSegments snaps single TTS WAV cleanly to detected pauses and falls back monotonically', () => {
  const segments = [
    { text: 'မိုးရွာနေတဲ့ညမှာ စုံထောက်ကြီး စောင့်နေတယ်' },
    { text: 'သူ့နောက်ကွယ်က လျှို့ဝှက်ချက်က ကြောက်စရာကောင်းတယ်' },
    { text: 'နောက်ဆုံး တရားခံဘယ်သူလဲ ကြည့်လိုက်ကြရအောင်' },
  ];

  const silences = [
    { start: 2.8, end: 3.3, duration: 0.5, midpoint: 3.05 },
    { start: 6.2, end: 6.7, duration: 0.5, midpoint: 6.45 },
  ];

  const slices = splitAudioBoundariesForSegments(segments, 10.0, silences);
  assert.equal(slices.length, 3);
  assert.equal(slices[0].audioStart, 0);
  assert.ok(slices[0].audioEnd <= 2.9);
  assert.ok(slices[1].audioStart >= 3.2 && slices[1].audioEnd <= 6.3);
  assert.ok(slices[2].audioStart >= 6.6 && slices[2].audioEnd === 10.0);

  // Fallback when no silences detected: monotonic proportional split
  const noSilenceSlices = splitAudioBoundariesForSegments(segments, 10.0, []);
  assert.equal(noSilenceSlices.length, 3);
  assert.equal(noSilenceSlices[0].audioStart, 0);
  assert.ok(noSilenceSlices[0].audioEnd < noSilenceSlices[1].audioEnd);
  assert.equal(noSilenceSlices[2].audioEnd, 10.0);
});

test('computeVideoSpeedSyncPlan adjusts video setpts factor to follow untouched AI voice duration', () => {
  // Slow AI voice (18s) on 12s video -> video slows down (setpts = 1.5, rate = 0.67x)
  const slowPlan = computeVideoSpeedSyncPlan(12.0, 18.0);
  assert.equal(slowPlan.setptsFactor, 1.5);
  assert.equal(slowPlan.videoPlaybackRate, 0.67);
  assert.equal(slowPlan.aiVoiceDuration, 18.0);

  // Fast AI voice (8s) on 12s video -> video speeds up (setpts = 0.666667, rate = 1.5x)
  const fastPlan = computeVideoSpeedSyncPlan(12.0, 8.0);
  assert.equal(fastPlan.setptsFactor, 0.666667);
  assert.equal(fastPlan.videoPlaybackRate, 1.5);
  assert.equal(fastPlan.aiVoiceDuration, 8.0);
});

test('buildTimelineFromGroq splits video into contiguous speaking and silence segments without altering silence', () => {
  const timeline = buildTimelineFromGroq(
    [
      { start: 1.0, end: 4.0, text: 'First dialogue line.' },
      { start: 4.1, end: 5.5, text: '[Music]', no_speech_prob: 0.92 },
      { start: 6.5, end: 9.5, text: 'Final twist dialogue.' },
    ],
    [],
    12.0
  );

  // Expect: 0-1 (silence), 1-4 (speaking), 4-6.5 (silence), 6.5-9.5 (speaking), 9.5-12 (silence)
  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].kind, 'silence');
  assert.equal(timeline[0].start, 0);
  assert.equal(timeline[0].end, 1.0);

  assert.equal(timeline[1].kind, 'speaking');
  assert.equal(timeline[1].start, 1.0);
  assert.equal(timeline[1].end, 4.0);
  assert.equal(timeline[1].text, 'First dialogue line.');

  assert.equal(timeline[2].kind, 'silence');
  assert.equal(timeline[2].start, 4.0);
  assert.equal(timeline[2].end, 6.5);

  assert.equal(timeline[3].kind, 'speaking');
  assert.equal(timeline[3].start, 6.5);
  assert.equal(timeline[3].end, 9.5);

  assert.equal(timeline[4].kind, 'silence');
  assert.equal(timeline[4].start, 9.5);
  assert.equal(timeline[4].end, 12.0);
});

test('buildTimelineFromGroq splits long speaking segments when word-level pauses exist', () => {
  const timeline = buildTimelineFromGroq(
    [{ start: 0.5, end: 7.5, text: 'Wait here. Look behind you.' }],
    [
      { word: 'Wait', start: 0.5, end: 0.9 },
      { word: 'here.', start: 1.0, end: 1.5 },
      // 2.0s pause from 1.5s to 3.5s
      { word: 'Look', start: 3.5, end: 4.0 },
      { word: 'behind', start: 4.1, end: 4.6 },
      { word: 'you.', start: 4.7, end: 5.2 },
    ],
    6.0
  );

  assert.deepEqual(
    timeline.map((s) => ({ kind: s.kind, start: s.start, end: s.end })),
    [
      { kind: 'silence', start: 0, end: 0.5 },
      { kind: 'speaking', start: 0.5, end: 1.5 },
      { kind: 'silence', start: 1.5, end: 3.5 },
      { kind: 'speaking', start: 3.5, end: 5.2 },
      { kind: 'silence', start: 5.2, end: 6.0 },
    ]
  );
});

test('applyMyanmarScriptToTimeline populates speaking segments only and keeps silence empty', () => {
  const timeline = buildTimelineFromGroq(
    [
      { start: 1.0, end: 3.0, text: 'Hello' },
      { start: 5.0, end: 7.0, text: 'Run now' },
    ],
    [],
    8.0
  );

  const mapped = applyMyanmarScriptToTimeline(timeline, [
    { id: timeline[1].id, myanmarText: 'မင်္ဂလာပါကွာ', emoji: '👋' },
    { id: timeline[3].id, myanmarText: 'အခုပြေးကြစို့', emoji: '🏃' },
  ]);

  assert.equal(mapped[0].myanmarText, '');
  assert.equal(mapped[0].emoji, '');
  assert.equal(mapped[1].myanmarText, 'မင်္ဂလာပါကွာ');
  assert.equal(mapped[2].myanmarText, '');
  assert.equal(mapped[3].myanmarText, 'အခုပြေးကြစို့');
  assert.equal(mapped[4].myanmarText, '');
});

test('computeSegmentAwareTimelinePlan adjusts ONLY speaking segment speed and keeps all silence at 1.0x', () => {
  const base = buildTimelineFromGroq(
    [
      { start: 1.0, end: 3.0, text: 'First' },
      { start: 5.0, end: 7.0, text: 'Second' },
    ],
    [],
    9.0
  );
  const scripted = applyMyanmarScriptToTimeline(base, [
    { id: base[1].id, myanmarText: 'ပထမအပိုင်းစကား', emoji: '🔥' },
    { id: base[3].id, myanmarText: 'ဒုတိယအပိုင်းစကား', emoji: '😱' },
  ]);

  // Speaking 1 (orig 2.0s) gets 3.0s AI voice -> video slows to 0.67x (setpts = 1.5)
  // Speaking 2 (orig 2.0s) gets 1.5s AI voice -> video speeds up to 1.33x (setpts = 0.75)
  // Silence 0 (1.0s), Silence 2 (2.0s), Silence 4 (2.0s) MUST stay at 1.0x original speed!
  const plan = computeSegmentAwareTimelinePlan(scripted, {
    [base[1].id]: 3.0,
    [base[3].id]: 1.5,
  });

  // Silence segments untouched
  assert.equal(plan.segments[0].setptsFactor, 1.0);
  assert.equal(plan.segments[0].videoPlaybackRate, 1.0);
  assert.equal(plan.segments[0].outputStart, 0);
  assert.equal(plan.segments[0].outputEnd, 1.0);

  // Speaking 1 slowed down to match 3.0s voice
  assert.equal(plan.segments[1].setptsFactor, 1.5);
  assert.equal(plan.segments[1].videoPlaybackRate, 0.67);
  assert.equal(plan.segments[1].outputStart, 1.0);
  assert.equal(plan.segments[1].outputEnd, 4.0);

  // Silence 2 untouched (2.0s at 1.0x)
  assert.equal(plan.segments[2].setptsFactor, 1.0);
  assert.equal(plan.segments[2].videoPlaybackRate, 1.0);
  assert.equal(plan.segments[2].outputStart, 4.0);
  assert.equal(plan.segments[2].outputEnd, 6.0);

  // Speaking 2 sped up to match 1.5s voice
  assert.equal(plan.segments[3].setptsFactor, 0.75);
  assert.equal(plan.segments[3].videoPlaybackRate, 1.33);
  assert.equal(plan.segments[3].outputStart, 6.0);
  assert.equal(plan.segments[3].outputEnd, 7.5);

  // Silence 4 untouched (2.0s at 1.0x)
  assert.equal(plan.segments[4].setptsFactor, 1.0);
  assert.equal(plan.segments[4].videoPlaybackRate, 1.0);
  assert.equal(plan.segments[4].outputStart, 7.5);
  assert.equal(plan.segments[4].outputEnd, 9.5);

  // Totals & captions strictly for speaking intervals
  assert.equal(plan.speakingSegmentCount, 2);
  assert.equal(plan.silenceSegmentCount, 3);
  assert.equal(plan.totalPreservedSilenceDuration, 5.0);
  assert.equal(plan.totalAiVoiceDuration, 4.5);
  assert.equal(plan.totalFinalDuration, 9.5);
  assert.equal(plan.syncedCaptions.length, 2);
  assert.equal(plan.syncedCaptions[0].start, 1.0);
  assert.equal(plan.syncedCaptions[0].end, 4.0);
  assert.equal(plan.syncedCaptions[1].start, 6.0);
  assert.equal(plan.syncedCaptions[1].end, 7.5);
});

test('Slow vs Fast voice speeds adjust ONLY speaking segment speed while silence remains strictly 1.0x', () => {
  const base = buildTimelineFromGroq(
    [
      { start: 0.6, end: 2.6, text: 'Wait here.' },
      { start: 3.0, end: 4.5, text: 'you', no_speech_prob: 0.62, avg_logprob: -1.4 },
      { start: 5.0, end: 7.0, text: 'Run fast!' },
    ],
    [],
    8.0
  );

  // Silence segments: 0-0.6, 2.6-5.0 (hallucinated ghost 'you' merged into silence), 7.0-8.0
  assert.deepEqual(
    base.map((s) => ({ kind: s.kind, start: s.start, end: s.end })),
    [
      { kind: 'silence', start: 0, end: 0.6 },
      { kind: 'speaking', start: 0.6, end: 2.6 },
      { kind: 'silence', start: 2.6, end: 5.0 },
      { kind: 'speaking', start: 5.0, end: 7.0 },
      { kind: 'silence', start: 7.0, end: 8.0 },
    ]
  );

  // When user picks SLOW -> longer AI voices (3.2s and 3.6s) -> speaking segments slow down; silence stays 1.0x
  const slowPlan = computeSegmentAwareTimelinePlan(base, {
    [base[1].id]: 3.2,
    [base[3].id]: 3.6,
  });
  assert.equal(slowPlan.segments[0].videoPlaybackRate, 1.0);
  assert.equal(slowPlan.segments[2].videoPlaybackRate, 1.0);
  assert.equal(slowPlan.segments[4].videoPlaybackRate, 1.0);
  assert.ok(slowPlan.segments[1].videoPlaybackRate < 1.0);
  assert.ok(slowPlan.segments[3].videoPlaybackRate < 1.0);
  assert.equal(slowPlan.totalPreservedSilenceDuration, 4.0);

  // When user picks FAST -> shorter AI voices (1.2s and 1.0s) -> speaking segments speed up; silence STILL stays 1.0x
  const fastPlan = computeSegmentAwareTimelinePlan(base, {
    [base[1].id]: 1.2,
    [base[3].id]: 1.0,
  });
  assert.equal(fastPlan.segments[0].videoPlaybackRate, 1.0);
  assert.equal(fastPlan.segments[2].videoPlaybackRate, 1.0);
  assert.equal(fastPlan.segments[4].videoPlaybackRate, 1.0);
  assert.ok(fastPlan.segments[1].videoPlaybackRate > 1.0);
  assert.ok(fastPlan.segments[3].videoPlaybackRate > 1.0);
  assert.equal(fastPlan.totalPreservedSilenceDuration, 4.0);
});

test('scaleWordBudgetForVoiceSpeed scales word budgets by Fast/Normal/Slow and speaking segments never default to 1.0x under Fast/Slow', () => {
  const baseWords = 10;
  const fastWords = scaleWordBudgetForVoiceSpeed(baseWords, 'fast');
  const normalWords = scaleWordBudgetForVoiceSpeed(baseWords, 'normal');
  const slowWords = scaleWordBudgetForVoiceSpeed(baseWords, 'slow');

  assert.ok(fastWords < normalWords);
  assert.ok(slowWords > normalWords);

  const timeline = buildTimelineFromGroq(
    [{ start: 1.0, end: 3.0, text: 'Dialogue line' }],
    [],
    4.0
  );
  // Even before raw audio duration overrides, Fast/Slow never default speaking parts to 1.0x, while silence stays 1.0x
  const fastFallback = computeSegmentAwareTimelinePlan(timeline, {}, 'fast');
  assert.equal(fastFallback.segments[0].videoPlaybackRate, 1.0);
  assert.ok(fastFallback.segments[1].videoPlaybackRate > 1.2);
  assert.equal(fastFallback.segments[2].videoPlaybackRate, 1.0);

  const slowFallback = computeSegmentAwareTimelinePlan(timeline, {}, 'slow');
  assert.equal(slowFallback.segments[0].videoPlaybackRate, 1.0);
  assert.ok(slowFallback.segments[1].videoPlaybackRate < 0.85);
  assert.equal(slowFallback.segments[2].videoPlaybackRate, 1.0);
});

test('Tool 1 (Movie Recap): buildFullRecapBeats covers entire video duration continuously and proportional captions span full AI voice', () => {
  const beats = buildFullRecapBeats(
    [{ start: 1.0, end: 3.0, text: 'Detective walks on bridge' }],
    12.0,
    'fast'
  );
  assert.equal(beats[0].start, 0);
  assert.equal(beats[beats.length - 1].end, 12.0);
  assert.equal(beats.length, 3);

  // Captions scale proportionally to total full-recap AI voice duration (e.g. 9.0s)
  const caps = buildProportionalCaptionsForDuration(
    [
      { id: 'cap_1', text: 'တံတားပေါ် စုံထောက်ရောက်လာပြီ', emoji: '🎬' },
      { id: 'cap_2', text: 'နောက်ကွယ်က လူဆိုးက စောင့်ကြည့်နေတယ်', emoji: '😱' },
      { id: 'cap_3', text: 'အမှန်တရားကြီး ပေါ်သွားပြီဟေ့', emoji: '🔥' },
    ],
    9.0
  );
  assert.equal(caps.length, 3);
  assert.equal(caps[0].start, 0);
  assert.equal(caps[2].end, 9.0);
  assert.ok(caps[0].end > 0 && caps[0].end === caps[1].start);
  assert.ok(caps[1].end === caps[2].start);
});

test('Tool 3 (Captions Only): preserves exact original speaking timestamps with no speed scaling', () => {
  const caps = buildOriginalAudioCaptions([
    { id: 'c1', start: 0.8, end: 3.6, text: 'မူရင်းအသံအတိုင်း စာတန်းထိုး', emoji: '💬' },
    { id: 'c2', start: 5.2, end: 8.2, text: 'အမြန်နှုန်း မပြောင်းလဲပါ', emoji: '✨' },
  ]);
  assert.equal(caps.length, 2);
  assert.equal(caps[0].start, 0.8);
  assert.equal(caps[0].end, 3.6);
  assert.equal(caps[1].start, 5.2);
  assert.equal(caps[1].end, 8.2);
});

test('2x Voice Speed: applies atempo=2.0 to AI voice, scales Movie Recap whole video up to 2x, and keeps Dubbing silence strictly at 1.0x', () => {
  assert.equal(getAudioTtsPostFilter('slow'), null);
  assert.equal(getAudioTtsPostFilter('normal'), null);
  assert.equal(getAudioTtsPostFilter('fast'), null);
  assert.equal(getAudioTtsPostFilter('2x'), 'atempo=2.0');

  // 1. Movie Recap: 12s original video paired with 6s 2x AI voice -> entire video plays at 2.0x (setpts=0.5)
  const recap2xPlan = computeVideoSpeedSyncPlan(12.0, 6.0);
  assert.equal(recap2xPlan.setptsFactor, 0.5);
  assert.equal(recap2xPlan.videoPlaybackRate, 2.0);

  // 2. Myanmar Dubbing: Speaking segment 2.0s -> 1.0s 2x AI voice -> speaking runs at 2.0x; silence remains strictly 1.0x!
  const baseTimeline = buildTimelineFromGroq(
    [
      { start: 1.0, end: 3.0, text: 'First speaking scene' },
      { start: 6.0, end: 8.0, text: 'Second speaking scene' },
    ],
    [],
    10.0
  );
  const scripted = applyMyanmarScriptToTimeline(baseTimeline, [
    { id: baseTimeline[1].id, myanmarText: 'ပထမအပိုင်း', emoji: '🔥' },
    { id: baseTimeline[3].id, myanmarText: 'ဒုတိယအပိုင်း', emoji: '⚡' },
  ]);

  const dubbing2xPlan = computeSegmentAwareTimelinePlan(
    scripted,
    {
      [baseTimeline[1].id]: 1.0,
      [baseTimeline[3].id]: 1.0,
    },
    '2x'
  );
  // Silence segments 0, 2, 4 MUST remain strictly 1.0x
  assert.equal(dubbing2xPlan.segments[0].videoPlaybackRate, 1.0);
  assert.equal(dubbing2xPlan.segments[0].setptsFactor, 1.0);
  assert.equal(dubbing2xPlan.segments[2].videoPlaybackRate, 1.0);
  assert.equal(dubbing2xPlan.segments[2].setptsFactor, 1.0);
  assert.equal(dubbing2xPlan.segments[4].videoPlaybackRate, 1.0);
  assert.equal(dubbing2xPlan.segments[4].setptsFactor, 1.0);
  // Speaking segments 1 & 3 MUST follow 2x AI voice duration -> 2.0x playback speed (setpts=0.5)
  assert.equal(dubbing2xPlan.segments[1].videoPlaybackRate, 2.0);
  assert.equal(dubbing2xPlan.segments[1].setptsFactor, 0.5);
  assert.equal(dubbing2xPlan.segments[3].videoPlaybackRate, 2.0);
  assert.equal(dubbing2xPlan.segments[3].setptsFactor, 0.5);

  // Fallback check before audio durations: 2x speaking defaults to 2.0x while silence stays 1.0x
  const fallback2x = computeSegmentAwareTimelinePlan(scripted, {}, '2x');
  assert.equal(fallback2x.segments[0].videoPlaybackRate, 1.0);
  assert.equal(fallback2x.segments[1].videoPlaybackRate, 2.0);
  assert.equal(fallback2x.segments[2].videoPlaybackRate, 1.0);
});

test('Continuous voice speed steps 1.0x..2.0x apply atempo only above 1.0x, scale Recap whole video, and keep Dubbing silence strictly 1.0x', () => {
  assert.equal(getAudioTtsPostFilter(1.0), null);
  assert.equal(getAudioTtsPostFilter(1.2), 'atempo=1.20');
  assert.equal(getAudioTtsPostFilter(1.4), 'atempo=1.40');
  assert.equal(getAudioTtsPostFilter(1.6), 'atempo=1.60');
  assert.equal(getAudioTtsPostFilter(1.8), 'atempo=1.80');
  assert.equal(getAudioTtsPostFilter(2.0), 'atempo=2.0');

  // Movie Recap at 1.6x: 16s original video with 10s AI voice -> full video speeds up to 1.6x
  const recap16x = computeVideoSpeedSyncPlan(16.0, 10.0);
  assert.equal(recap16x.videoPlaybackRate, 1.6);
  assert.equal(recap16x.setptsFactor, 0.625);

  // Myanmar Dubbing at 1.4x & 1.8x: speaking follows voice speed, silence stays strictly 1.0x
  const timeline = buildTimelineFromGroq(
    [
      { start: 1.0, end: 3.8, text: 'First speaking window' },
      { start: 6.0, end: 9.6, text: 'Second speaking window' },
    ],
    [],
    11.0
  );
  const scripted = applyMyanmarScriptToTimeline(timeline, [
    { id: timeline[1].id, myanmarText: 'ပထမအပိုင်း', emoji: '🎬' },
    { id: timeline[3].id, myanmarText: 'ဒုတိယအပိုင်း', emoji: '🔥' },
  ]);

  const dubbing14x = computeSegmentAwareTimelinePlan(
    scripted,
    {
      [timeline[1].id]: 2.0, // 2.8s / 2.0s = 1.4x
      [timeline[3].id]: 2.571, // ~1.4x
    },
    1.4
  );
  assert.equal(dubbing14x.segments[0].videoPlaybackRate, 1.0);
  assert.equal(dubbing14x.segments[2].videoPlaybackRate, 1.0);
  assert.equal(dubbing14x.segments[4].videoPlaybackRate, 1.0);
  assert.equal(dubbing14x.segments[1].videoPlaybackRate, 1.4);
  assert.equal(dubbing14x.segments[3].videoPlaybackRate, 1.4);

  const fallback18x = computeSegmentAwareTimelinePlan(scripted, {}, 1.8);
  assert.equal(fallback18x.segments[0].videoPlaybackRate, 1.0);
  assert.equal(fallback18x.segments[1].videoPlaybackRate, 1.8);
  assert.equal(fallback18x.segments[2].videoPlaybackRate, 1.0);
  assert.equal(fallback18x.segments[3].videoPlaybackRate, 1.8);
  assert.equal(fallback18x.segments[4].videoPlaybackRate, 1.0);
});



