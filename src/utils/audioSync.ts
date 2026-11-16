import type {
  CaptionSegment,
  TranscriptSegment,
  VideoTimelineSegment,
  VoiceSpeed,
} from '../types/studio';

export interface NormalizedSegment extends TranscriptSegment {
  duration: number;
  maxMyanmarWords: number;
}

export interface SegmentSyncPlan {
  start: number;
  end: number;
  targetDuration: number;
  rawDuration: number;
  tempoRatio: number;
  atempoFilter: string;
  delayMs: number;
}

/**
 * Builds an FFmpeg-safe atempo filter chain where every stage lies within [0.5, 2.0].
 * Supports arbitrary stretch/compression ratios (e.g., 0.25x to 4.0x+).
 */
export function buildAtempoFilterChain(rawRatio: number): string {
  const safeRatio = Math.min(4.0, Math.max(0.25, Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 1.0));
  if (Math.abs(safeRatio - 1.0) < 0.015) {
    return 'atempo=1.0';
  }

  const stages: number[] = [];
  let remaining = safeRatio;

  while (remaining > 2.0) {
    stages.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    stages.push(0.5);
    remaining /= 0.5;
  }
  stages.push(Number(remaining.toFixed(4)));

  return stages.map((s) => `atempo=${s.toFixed(4)}`).join(',');
}

export function resolveVoiceSpeedNumeric(speed: VoiceSpeed = 1.0): number {
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    return Math.round(Math.min(2.0, Math.max(0.5, speed)) * 100) / 100;
  }
  if (speed === 'slow') return 0.85;
  if (speed === 'fast') return 1.22;
  if (speed === '2x') return 2.0;
  if (speed === 'normal') return 1.0;
  const parsed = Number(String(speed || '').replace(/x$/i, ''));
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(Math.min(2.0, Math.max(0.5, parsed)) * 100) / 100;
  }
  return 1.0;
}

/**
 * Returns optional FFmpeg WSOLA pitch-preserving atempo filter applied directly to generated
 * Gemini AI voice audio (supports 1.0x, 1.2x, 1.4x, 1.6x, 1.8x, 2.0x continuously).
 */
export function getAudioTtsPostFilter(speed: VoiceSpeed = 1.0): string | null {
  const factor = resolveVoiceSpeedNumeric(speed);
  if (typeof speed === 'string' && (speed === 'slow' || speed === 'normal' || speed === 'fast')) {
    return null;
  }
  if (Math.abs(factor - 1.0) < 0.02) {
    return null;
  }
  if (Math.abs(factor - 2.0) < 0.01) {
    return 'atempo=2.0';
  }
  return `atempo=${factor.toFixed(2)}`;
}

/**
 * Normalizes Groq Whisper segments so boundaries are non-overlapping, clamped to [0, totalDuration],
 * and assigned a proportional Myanmar word budget so Gemini scripts fit the time window.
 */
export function normalizeTranscriptSegments(
  rawSegments: Array<{ start: number; end: number; text: string }>,
  totalDuration: number
): NormalizedSegment[] {
  const safeTotal = Math.max(1, Number.isFinite(totalDuration) ? totalDuration : 12);
  const filtered = rawSegments
    .filter((s) => String(s.text || '').trim().length > 0)
    .sort((a, b) => Number(a.start) - Number(b.start));

  if (filtered.length === 0) {
    const dur = safeTotal;
    return [
      {
        id: 'seg_1',
        start: 0,
        end: Number(dur.toFixed(2)),
        text: 'Visual scene sequence',
        duration: Number(dur.toFixed(2)),
        maxMyanmarWords: Math.max(4, Math.round(dur * 2.4)),
      },
    ];
  }

  const result: NormalizedSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < filtered.length; i++) {
    const raw = filtered[i];
    const nextStart = i + 1 < filtered.length ? Number(filtered[i + 1].start) : safeTotal;
    const start = Math.max(cursor, Math.min(safeTotal - 0.3, Number(raw.start || 0)));
    const rawEnd = Math.max(start + 0.35, Number(raw.end || start + 2));
    const end = Math.min(safeTotal, Math.max(start + 0.35, Math.min(rawEnd, nextStart > start + 0.35 ? nextStart : rawEnd)));
    const duration = Math.max(0.35, end - start);
    cursor = end;

    result.push({
      id: `seg_${i + 1}`,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text: String(raw.text).trim(),
      duration: Number(duration.toFixed(2)),
      maxMyanmarWords: Math.max(3, Math.round(duration * 2.4)),
    });
  }

  return result;
}

