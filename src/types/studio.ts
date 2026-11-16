export type StudioTool = 'recap' | 'dubbing' | 'captions';

export type VoiceGender = 'male' | 'female';

export type MyanmarVoiceId = 'street_bro' | 'thriller_narrator' | 'dramatic_story';

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type VoiceSpeed = number | 'slow' | 'normal' | 'fast' | '2x';

export type CaptionAnimationStyle = 'pop' | 'glow' | 'slide';

export type CaptionFontSizePreset = 'small' | 'medium' | 'large';

export interface CaptionDecorationConfig {
  fontSizePreset: CaptionFontSizePreset;
  fontSizeScale: number; // 0.7..1.7
  textColor: string; // #RRGGBB
  borderEnabled: boolean;
  borderThickness: number; // 1..10
  borderColor: string; // #RRGGBB
  blurBgEnabled: boolean;
  blurIntensity: number; // 0..24 px
  bgOpacity: number; // 0..100 %
  bgColor: string; // #RRGGBB
  bgCornerRadius: number; // 0..28 px
}

export type AutoBlurStyle = 'blur' | 'pixelate' | 'solid';

export interface AutoBlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MusicMood = 'thriller' | 'action' | 'emotional' | 'none';

export type ExportResolution = '1080p' | '4k';

export type ThumbnailAspectRatio = '16:9' | '9:16' | '1.91:1' | '1:1';

export type ThumbnailSubjectCategory =
  | 'person'
  | 'product'
  | 'food'
  | 'travel_scene'
  | 'tech_device'
  | 'action_moment'
  | 'surprising_scene';

export type ThumbnailTextPosition = 'top' | 'bottom';

export type ThumbnailAccentTheme = 'gold' | 'crimson' | 'electric_blue' | 'emerald';

export interface ThumbnailAnalysis {
  frameUrl: string;
  bestFrameIndex: number;
  frameTimestamp: number;
  subjectCategory: ThumbnailSubjectCategory;
  subjectLabelMy: string;
  subjectSummaryMy: string;
  headlineMy: string;
  focusX: number;
  focusY: number;
  textPosition: ThumbnailTextPosition;
  accentTheme: ThumbnailAccentTheme;
  aspectRatio: ThumbnailAspectRatio;
  usedVisionModel: boolean;
}

export type PaymentMethod = 'kbzpay' | 'promptpay';

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  emoji: string;
}

export interface OverlayPosition {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
}

export interface CreditPackage {
  id: string;
  nameMy: string;
  credits: number;
  priceMmk: number;
  priceThb: number;
  descriptionMy: string;
}

export interface PipelineProgress {
  step: number;
  totalSteps: number;
  labelMy: string;
  percent: number;
}

export interface ServerCapabilities {
  ffmpegAvailable: boolean;
  ytDlpAvailable: boolean;
  geminiConfigured: boolean;
  groqConfigured: boolean;
  telegramConfigured: boolean;
}

export type SegmentKind = 'speaking' | 'silence';

export interface TranscriptSegment {
  id: string;
  kind?: SegmentKind;
  start: number;
  end: number;
  text: string;
}

export interface VideoTimelineSegment {
  id: string;
  kind: SegmentKind;
  start: number;
  end: number;
  duration: number;
  text: string;
  myanmarText: string;
  emoji: string;
  aiVoiceDuration: number;
  setptsFactor: number;
  videoPlaybackRate: number;
  outputStart: number;
  outputEnd: number;
}

export interface SyncSummary {
  tool?: StudioTool;
  segmentCount: number;
  speakingSegmentCount?: number;
  silenceSegmentCount?: number;
  preservedSilenceDuration?: number;
  originalVideoDuration: number;
  aiVoiceDuration: number;
  finalVideoDuration?: number;
  videoPlaybackRate: number;
  voiceSpeed: VoiceSpeed;
  voiceGender?: VoiceGender;
}

