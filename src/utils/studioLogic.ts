import type {
  CaptionDecorationConfig,
  CaptionFontSizePreset,
  CaptionSegment,
  CreditPackage,
  MyanmarVoiceId,
  OverlayPosition,
  StudioTool,
  VoiceGender,
  VoiceSpeed,
} from '../types/studio';

export const MAX_VIDEO_DURATION_SECONDS = 120 * 60; // 120 minutes
export const MAX_THUMBNAIL_TITLE_CHARS = 24; // strictly under 25 characters

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: 'starter',
    nameMy: 'Starter Pack',
    credits: 50,
    priceMmk: 15000,
    priceThb: 149,
    descriptionMy: 'Recap ဗီဒီယို ၅ ပုဒ်အထိ စတင်ဖန်တီးနိုင်သည်',
  },
  {
    id: 'creator',
    nameMy: 'Creator Pro Pack',
    credits: 150,
    priceMmk: 39000,
    priceThb: 379,
    descriptionMy: '4K Export နှင့် Dubbing အတွက် အသင့်တော်ဆုံး',
  },
  {
    id: 'studio',
    nameMy: 'Studio Unlimited Pack',
    credits: 500,
    priceMmk: 115000,
    priceThb: 1090,
    descriptionMy: 'Channel ကြီးများအတွက် သက်တမ်းမကုန် Credit အများဆုံး',
  },
];

export type SupportedPlatform = 'YouTube' | 'TikTok' | 'Facebook' | 'Instagram';

export interface UrlValidationResult {
  valid: boolean;
  platform?: SupportedPlatform;
  errorMy?: string;
}

export function validateVideoUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      errorMy: 'ဗီဒီယိုလင့်ခ် ထည့်သွင်းပေးပါ (YouTube, TikTok, Facebook သို့မဟုတ် Instagram)',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      errorMy: 'လင့်ခ်ပုံစံ မှားယွင်းနေပါသည် — https:// ဖြင့် စတင်သော လင့်ခ်အပြည့်အစုံ ထည့်ပါ',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      errorMy: 'HTTP သို့မဟုတ် HTTPS အများသုံးလင့်ခ်သာ လက်ခံပါသည်',
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    return { valid: true, platform: 'YouTube' };
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    return { valid: true, platform: 'TikTok' };
  }
  if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.watch') {
    return { valid: true, platform: 'Facebook' };
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    return { valid: true, platform: 'Instagram' };
  }

  return {
    valid: false,
    errorMy: 'YouTube, TikTok, Facebook နှင့် Instagram Public လင့်ခ်များကိုသာ ပံ့ပိုးပါသည်',
  };
}

export function validateVideoDuration(durationSeconds: number): {
  valid: boolean;
  errorMy?: string;
} {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      valid: false,
      errorMy: 'ဗီဒီယိုကြာချိန် မမှန်ကန်ပါ',
    };
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    return {
      valid: false,
      errorMy: 'ဗီဒီယိုအရှည်သည် အများဆုံး ၁၂၀ မိနစ် (၂ နာရီ) ထက် မကျော်လွန်ရပါ',
    };
  }
  return { valid: true };
}

export function clampOverlayPosition(x: number, y: number): OverlayPosition {
  const clamp = (val: number) => Math.min(92, Math.max(8, Math.round(val * 10) / 10));
  return {
    x: clamp(Number.isFinite(x) ? x : 50),
    y: clamp(Number.isFinite(y) ? y : 50),
  };
}

export function countCharacters(text: string): number {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('my', { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(text)) {
      count += 1;
    }
    return count;
  }
  return Array.from(text).length;
}

export function truncateThumbnailTitle(title: string, maxChars = MAX_THUMBNAIL_TITLE_CHARS): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('my', { granularity: 'grapheme' });
    const graphemes: string[] = [];
    for (const seg of segmenter.segment(normalized)) {
      graphemes.push(seg.segment);
      if (graphemes.length >= maxChars) break;
    }
    return graphemes.join('').trim();
  }
  return Array.from(normalized).slice(0, maxChars).join('').trim();
}

export const VOICE_SPEED_STEPS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0] as const;