/**
 * Computes exact time-stretch/compression parameters to match raw Gemini TTS audio
 * to the original video segment's [start, end] time window.
 */
export function computeSegmentSyncPlan(
  segmentStart: number,
  segmentEnd: number,
  rawTtsDuration: number,
  userSpeed: VoiceSpeed = 'normal'
): SegmentSyncPlan {
  const start = Math.max(0, segmentStart);
  const targetDuration = Math.max(0.35, segmentEnd - start);
  const raw = Math.max(0.2, rawTtsDuration);

  // Base ratio aligns raw TTS duration strictly to the video window duration.
  // Subtle speed preference bias (+/-8%) only if it doesn't exceed the segment window.
  let ratio = raw / targetDuration;
  if (userSpeed === 'fast' && ratio < 1.0) {
    ratio = Math.min(1.12, ratio * 1.08);
  } else if (userSpeed === 'slow' && ratio > 1.05) {
    ratio = Math.max(1.0, ratio * 0.96);
  }

  // Never let synced audio overflow past the segment boundary:
  // If raw / ratio > targetDuration, force ratio >= raw / targetDuration.
  const minRatioToFit = raw / targetDuration;
  if (ratio < minRatioToFit) {
    ratio = minRatioToFit;
  }

  const clampedRatio = Math.min(4.0, Math.max(0.25, ratio));

  return {
    start: Number(start.toFixed(2)),
    end: Number((start + Math.min(targetDuration, raw / clampedRatio)).toFixed(2)),
    targetDuration: Number(targetDuration.toFixed(2)),
    rawDuration: Number(raw.toFixed(2)),
    tempoRatio: Number(clampedRatio.toFixed(4)),
    atempoFilter: buildAtempoFilterChain(clampedRatio),
    delayMs: Math.round(start * 1000),
  };
}

/**
 * Produces dynamic captions whose start/end timestamps match the synced audio segments exactly.
 */
export function buildSyncedCaptionsFromSegments(
  segments: Array<{ id?: string; start: number; end: number; text: string; emoji?: string }>
): CaptionSegment[] {
  return segments
    .filter((s) => String(s.text || '').trim().length > 0)
    .map((s, idx) => ({
      id: s.id || `cap_${idx + 1}`,
      start: Number(Math.max(0, s.start).toFixed(2)),
      end: Number(Math.max(s.start + 0.3, s.end).toFixed(2)),
      text: String(s.text).trim(),
      emoji: String(s.emoji || '🎬').trim(),
    }));
}

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
  midpoint: number;
}

export interface AudioSliceBoundary {
  audioStart: number;
  audioEnd: number;
}

/**
 * Parses FFmpeg silencedetect stderr output into ordered silence intervals.
 */
export function parseSilenceDetectOutput(stderr: string): SilenceInterval[] {
  const silences: SilenceInterval[] = [];
  let pendingStart: number | null = null;

  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      const s = Number(startMatch[1]);
      if (Number.isFinite(s)) {
        pendingStart = s;
      }
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (endMatch) {
      const end = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      const start = pendingStart !== null ? pendingStart : Math.max(0, end - duration);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        silences.push({
          start: Number(start.toFixed(3)),
          end: Number(end.toFixed(3)),
          duration: Number(duration.toFixed(3)),
          midpoint: Number(((start + end) / 2).toFixed(3)),
        });
      }
      pendingStart = null;
    }
  }

  return silences.sort((a, b) => a.start - b.start);
}

/**
 * Splits a single synthesized TTS WAV file across N text segments using detected silent pauses
 * near weighted grapheme boundaries (1 Gemini TTS API call -> N time-aligned audio slices).
 */
