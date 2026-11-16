import type {
  ThumbnailAccentTheme,
  ThumbnailAnalysis,
  ThumbnailAspectRatio,
  ThumbnailSubjectCategory,
  ThumbnailTextPosition,
} from '../types/studio';
import { countCharacters, truncateThumbnailTitle } from './studioLogic';

export interface ThumbnailPlatformPreset {
  ratio: ThumbnailAspectRatio;
  platformMy: string;
  shortLabel: string;
  width: number;
  height: number;
  cssAspectRatio: string;
}

export const PLATFORM_THUMBNAIL_PRESETS: ThumbnailPlatformPreset[] = [
  {
    ratio: '16:9',
    platformMy: 'YouTube (16:9)',
    shortLabel: 'YouTube',
    width: 1280,
    height: 720,
    cssAspectRatio: '16 / 9',
  },
  {
    ratio: '9:16',
    platformMy: 'TikTok / Reels (9:16)',
    shortLabel: 'TikTok / Reels',
    width: 1080,
    height: 1920,
    cssAspectRatio: '9 / 16',
  },
  {
    ratio: '1.91:1',
    platformMy: 'Facebook Feed (1.91:1)',
    shortLabel: 'Facebook Feed',
    width: 1200,
    height: 628,
    cssAspectRatio: '1.91 / 1',
  },
  {
    ratio: '1:1',
    platformMy: 'Instagram Post (1:1)',
    shortLabel: 'Instagram',
    width: 1080,
    height: 1080,
    cssAspectRatio: '1 / 1',
  },
];

export const SUBJECT_CATEGORY_LABELS_MY: Record<ThumbnailSubjectCategory, string> = {
  person: 'လူပုဂ္ဂိုလ် (Person)',
  product: 'ကုန်ပစ္စည်း (Product)',
  food: 'အစားအစာ (Food)',
  travel_scene: 'ခရီးသွားမြင်ကွင်း (Travel Scene)',
  tech_device: 'နည်းပညာပစ္စည်း (Tech Device)',
  action_moment: 'အက်ရှင်အခိုက်အတန့် (Action Moment)',
  surprising_scene: 'အံ့ဩဖွယ်ရာမြင်ကွင်း (Surprising Scene)',
};

export function normalizeThumbnailAspectRatio(raw?: string | null): ThumbnailAspectRatio {
  if (raw === '9:16' || raw === '1.91:1' || raw === '1:1' || raw === '16:9') {
    return raw;
  }
  return '16:9';
}

export function getThumbnailPreset(ratio: ThumbnailAspectRatio): ThumbnailPlatformPreset {
  return (
    PLATFORM_THUMBNAIL_PRESETS.find((p) => p.ratio === ratio) ||
    PLATFORM_THUMBNAIL_PRESETS[0]
  );
}

export function getThumbnailDimensions(ratio: ThumbnailAspectRatio): { width: number; height: number } {
  const preset = getThumbnailPreset(ratio);
  return { width: preset.width, height: preset.height };
}

export function suggestDefaultAspectRatio(videoWidth: number, videoHeight: number): ThumbnailAspectRatio {
  if (videoHeight > videoWidth * 1.15) {
    return '9:16';
  }
  if (Math.abs(videoWidth - videoHeight) <= Math.max(videoWidth, videoHeight) * 0.1) {
    return '1:1';
  }
  return '16:9';
}

export function computeCandidateFrameTimestamps(
  durationSeconds: number,
  maxFrames = 6
): number[] {
  const safeDur = Math.max(1, Number.isFinite(durationSeconds) ? durationSeconds : 1);
  const count = Math.max(1, Math.min(8, Math.round(maxFrames)));
  if (count === 1 || safeDur < 1.5) {
    return [Number((safeDur * 0.35).toFixed(2))];
  }
  const startFrac = 0.1;
  const endFrac = 0.88;
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const frac = startFrac + ((endFrac - startFrac) * i) / (count - 1);
    timestamps.push(Number(Math.min(Math.max(0.1, safeDur * frac), safeDur - 0.1).toFixed(2)));
  }
  return timestamps;
}

export interface FocalCropRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
}

/**
 * Computes source crop rectangle on the real video frame that fills dstW x dstH cleanly
 * while keeping the detected main subject (focusX%, focusY%) visible and centered.
 */
export function computeFocalCoverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  focusX = 50,
  focusY = 50
): FocalCropRect {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const safeDstW = Math.max(1, dstW);
  const safeDstH = Math.max(1, dstH);

  const srcAspect = safeSrcW / safeSrcH;
  const dstAspect = safeDstW / safeDstH;

  const clampedX = Math.min(90, Math.max(10, Number.isFinite(focusX) ? focusX : 50)) / 100;
  const clampedY = Math.min(90, Math.max(10, Number.isFinite(focusY) ? focusY : 50)) / 100;

  if (srcAspect > dstAspect) {
    // Source is wider than target aspect: crop horizontally around focusX
    const sHeight = safeSrcH;
    const sWidth = Math.min(safeSrcW, sHeight * dstAspect);
    const idealLeft = clampedX * safeSrcW - sWidth / 2;
    const sx = Math.max(0, Math.min(safeSrcW - sWidth, idealLeft));
    return { sx, sy: 0, sWidth, sHeight };
  }

  // Source is taller or matches target aspect: crop vertically around focusY
  const sWidth = safeSrcW;
  const sHeight = Math.min(safeSrcH, sWidth / dstAspect);
  const idealTop = clampedY * safeSrcH - sHeight / 2;
  const sy = Math.max(0, Math.min(safeSrcH - sHeight, idealTop));
  return { sx: 0, sy, sWidth, sHeight };
}