export function normalizeVoiceSpeed(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(Math.min(2.0, Math.max(1.0, raw)) * 10) / 10;
  }
  const str = String(raw || '').trim().toLowerCase();
  if (str === 'slow') return 0.85;
  if (str === 'normal' || str === '') return 1.0;
  if (str === 'fast') return 1.4;
  if (str === '2x') return 2.0;
  const parsed = Number(str.replace(/x$/i, ''));
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(Math.min(2.0, Math.max(1.0, parsed)) * 10) / 10;
  }
  return 1.0;
}

export function formatVoiceSpeedLabel(speed: VoiceSpeed): string {
  const factor = getVoiceSpeedFactor(speed);
  return `${factor.toFixed(1)}x`;
}

export function getVoiceSpeedFactor(speed: VoiceSpeed): number {
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    return Math.round(Math.min(2.0, Math.max(0.5, speed)) * 100) / 100;
  }
  switch (speed) {
    case 'slow':
      return 0.85;
    case 'fast':
      return 1.22;
    case '2x':
      return 2.0;
    case 'normal':
    default:
      return 1.0;
  }
}

export function normalizeVoiceGender(raw: unknown): VoiceGender | null {
  const str = String(raw || '').trim().toLowerCase();
  if (str === 'male') return 'male';
  if (str === 'female') return 'female';
  return null;
}

export function validateVoiceGenderForTool(
  tool: StudioTool,
  rawGender: unknown
): { valid: boolean; gender: VoiceGender | null; errorMy?: string } {
  if (tool === 'captions') {
    return { valid: true, gender: null };
  }
  const normalized = normalizeVoiceGender(rawGender);
  if (!normalized) {
    return {
      valid: false,
      gender: null,
      errorMy: 'Gemini TTS အသံထုတ်လုပ်ရန် အမျိုးသား (Male Voice) သို့မဟုတ် အမျိုးသမီး (Female Voice) အသံကို ရွေးချယ်ပါ',
    };
  }
  return { valid: true, gender: normalized };
}

export function formatVoiceGenderLabelMy(gender?: VoiceGender | null): string {
  if (gender === 'male') return 'အမျိုးသားအသံ (Male)';
  if (gender === 'female') return 'အမျိုးသမီးအသံ (Female)';
  return '';
}

export function buildTtsVoicePersonaDirective(
  voiceGender: VoiceGender,
  voiceStyle: MyanmarVoiceId = 'street_bro'
): string {
  if (voiceGender === 'female') {
    if (voiceStyle === 'thriller_narrator') {
      return 'Speak as an expressive adult FEMALE Myanmar (Burmese) woman narrator with a clear feminine voice, suspenseful and captivating cinematic mystery storyteller tone.';
    }
    if (voiceStyle === 'dramatic_story') {
      return 'Speak as a warm, expressive adult FEMALE Myanmar (Burmese) woman narrator with a natural feminine vocal pitch and deeply emotional drama storyteller tone.';
    }
    return 'Speak as a lively, charismatic young FEMALE Myanmar (Burmese) woman narrator with a clear, energetic feminine voice and engaging YouTube movie-recapper tone.';
  }

  if (voiceStyle === 'thriller_narrator') {
    return 'Speak as an expressive adult MALE Myanmar (Burmese) man narrator with a deep, confident masculine voice and suspenseful cinematic mystery storyteller tone.';
  }
  if (voiceStyle === 'dramatic_story') {
    return 'Speak as a warm, expressive adult MALE Myanmar (Burmese) man narrator with a rich masculine vocal pitch and heartfelt drama storyteller tone.';
  }
  return 'Speak as a lively, charismatic young MALE Myanmar (Burmese) man narrator with a distinct confident masculine voice and energetic YouTube street-slang movie-recapper tone.';
}

export function calculateCreditCost(
  tool: StudioTool,
  is4k: boolean,
  durationSeconds = 60
): number {
  const baseCost = tool === 'recap' ? 10 : tool === 'dubbing' ? 8 : 5;
  const durationMultiplier = durationSeconds > 1800 ? 2 : 1; // > 30 mins adds scaling
  const ultraHdCost = is4k ? 4 : 0;
  return baseCost * durationMultiplier + ultraHdCost;
}