export function splitAudioBoundariesForSegments(
  segments: Array<{ text: string }>,
  totalAudioDuration: number,
  silences: SilenceInterval[]
): AudioSliceBoundary[] {
  const safeTotal = Math.max(0.4, Number.isFinite(totalAudioDuration) ? totalAudioDuration : 1.0);
  const count = segments.length;
  if (count <= 1) {
    return [{ audioStart: 0, audioEnd: Number(safeTotal.toFixed(3)) }];
  }

  const weights = segments.map((s) => Math.max(4, Array.from(String(s.text || '').trim()).length));
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);

  // Compute expected cumulative cut points for k = 1 .. count - 1
  const expectedCuts: number[] = [];
  let accum = 0;
  for (let i = 0; i < count - 1; i++) {
    accum += weights[i];
    expectedCuts.push((accum / totalWeight) * safeTotal);
  }

  // Filter interior pauses (ignore leading/trailing silence at very start or end of file)
  const interiorSilences = silences.filter(
    (s) => s.midpoint > 0.15 && s.midpoint < safeTotal - 0.15 && s.duration >= 0.12
  );

  const avgSlice = safeTotal / count;
  const searchRadius = Math.max(0.6, avgSlice * 0.65);

  const cuts: Array<{ endPrev: number; startNext: number }> = [];
  let minCursor = 0.2;
  let lastUsedSilenceIdx = -1;

  for (let k = 0; k < expectedCuts.length; k++) {
    const remainingSlices = count - (k + 1);
    const maxAllowed = Math.max(minCursor + 0.1, safeTotal - remainingSlices * 0.2);
    const expected = expectedCuts[k];

    let bestIdx = -1;
    let bestScore = Infinity;

    for (let sIdx = lastUsedSilenceIdx + 1; sIdx < interiorSilences.length; sIdx++) {
      const sil = interiorSilences[sIdx];
      if (sil.midpoint <= minCursor || sil.midpoint >= maxAllowed) continue;
      const dist = Math.abs(sil.midpoint - expected);
      if (dist <= searchRadius) {
        // Favor silences closer to expected cut and longer pauses
        const score = dist - Math.min(0.4, sil.duration * 0.5);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = sIdx;
        }
      }
    }

    if (bestIdx >= 0) {
      const matched = interiorSilences[bestIdx];
      lastUsedSilenceIdx = bestIdx;
      const endPrev = Math.min(maxAllowed, Math.max(minCursor, matched.start + 0.03));
      const startNext = Math.min(maxAllowed, Math.max(endPrev, matched.end - 0.03));
      cuts.push({
        endPrev: Number(endPrev.toFixed(3)),
        startNext: Number(startNext.toFixed(3)),
      });
      minCursor = startNext + 0.2;
    } else {
      const clampedCut = Math.min(maxAllowed, Math.max(minCursor, expected));
      cuts.push({
        endPrev: Number(clampedCut.toFixed(3)),
        startNext: Number(clampedCut.toFixed(3)),
      });
      minCursor = clampedCut + 0.2;
    }
  }

  const boundaries: AudioSliceBoundary[] = [];
  let currentStart = 0;
  for (let k = 0; k < cuts.length; k++) {
    const end = Math.max(currentStart + 0.12, cuts[k].endPrev);
    boundaries.push({
      audioStart: Number(currentStart.toFixed(3)),
      audioEnd: Number(Math.min(safeTotal, end).toFixed(3)),
    });
    currentStart = cuts[k].startNext;
  }
  boundaries.push({
    audioStart: Number(Math.min(safeTotal - 0.12, currentStart).toFixed(3)),
    audioEnd: Number(safeTotal.toFixed(3)),
  });

  return boundaries;
}

export interface VideoSpeedSyncPlan {
  originalVideoDuration: number;
  aiVoiceDuration: number;
  setptsFactor: number;
  videoPlaybackRate: number;
}

/**
 * Computes FFmpeg setpts multiplier so the video playback speed follows the untouched AI voice duration
 * (setpts = aiVoiceDuration / originalVideoDuration). AI voice is never stretched or compressed.
 */
export function computeVideoSpeedSyncPlan(
  originalVideoDuration: number,
  aiVoiceDuration: number
): VideoSpeedSyncPlan {
  const safeVideoDur = Math.max(0.5, Number.isFinite(originalVideoDuration) ? originalVideoDuration : 12);
  const safeVoiceDur = Math.max(0.5, Number.isFinite(aiVoiceDuration) ? aiVoiceDuration : safeVideoDur);
  const setptsFactor = safeVoiceDur / safeVideoDur;
  const videoPlaybackRate = safeVideoDur / safeVoiceDur;

  return {
    originalVideoDuration: Number(safeVideoDur.toFixed(3)),
    aiVoiceDuration: Number(safeVoiceDur.toFixed(3)),
    setptsFactor: Number(setptsFactor.toFixed(6)),
    videoPlaybackRate: Number(videoPlaybackRate.toFixed(2)),
  };
}