export interface RawVisionThumbnailResponse {
  bestFrameIndex?: unknown;
  subjectCategory?: unknown;
  subjectSummaryMy?: unknown;
  headlineMy?: unknown;
  focusX?: unknown;
  focusY?: unknown;
  textPosition?: unknown;
  accentTheme?: unknown;
}

const VALID_CATEGORIES = new Set<ThumbnailSubjectCategory>([
  'person',
  'product',
  'food',
  'travel_scene',
  'tech_device',
  'action_moment',
  'surprising_scene',
]);

const VALID_THEMES = new Set<ThumbnailAccentTheme>([
  'gold',
  'crimson',
  'electric_blue',
  'emerald',
]);

export function sanitizeThumbnailAnalysisResponse(
  raw: RawVisionThumbnailResponse,
  candidateTimestamps: number[],
  frameUrls: string[],
  aspectRatio: ThumbnailAspectRatio,
  fallbackHeadline: string,
  usedVisionModel: boolean
): ThumbnailAnalysis {
  const maxIdx = Math.max(0, Math.min(candidateTimestamps.length, frameUrls.length) - 1);
  const parsedIdx = Number(raw.bestFrameIndex);
  const bestFrameIndex =
    Number.isInteger(parsedIdx) && parsedIdx >= 0 && parsedIdx <= maxIdx ? parsedIdx : 0;

  const subjectCategory: ThumbnailSubjectCategory = VALID_CATEGORIES.has(
    raw.subjectCategory as ThumbnailSubjectCategory
  )
    ? (raw.subjectCategory as ThumbnailSubjectCategory)
    : 'surprising_scene';

  const parsedX = Number(raw.focusX);
  const parsedY = Number(raw.focusY);
  const focusX = Number.isFinite(parsedX) ? Math.min(85, Math.max(15, Math.round(parsedX))) : 50;
  const focusY = Number.isFinite(parsedY) ? Math.min(85, Math.max(15, Math.round(parsedY))) : 45;

  let textPosition: ThumbnailTextPosition;
  if (raw.textPosition === 'top' || raw.textPosition === 'bottom') {
    textPosition = raw.textPosition;
  } else {
    // Keep bold text opposite the subject center so it never obscures a face/item
    textPosition = focusY > 62 ? 'top' : 'bottom';
  }

  const accentTheme: ThumbnailAccentTheme = VALID_THEMES.has(
    raw.accentTheme as ThumbnailAccentTheme
  )
    ? (raw.accentTheme as ThumbnailAccentTheme)
    : 'gold';

  const rawHeadline = String(raw.headlineMy || '').trim();
  const headlineMy =
    truncateThumbnailTitle(rawHeadline) ||
    truncateThumbnailTitle(fallbackHeadline) ||
    'ဗီဒီယိုအနှစ်ချုပ်';

  const subjectSummaryMy =
    String(raw.subjectSummaryMy || '').trim() ||
    `${SUBJECT_CATEGORY_LABELS_MY[subjectCategory]} ကို ဗီဒီယိုမှ တိုက်ရိုက်ရွေးချယ်ထားသည်`;

  return {
    frameUrl: frameUrls[bestFrameIndex] || frameUrls[0] || '',
    bestFrameIndex,
    frameTimestamp: candidateTimestamps[bestFrameIndex] ?? 0,
    subjectCategory,
    subjectLabelMy: SUBJECT_CATEGORY_LABELS_MY[subjectCategory],
    subjectSummaryMy,
    headlineMy,
    focusX,
    focusY,
    textPosition,
    accentTheme,
    aspectRatio,
    usedVisionModel,
  };
}

export interface AccentPalette {
  barColor: string;
  badgeBg: string;
  badgeText: string;
  highlightColor: string;
}

export function getAccentPalette(theme: ThumbnailAccentTheme): AccentPalette {
  switch (theme) {
    case 'crimson':
      return {
        barColor: '#EF4444',
        badgeBg: 'rgba(239, 68, 68, 0.92)',
        badgeText: '#FFFFFF',
        highlightColor: '#FEE2E2',
      };
    case 'electric_blue':
      return {
        barColor: '#3B82F6',
        badgeBg: 'rgba(37, 99, 235, 0.92)',
        badgeText: '#FFFFFF',
        highlightColor: '#DBEAFE',
      };
    case 'emerald':
      return {
        barColor: '#10B981',
        badgeBg: 'rgba(5, 150, 105, 0.92)',
        badgeText: '#FFFFFF',
        highlightColor: '#D1FAE5',
      };
    case 'gold':
    default:
      return {
        barColor: '#FACC15',
        badgeBg: 'rgba(250, 204, 21, 0.96)',
        badgeText: '#090B10',
        highlightColor: '#FEF08A',
      };
  }
}

export function wrapHeadlineLines(headline: string, maxCharsPerLine: number): string[] {
  const clean = headline.replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  if (countCharacters(clean) <= maxCharsPerLine) return [clean];

  const words = clean.split(' ');
  if (words.length >= 2) {
    let bestSplitIdx = 1;
    let bestBalance = Number.POSITIVE_INFINITY;
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i).join(' ');
      const diff = Math.abs(countCharacters(left) - countCharacters(right));
      if (diff < bestBalance) {
        bestBalance = diff;
        bestSplitIdx = i;
      }
    }
    return [words.slice(0, bestSplitIdx).join(' '), words.slice(bestSplitIdx).join(' ')];
  }

  // Single unbroken Myanmar phrase without spaces: split evenly by grapheme count
  const graphemes =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter('my', { granularity: 'grapheme' }).segment(clean), (s) => s.segment)
      : Array.from(clean);
  const mid = Math.ceil(graphemes.length / 2);
  return [graphemes.slice(0, mid).join(''), graphemes.slice(mid).join('')];
}