export function getActiveCaptionAtTime(
  captions: CaptionSegment[],
  currentTimeSeconds: number
): CaptionSegment | null {
  for (const seg of captions) {
    if (currentTimeSeconds >= seg.start && currentTimeSeconds <= seg.end) {
      return seg;
    }
  }
  return null;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function wrapWavHeaderIfNeeded(
  audioBytes: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
): Uint8Array {
  // Check for RIFF header
  if (
    audioBytes.length >= 12 &&
    audioBytes[0] === 0x52 && // R
    audioBytes[1] === 0x49 && // I
    audioBytes[2] === 0x46 && // F
    audioBytes[3] === 0x46 // F
  ) {
    return audioBytes;
  }

  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = audioBytes.length;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const combined = new Uint8Array(44 + dataSize);
  combined.set(new Uint8Array(header), 0);
  combined.set(audioBytes, 44);
  return combined;
}

export function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const centis = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export const CAPTION_FONT_SIZE_PRESETS: Record<CaptionFontSizePreset, number> = {
  small: 0.82,
  medium: 1.0,
  large: 1.35,
};

export const DEFAULT_CAPTION_DECORATION: CaptionDecorationConfig = {
  fontSizePreset: 'medium',
  fontSizeScale: 1.0,
  textColor: '#FFFFFF',
  borderEnabled: true,
  borderThickness: 2,
  borderColor: '#090B10',
  blurBgEnabled: true,
  blurIntensity: 10,
  bgOpacity: 72,
  bgColor: '#090B10',
  bgCornerRadius: 12,
};

export function normalizeHexColor(raw: unknown, fallback = '#FFFFFF'): string {
  const str = String(raw || '').trim();
  const full = str.match(/^#([0-9a-fA-F]{6})$/);
  if (full) return `#${full[1].toUpperCase()}`;
  const short = str.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

export function sanitizeCaptionDecoration(
  raw?: Partial<CaptionDecorationConfig> | null
): CaptionDecorationConfig {
  const d = raw || {};
  const scaleRaw = Number(d.fontSizeScale);
  const fontSizeScale = Number.isFinite(scaleRaw)
    ? Math.round(Math.min(1.7, Math.max(0.7, scaleRaw)) * 100) / 100
    : DEFAULT_CAPTION_DECORATION.fontSizeScale;

  const fontSizePreset: CaptionFontSizePreset =
    d.fontSizePreset === 'small' || d.fontSizePreset === 'medium' || d.fontSizePreset === 'large'
      ? d.fontSizePreset
      : fontSizeScale <= 0.9
        ? 'small'
        : fontSizeScale >= 1.2
          ? 'large'
          : 'medium';

  const thickRaw = Number(d.borderThickness);
  const borderThickness = Number.isFinite(thickRaw)
    ? Math.round(Math.min(10, Math.max(1, thickRaw)) * 10) / 10
    : DEFAULT_CAPTION_DECORATION.borderThickness;

  const blurRaw = Number(d.blurIntensity);
  const blurIntensity = Number.isFinite(blurRaw)
    ? Math.round(Math.min(24, Math.max(0, blurRaw)))
    : DEFAULT_CAPTION_DECORATION.blurIntensity;

  const opacityRaw = Number(d.bgOpacity);
  const bgOpacity = Number.isFinite(opacityRaw)
    ? Math.round(Math.min(100, Math.max(0, opacityRaw)))
    : DEFAULT_CAPTION_DECORATION.bgOpacity;

  const radiusRaw = Number(d.bgCornerRadius);
  const bgCornerRadius = Number.isFinite(radiusRaw)
    ? Math.round(Math.min(28, Math.max(0, radiusRaw)))
    : DEFAULT_CAPTION_DECORATION.bgCornerRadius;

  return {
    fontSizePreset,
    fontSizeScale,
    textColor: normalizeHexColor(d.textColor, DEFAULT_CAPTION_DECORATION.textColor),
    borderEnabled:
      typeof d.borderEnabled === 'boolean' ? d.borderEnabled : DEFAULT_CAPTION_DECORATION.borderEnabled,
    borderThickness,
    borderColor: normalizeHexColor(d.borderColor, DEFAULT_CAPTION_DECORATION.borderColor),
    blurBgEnabled:
      typeof d.blurBgEnabled === 'boolean' ? d.blurBgEnabled : DEFAULT_CAPTION_DECORATION.blurBgEnabled,
    blurIntensity,
    bgOpacity,
    bgColor: normalizeHexColor(d.bgColor, DEFAULT_CAPTION_DECORATION.bgColor),
    bgCornerRadius,
  };
}

export function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = normalizeHexColor(hex, '#090B10').slice(1);
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const alpha = Math.min(1, Math.max(0, opacityPercent / 100));
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

export function hexToAssColor(hex: string, opacityPercent = 100): string {
  const clean = normalizeHexColor(hex, '#FFFFFF').slice(1);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  // ASS alpha: 00 = fully opaque, FF = fully transparent
  const alphaNum = Math.round((1 - Math.min(100, Math.max(0, opacityPercent)) / 100) * 255);
  const aa = alphaNum.toString(16).padStart(2, '0').toUpperCase();
  return `&H${aa}${b}${g}${r}`;
}

export const CAPTION_BOX_MAX_WIDTH_PCT = 72;
export const CAPTION_MAX_LINES = 2;
export const CAPTION_LINE_HEIGHT = 1.45;
export const CAPTION_BOTTOM_SAFETY_MARGIN_PCT = 9;
export const CAPTION_SIDE_SAFETY_MARGIN_PCT = 4;

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'
    ? new Intl.Segmenter('my', { granularity: 'grapheme' })
    : null;

function splitGraphemes(input: string): string[] {
  if (!input) return [];
  if (graphemeSegmenter) {
    const out: string[] = [];
    for (const seg of graphemeSegmenter.segment(input)) {
      out.push(seg.segment);
    }
    return out;
  }
  return Array.from(input);
}

/**
 * Estimates maximum readable graphemes per line inside a caption box constrained to 72% of video width.
 */
export function estimateCaptionCharsPerLine(
  videoWidth = 1280,
  videoHeight = 720,
  fontSizeScale = 1.0
): number {
  const safeW = Math.max(160, Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 1280);
  const safeH = Math.max(160, Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 720);
  const safeScale = Math.min(1.7, Math.max(0.7, Number.isFinite(fontSizeScale) ? fontSizeScale : 1.0));
  const fontSize = Math.max(20, Math.round(safeH * 0.045 * safeScale));
  const usableBoxWidth = safeW * (CAPTION_BOX_MAX_WIDTH_PCT / 100) * 0.88;
  const approxCharAdvance = fontSize * 0.92;
  const estimated = Math.floor(usableBoxWidth / Math.max(12, approxCharAdvance));
  return Math.min(26, Math.max(12, estimated));
}

/**
 * Wraps caption text cleanly at word / clause / grapheme boundaries so no line exceeds maxCharsPerLine.
 */
export function wrapCaptionTextToLines(text: string, maxCharsPerLine = 32): string[] {
  const safeLimit = Math.max(8, Math.floor(maxCharsPerLine || 32));
  const paragraphs = String(text || '')
    .split(/\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const allLines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(' ').filter(Boolean);
    let currentLine = '';
    let currentLen = 0;

    const pushTokenHard = (token: string) => {
      const graphemes = splitGraphemes(token);
      for (let i = 0; i < graphemes.length; i += safeLimit) {
        const piece = graphemes.slice(i, i + safeLimit).join('');
        if (currentLine) {
          allLines.push(currentLine);
          currentLine = '';
          currentLen = 0;
        }
        if (i + safeLimit >= graphemes.length) {
          currentLine = piece;
          currentLen = splitGraphemes(piece).length;
        } else {
          allLines.push(piece);
        }
      }
    };

    for (const word of words) {
      const wordLen = splitGraphemes(word).length;
      if (!currentLine) {
        if (wordLen <= safeLimit) {
          currentLine = word;
          currentLen = wordLen;
        } else {
          pushTokenHard(word);
        }
      } else if (currentLen + 1 + wordLen <= safeLimit) {
        currentLine = `${currentLine} ${word}`;
        currentLen += 1 + wordLen;
      } else {
        allLines.push(currentLine);
        currentLine = '';
        currentLen = 0;
        if (wordLen <= safeLimit) {
          currentLine = word;
          currentLen = wordLen;
        } else {
          pushTokenHard(word);
        }
      }
    }

    if (currentLine) {
      allLines.push(currentLine);
    }
  }

  return allLines;
}

/**
 * Enforces LONG CAPTION READABILITY RULES:
 * - Maximum 2 lines per single caption box.
 * - Any caption longer than 2 lines is automatically split into multiple sequential captions
 *   with proportional new timestamps inside its original [start, end] window.
 */
export function splitLongCaptionsToMaxTwoLines(
  captions: CaptionSegment[],
  options?: {
    videoWidth?: number;
    videoHeight?: number;
    fontSizeScale?: number;
    maxCharsPerLine?: number;
    maxLines?: number;
  }
): CaptionSegment[] {
  const maxLines = Math.max(1, Math.min(2, options?.maxLines ?? CAPTION_MAX_LINES));
  const charsPerLine =
    options?.maxCharsPerLine ??
    estimateCaptionCharsPerLine(
      options?.videoWidth ?? 1280,
      options?.videoHeight ?? 720,
      options?.fontSizeScale ?? 1.0
    );

  const result: CaptionSegment[] = [];

  for (const cap of captions) {
    const rawText = String(cap.text || '').trim();
    if (!rawText) continue;

    const lines = wrapCaptionTextToLines(rawText, charsPerLine);
    if (lines.length === 0) continue;

    const lineChunks: string[][] = [];
    for (let i = 0; i < lines.length; i += maxLines) {
      lineChunks.push(lines.slice(i, i + maxLines));
    }

    if (lineChunks.length === 1) {
      result.push({
        ...cap,
        text: lineChunks[0].join('\n'),
      });
      continue;
    }

    const start = Number(cap.start || 0);
    const end = Math.max(start + 0.2, Number(cap.end || start + 2));
    const totalDur = end - start;
    const weights = lineChunks.map((chunk) => Math.max(2, countCharacters(chunk.join(' '))));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let cursor = start;
    lineChunks.forEach((chunk, idx) => {
      const partDur = (weights[idx] / totalWeight) * totalDur;
      const chunkStart = Math.round(cursor * 1000) / 1000;
      const chunkEnd =
        idx === lineChunks.length - 1
          ? Math.round(end * 1000) / 1000
          : Math.round(Math.min(end, cursor + partDur) * 1000) / 1000;
      cursor = chunkEnd;
      result.push({
        id: `${cap.id}_p${idx + 1}`,
        start: chunkStart,
        end: Math.max(chunkStart + 0.15, chunkEnd),
        text: chunk.join('\n'),
        emoji: cap.emoji,
      });
    });
  }

  return result;
}

export function generateAssSubtitles(
  captions: CaptionSegment[],
  videoWidth: number,
  videoHeight: number,
  position: OverlayPosition,
  decoration?: Partial<CaptionDecorationConfig> | null
): string {
  const deco = sanitizeCaptionDecoration(decoration);
  const clampedPosY = Math.min(100 - CAPTION_BOTTOM_SAFETY_MARGIN_PCT - 4, Math.max(8, position.y));
  const clampedPosX = Math.min(100 - 15, Math.max(15, position.x));
  const posX = Math.round((clampedPosX / 100) * videoWidth);
  const posY = Math.round((clampedPosY / 100) * videoHeight);
  const fontSize = Math.max(20, Math.round(videoHeight * 0.045 * deco.fontSizeScale));
  const primaryColour = hexToAssColor(deco.textColor, 100);
  const outlineColour = hexToAssColor(deco.borderColor, 100);
  const outlineWidth = deco.borderEnabled ? deco.borderThickness : 0;
  const bgBoxColour = hexToAssColor(deco.bgColor, deco.bgOpacity);
  const bgBoxPad = Math.max(6, Math.round(deco.bgCornerRadius * 0.55));
  const showBgBox = deco.blurBgEnabled && deco.bgOpacity > 0;
  // Constrain ASS horizontal box margins to 72% usable width (14% margin left/right) and >=9% bottom margin
  const sideMarginPx = Math.max(24, Math.round(videoWidth * ((100 - CAPTION_BOX_MAX_WIDTH_PCT) / 200)));
  const verticalMarginPx = Math.max(20, Math.round(videoHeight * (CAPTION_BOTTOM_SAFETY_MARGIN_PCT / 100)));

  const normalizedCaptions = splitLongCaptionsToMaxTwoLines(captions, {
    videoWidth,
    videoHeight,
    fontSizeScale: deco.fontSizeScale,
  });

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: RecapBg,Noto Sans Myanmar,${fontSize},&HFF000000,&HFF000000,${bgBoxColour},${bgBoxColour},1,0,0,0,100,100,0,0,3,${bgBoxPad},0,5,${sideMarginPx},${sideMarginPx},${verticalMarginPx},1
Style: RecapMain,Noto Sans Myanmar,${fontSize},${primaryColour},&H003B82F6,${outlineColour},&H00000000,1,0,0,0,100,100,0,0,1,${outlineWidth},${deco.borderEnabled ? 1 : 0},5,${sideMarginPx},${sideMarginPx},${verticalMarginPx},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = normalizedCaptions
    .filter((c) => c.text.trim().length > 0 && c.end > c.start)
    .flatMap((c) => {
      const cleanText = `${c.text.trim()}${c.emoji ? ' ' + c.emoji.trim() : ''}`
        .replace(/\r?\n/g, '\\N')
        .replace(/[{}]/g, '');
      const startAss = formatAssTime(c.start);
      const endAss = formatAssTime(c.end);
      const lines: string[] = [];
      if (showBgBox) {
        lines.push(
          `Dialogue: 0,${startAss},${endAss},RecapBg,,0,0,0,,{\\pos(${posX},${posY})\\fad(120,120)}${cleanText}`
        );
      }
      lines.push(
        `Dialogue: 1,${startAss},${endAss},RecapMain,,0,0,0,,{\\pos(${posX},${posY})\\fad(120,120)}${cleanText}`
      );
      return lines;
    })
    .join('\n');

  return header + events + '\n';
}

export const UPLOAD_CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MiB (safe under Cloud Run 32 MiB HTTP/1 cap)
export const MAX_UPLOAD_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export interface UploadChunkPlan {
  useChunked: boolean;
  chunkSizeBytes: number;
  totalChunks: number;
  totalBytes: number;
}

export function validateUploadFileSize(fileSizeBytes: number): { valid: boolean; errorMy?: string } {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    return { valid: false, errorMy: 'ဗီဒီယိုဖိုင် အရွယ်အစား မမှန်ကန်ပါ (ဖိုင်အလွတ် ဖြစ်နေသည်)' };
  }
  if (fileSizeBytes > MAX_UPLOAD_FILE_BYTES) {
    return { valid: false, errorMy: 'ဗီဒီယိုဖိုင်သည် 2GB ထက် မကြီးရပါ — ဖိုင်အရွယ်အစား လျှော့ချပြီး ထပ်တင်ပါ' };
  }
  return { valid: true };
}

export function computeUploadChunkPlan(
  fileSizeBytes: number,
  chunkSizeBytes = UPLOAD_CHUNK_SIZE_BYTES
): UploadChunkPlan {
  const safeTotal = Math.max(1, Math.floor(Number.isFinite(fileSizeBytes) ? fileSizeBytes : 1));
  const safeChunk = Math.max(64 * 1024, Math.floor(chunkSizeBytes));
  const useChunked = safeTotal > safeChunk;
  const totalChunks = useChunked ? Math.ceil(safeTotal / safeChunk) : 1;
  return {
    useChunked,
    chunkSizeBytes: safeChunk,
    totalChunks,
    totalBytes: safeTotal,
  };
}

export function parseDurationTagToSeconds(rawTag: unknown): number {
  if (typeof rawTag === 'number' && Number.isFinite(rawTag) && rawTag > 0) {
    return rawTag;
  }
  const str = String(rawTag || '').trim();
  if (!str) return 0;
  const asNum = Number(str);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;

  const hmsMatch = str.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (hmsMatch) {
    const h = Number(hmsMatch[1]);
    const m = Number(hmsMatch[2]);
    const s = Number(hmsMatch[3]);
    return h * 3600 + m * 60 + s;
  }
  return 0;
}

export function extractMediaDurationSeconds(ffprobeInfo: {
  format?: { duration?: unknown; tags?: Record<string, unknown> };
  streams?: Array<{ codec_type?: string; duration?: unknown; tags?: Record<string, unknown> }>;
}): number {
  const candidates: number[] = [];
  candidates.push(parseDurationTagToSeconds(ffprobeInfo.format?.duration));
  candidates.push(parseDurationTagToSeconds(ffprobeInfo.format?.tags?.DURATION));
  for (const st of ffprobeInfo.streams || []) {
    candidates.push(parseDurationTagToSeconds(st.duration));
    candidates.push(parseDurationTagToSeconds(st.tags?.DURATION));
  }
  const valid = candidates.filter((d) => Number.isFinite(d) && d > 0);
  return valid.length > 0 ? Math.max(...valid) : 0;
}

export interface ContainedVideoRect {
  width: number;
  height: number;
  aspectRatio: number;
}

/**
 * Computes the exact rendered box dimensions for a video displayed with object-fit: contain
 * inside a preview container without any stretching or aspect-ratio distortion.
 */
export function computeContainedVideoRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): ContainedVideoRect {
  const safeCW = Math.max(1, Number.isFinite(containerWidth) ? containerWidth : 640);
  const safeCH = Math.max(1, Number.isFinite(containerHeight) ? containerHeight : 360);
  const safeVW = Math.max(1, Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 1280);
  const safeVH = Math.max(1, Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 720);

  const videoAspect = safeVW / safeVH;
  const containerAspect = safeCW / safeCH;

  if (videoAspect > containerAspect) {
    // Letterboxed top/bottom: full width, proportional height
    const width = Math.round(safeCW);
    const height = Math.max(1, Math.round(safeCW / videoAspect));
    return { width, height, aspectRatio: Number(videoAspect.toFixed(4)) };
  }
  // Pillarboxed left/right or exact fit: full height, proportional width
  const height = Math.round(safeCH);
  const width = Math.max(1, Math.round(safeCH * videoAspect));
  return { width, height, aspectRatio: Number(videoAspect.toFixed(4)) };
}

/**
 * Converts pointer coordinates against the ACTUAL rendered video viewport box into clamped
 * percentages [0..100] of the original video resolution, ensuring overlays stay strictly inside
 * the real video boundary and respect bottom/edge safety margins when requested.
 */
export function clampPointerToVideoViewport(params: {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; width: number; height: number };
  overlayWidthPx?: number;
  overlayHeightPx?: number;
  bottomSafetyMarginPct?: number;
  topSafetyMarginPct?: number;
  sideSafetyMarginPct?: number;
}): OverlayPosition {
  const {
    clientX,
    clientY,
    rect,
    overlayWidthPx = 0,
    overlayHeightPx = 0,
    bottomSafetyMarginPct = 0,
    topSafetyMarginPct = 0,
    sideSafetyMarginPct = 0,
  } = params;
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);

  const halfWPct = overlayWidthPx > 0 ? Math.min(48, (overlayWidthPx / w) * 50) : 6;
  const halfHPct = overlayHeightPx > 0 ? Math.min(44, (overlayHeightPx / h) * 50) : 6;

  const rawX = ((clientX - rect.left) / w) * 100;
  const rawY = ((clientY - rect.top) / h) * 100;

  const minX = Math.min(49, halfWPct + sideSafetyMarginPct);
  const maxX = Math.max(minX, 100 - halfWPct - sideSafetyMarginPct);
  const minY = Math.min(49, halfHPct + topSafetyMarginPct);
  const maxY = Math.max(minY, 100 - halfHPct - bottomSafetyMarginPct);

  return {
    x: Math.round(Math.min(maxX, Math.max(minX, rawX)) * 10) / 10,
    y: Math.round(Math.min(maxY, Math.max(minY, rawY)) * 10) / 10,
  };
}