export interface GroqWordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface GroqSegmentTimestamp {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

const NOISE_ONLY_PATTERN = /^(?:[\[\(]\s*(?:music|applause|laughter|silence|noise|sfx|sound)\s*[\]\)]|[.\s,!?-]+)$/i;

function isMeaningfulSpeechSegment(seg: GroqSegmentTimestamp): boolean {
  const txt = String(seg.text || '').trim();
  if (!txt || NOISE_ONLY_PATTERN.test(txt)) return false;
  if (typeof seg.no_speech_prob === 'number') {
    if (seg.no_speech_prob >= 0.72) return false;
    if (seg.no_speech_prob >= 0.52 && typeof seg.avg_logprob === 'number' && seg.avg_logprob < -1.1) {
      return false;
    }
  }
  return true;
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

function makeSilenceSegment(id: string, start: number, end: number): VideoTimelineSegment {
  const s = round3(start);
  const e = round3(end);
  const dur = round3(Math.max(0.05, e - s));
  return {
    id,
    kind: 'silence',
    start: s,
    end: e,
    duration: dur,
    text: '',
    myanmarText: '',
    emoji: '',
    aiVoiceDuration: 0,
    setptsFactor: 1.0,
    videoPlaybackRate: 1.0,
    outputStart: s,
    outputEnd: e,
  };
}

/**
 * Splits a full [0, totalDuration] video into contiguous non-overlapping 'speaking' and 'silence'
 * segments using Groq Whisper segment & word timestamps.
 */
export function buildTimelineFromGroq(
  rawSegments: GroqSegmentTimestamp[],
  rawWords: GroqWordTimestamp[],
  totalDuration: number,
  options?: { minSilenceGapSec?: number; wordPauseSplitSec?: number; maxSpeakingSegments?: number }
): VideoTimelineSegment[] {
  const safeTotal = round3(Math.max(0.5, Number.isFinite(totalDuration) ? totalDuration : 12));
  const minSilenceGap = options?.minSilenceGapSec ?? 0.28;
  const wordPauseSplit = options?.wordPauseSplitSec ?? 0.55;
  const maxSpeaking = options?.maxSpeakingSegments ?? 18;

  // 1. Collect clean speaking intervals from Groq segments (refined by Groq word pauses if available)
  const validSegments = [...rawSegments]
    .filter(isMeaningfulSpeechSegment)
    .map((s) => ({
      start: Math.max(0, Math.min(safeTotal, Number(s.start || 0))),
      end: Math.max(0, Math.min(safeTotal, Number(s.end || 0))),
      text: String(s.text || '').trim(),
    }))
    .filter((s) => s.end > s.start + 0.08)
    .sort((a, b) => a.start - b.start);

  const validWords = [...rawWords]
    .map((w) => ({
      word: String(w.word || '').trim(),
      start: Math.max(0, Math.min(safeTotal, Number(w.start || 0))),
      end: Math.max(0, Math.min(safeTotal, Number(w.end || 0))),
    }))
    .filter((w) => w.word.length > 0 && w.end >= w.start)
    .sort((a, b) => a.start - b.start);

  let speechBlocks: Array<{ start: number; end: number; text: string }> = [];

  if (validWords.length > 0) {
    // Group Groq words into speaking chunks split whenever there is a pause >= wordPauseSplit
    let curWords = [validWords[0]];
    for (let i = 1; i < validWords.length; i++) {
      const prev = validWords[i - 1];
      const curr = validWords[i];
      if (curr.start - prev.end >= wordPauseSplit) {
        speechBlocks.push({
          start: curWords[0].start,
          end: Math.max(curWords[0].start + 0.25, prev.end),
          text: curWords.map((w) => w.word).join(' ').trim(),
        });
        curWords = [curr];
      } else {
        curWords.push(curr);
      }
    }
    const lastW = curWords[curWords.length - 1];
    speechBlocks.push({
      start: curWords[0].start,
      end: Math.max(curWords[0].start + 0.25, lastW.end),
      text: curWords.map((w) => w.word).join(' ').trim(),
    });
  } else {
    speechBlocks = validSegments;
  }

  // If still zero speaking intervals, the entire video is natural silence at 1.0x speed
  if (speechBlocks.length === 0) {
    return [makeSilenceSegment('seg_1', 0, safeTotal)];
  }

  // Merge micro-gaps smaller than minSilenceGap between consecutive speaking blocks
  // and enforce non-overlapping monotonically increasing boundaries
  const mergedSpeech: Array<{ start: number; end: number; text: string }> = [];
  for (const blk of speechBlocks) {
    const start = Math.max(0, Math.min(safeTotal - 0.25, blk.start));
    const end = Math.min(safeTotal, Math.max(start + 0.25, blk.end));
    const prev = mergedSpeech[mergedSpeech.length - 1];
    if (prev && (start - prev.end < minSilenceGap || mergedSpeech.length >= maxSpeaking)) {
      prev.end = Math.max(prev.end, end);
      prev.text = `${prev.text} ${blk.text}`.trim();
    } else {
      mergedSpeech.push({ start, end, text: blk.text });
    }
  }

  // Assemble full contiguous [0, safeTotal] timeline interleaving 'silence' and 'speaking' segments
  const timeline: VideoTimelineSegment[] = [];
  let cursor = 0;
  let seqIdx = 1;

  for (let i = 0; i < mergedSpeech.length; i++) {
    const sp = mergedSpeech[i];
    const gapBefore = sp.start - cursor;
    let speechStart = sp.start;

    if (gapBefore >= minSilenceGap) {
      timeline.push(makeSilenceSegment(`seg_${seqIdx++}`, cursor, sp.start));
    } else {
      // Absorb tiny sub-threshold leading gap seamlessly so no 2-frame glitch occurs
      speechStart = cursor;
    }

    // Pull tiny trailing tail into last speaking segment if trailing gap < minSilenceGap
    const isLast = i === mergedSpeech.length - 1;
    let speechEnd = Math.min(safeTotal, Math.max(speechStart + 0.25, sp.end));
    if (isLast && safeTotal - speechEnd < minSilenceGap) {
      speechEnd = safeTotal;
    }

    const dur = round3(Math.max(0.25, speechEnd - speechStart));
    timeline.push({
      id: `seg_${seqIdx++}`,
      kind: 'speaking',
      start: round3(speechStart),
      end: round3(speechEnd),
      duration: dur,
      text: sp.text,
      myanmarText: '',
      emoji: '🎬',
      aiVoiceDuration: 0,
      setptsFactor: 1.0,
      videoPlaybackRate: 1.0,
      outputStart: round3(speechStart),
      outputEnd: round3(speechEnd),
    });

    cursor = round3(speechEnd);
  }

  if (safeTotal - cursor >= minSilenceGap) {
    timeline.push(makeSilenceSegment(`seg_${seqIdx++}`, cursor, safeTotal));
  } else if (timeline.length > 0 && cursor < safeTotal) {
    const lastSeg = timeline[timeline.length - 1];
    lastSeg.end = safeTotal;
    lastSeg.duration = round3(safeTotal - lastSeg.start);
    lastSeg.outputEnd = safeTotal;
  }

  return timeline;
}

/**
 * Applies Gemini-generated Myanmar Dubbing script STRICTLY to speaking segments.
 * Guarantees every silence segment has empty myanmarText & emoji and zero AI voice.
 */
export function applyMyanmarScriptToTimeline(
  timeline: VideoTimelineSegment[],
  generatedSpeaking: Array<{ id?: string; myanmarText?: string; emoji?: string }>
): VideoTimelineSegment[] {
  const byId = new Map<string, { myanmarText?: string; emoji?: string }>();
  for (const item of generatedSpeaking) {
    if (item.id) byId.set(item.id, item);
  }

  let speakOrderIdx = 0;
  return timeline.map((seg) => {
    if (seg.kind === 'silence') {
      return {
        ...seg,
        myanmarText: '',
        emoji: '',
        aiVoiceDuration: 0,
        setptsFactor: 1.0,
        videoPlaybackRate: 1.0,
      };
    }

    const match = byId.get(seg.id) || generatedSpeaking[speakOrderIdx];
    speakOrderIdx += 1;
    const cleanedText = String(match?.myanmarText || seg.myanmarText || seg.text).trim();
    const cleanedEmoji = String(match?.emoji || seg.emoji || '🎬').trim() || '🎬';
    return {
      ...seg,
      myanmarText: cleanedText,
      emoji: cleanedEmoji,
    };
  });
}

export interface SegmentAwareTimelinePlan {
  segments: VideoTimelineSegment[];
  syncedCaptions: CaptionSegment[];
  totalOriginalDuration: number;
  totalFinalDuration: number;
  totalAiVoiceDuration: number;
  totalPreservedSilenceDuration: number;
  speakingSegmentCount: number;
  silenceSegmentCount: number;
  avgSpeakingPlaybackRate: number;
}

/**
 * Scales the Myanmar word budget per speaking segment according to the selected VoiceSpeed
 * so Fast voice generates crisp compact lines (<1.0x duration -> >1.0x speaking video speed)
 * and Slow voice generates expressive unhurried lines (>1.0x duration -> <1.0x speaking video speed).
 */
export function scaleWordBudgetForVoiceSpeed(baseMaxWords: number, speed: VoiceSpeed = 1.0): number {
  const safeBase = Math.max(3, Math.round(baseMaxWords || 6));
  if (speed === 'fast') {
    return Math.max(2, Math.round(safeBase * 0.6));
  }
  if (speed === 'slow') {
    return Math.max(4, Math.round(safeBase * 1.45));
  }
  // For continuous WSOLA speeds (1.0x..2.0x), natural phrase count ensures WSOLA compresses cleanly to exact target speed
  return safeBase;
}

export interface RecapBeat {
  id: string;
  start: number;
  end: number;
  duration: number;
  contextText: string;
  maxMyanmarWords: number;
}

/**
 * Tool 1 (Movie Recap): partitions the ENTIRE video [0, totalDuration] into continuous storytelling beats
 * (does NOT skip silence gaps) so Gemini writes a complete full-video recap narration.
 */
export function buildFullRecapBeats(
  rawSegments: Array<{ start: number; end: number; text: string }>,
  totalDuration: number,
  voiceSpeed: VoiceSpeed = 'normal'
): RecapBeat[] {
  const safeTotal = round3(Math.max(1.0, Number.isFinite(totalDuration) ? totalDuration : 12));
  const targetBeatCount = Math.min(8, Math.max(2, Math.round(safeTotal / 4)));
  const beatDur = safeTotal / targetBeatCount;

  const cleanInputs = rawSegments
    .filter((s) => String(s.text || '').trim().length > 0)
    .map((s) => ({
      start: Math.max(0, Number(s.start || 0)),
      end: Math.min(safeTotal, Number(s.end || safeTotal)),
      text: String(s.text).trim(),
    }));

  const beats: RecapBeat[] = [];
  for (let i = 0; i < targetBeatCount; i++) {
    const start = round3(i * beatDur);
    const end = i === targetBeatCount - 1 ? safeTotal : round3((i + 1) * beatDur);
    const dur = round3(Math.max(0.5, end - start));

    const overlappingText = cleanInputs
      .filter((s) => s.end > start && s.start < end)
      .map((s) => s.text)
      .join(' ')
      .trim();

    const baseWords = Math.max(4, Math.round(dur * 2.5));
    beats.push({
      id: `beat_${i + 1}`,
      start,
      end,
      duration: dur,
      contextText: overlappingText || `Scene part ${i + 1} (${start.toFixed(1)}s - ${end.toFixed(1)}s)`,
      maxMyanmarWords: scaleWordBudgetForVoiceSpeed(baseWords, voiceSpeed),
    });
  }

  return beats;
}

/**
 * Tool 1 (Movie Recap): distributes continuous recap beats proportionally across the final AI voice
 * duration [0, totalTargetDuration] by character weight so captions match the whole-video AI narration.
 */
export function buildProportionalCaptionsForDuration(
  items: Array<{ id?: string; text: string; emoji?: string }>,
  totalTargetDuration: number
): CaptionSegment[] {
  const clean = items.filter((it) => String(it.text || '').trim().length > 0);
  if (clean.length === 0) return [];

  const safeTotal = Math.max(0.5, Number.isFinite(totalTargetDuration) ? totalTargetDuration : 12);
  const weights = clean.map((it) => Math.max(4, Array.from(String(it.text).trim()).length));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  let cursor = 0;
  return clean.map((it, idx) => {
    const portion = (weights[idx] / totalWeight) * safeTotal;
    const start = round3(cursor);
    const end = idx === clean.length - 1 ? round3(safeTotal) : round3(Math.min(safeTotal, cursor + portion));
    cursor = end;
    return {
      id: it.id || `cap_${idx + 1}`,
      start,
      end: round3(Math.max(start + 0.25, end)),
      text: String(it.text).trim(),
      emoji: String(it.emoji || '🎬').trim() || '🎬',
    };
  });
}

/**
 * Tool 3 (Captions Only): builds synced dynamic Myanmar captions strictly locked to original
 * speaking timestamps without altering speed or adding AI voice.
 */
export function buildOriginalAudioCaptions(
  segments: Array<{ id?: string; start: number; end: number; text: string; emoji?: string }>
): CaptionSegment[] {
  return buildSyncedCaptionsFromSegments(segments);
}

/**
 * Tool 2 (Myanmar Dubbing): computes per-segment video speed factors ONLY for speaking segments
 * to match each speaking segment's AI voice duration. Silence segments ALWAYS stay strictly at 1.0x.
 */
export function computeSegmentAwareTimelinePlan(
  timeline: VideoTimelineSegment[],
  voiceDurationsById: Record<string, number>,
  voiceSpeed: VoiceSpeed = 'normal'
): SegmentAwareTimelinePlan {
  let outCursor = 0;
  let totalOrig = 0;
  let totalAiVoice = 0;
  let totalSilence = 0;
  let speakCount = 0;
  let silenceCount = 0;
  let origSpeakingDurSum = 0;

  const plannedSegments: VideoTimelineSegment[] = [];
  const syncedCaptions: CaptionSegment[] = [];

  for (const seg of timeline) {
    const origDur = Math.max(0.05, Number(seg.duration || seg.end - seg.start));
    totalOrig += origDur;

    if (seg.kind === 'silence') {
      silenceCount += 1;
      totalSilence += origDur;
      const outStart = round3(outCursor);
      const outEnd = round3(outCursor + origDur);
      outCursor = outEnd;
      plannedSegments.push({
        ...seg,
        myanmarText: '',
        emoji: '',
        aiVoiceDuration: 0,
        setptsFactor: 1.0,
        videoPlaybackRate: 1.0,
        outputStart: outStart,
        outputEnd: outEnd,
      });
      continue;
    }

    speakCount += 1;
    origSpeakingDurSum += origDur;
    const measuredVoice = Number(voiceDurationsById[seg.id] ?? seg.aiVoiceDuration ?? 0);
    const hasVoice = Number.isFinite(measuredVoice) && measuredVoice > 0.05;
    const numericRate = resolveVoiceSpeedNumeric(voiceSpeed);
    const fallbackFactor =
      voiceSpeed === 'slow'
        ? 1.35
        : voiceSpeed === 'fast'
          ? 0.72
          : numericRate > 1.01
            ? 1.0 / numericRate
            : 1.0;
    const targetDur = hasVoice ? measuredVoice : origDur * fallbackFactor;
    const setptsFactor = Math.min(10.0, Math.max(0.1, targetDur / origDur));
    const playbackRate = origDur / targetDur;

    if (hasVoice) {
      totalAiVoice += targetDur;
    }

    const outStart = round3(outCursor);
    const outEnd = round3(outCursor + targetDur);
    outCursor = outEnd;

    plannedSegments.push({
      ...seg,
      aiVoiceDuration: round3(hasVoice ? targetDur : 0),
      setptsFactor: Number(setptsFactor.toFixed(6)),
      videoPlaybackRate: Number(playbackRate.toFixed(2)),
      outputStart: outStart,
      outputEnd: outEnd,
    });

    const captionText = String(seg.myanmarText || seg.text || '').trim();
    if (captionText) {
      syncedCaptions.push({
        id: `cap_${seg.id}`,
        start: round3(outStart),
        end: round3(Math.max(outStart + 0.25, outEnd)),
        text: captionText,
        emoji: seg.emoji || '🎬',
      });
    }
  }

  const avgSpeakingPlaybackRate =
    totalAiVoice > 0 && origSpeakingDurSum > 0
      ? Number((origSpeakingDurSum / totalAiVoice).toFixed(2))
      : 1.0;

  return {
    segments: plannedSegments,
    syncedCaptions,
    totalOriginalDuration: round3(totalOrig),
    totalFinalDuration: round3(outCursor),
    totalAiVoiceDuration: round3(totalAiVoice),
    totalPreservedSilenceDuration: round3(totalSilence),
    speakingSegmentCount: speakCount,
    silenceSegmentCount: silenceCount,
    avgSpeakingPlaybackRate,
  };
}
