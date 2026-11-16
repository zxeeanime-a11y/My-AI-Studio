import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Coins,
  Download,
  Film,
  ImagePlus,
  Link2,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Sparkles,
  Subtitles,
  Upload,
  User,
  Wand2,
} from 'lucide-react';
import { VideoStage } from './VideoStage';
import { ContentThumbnailPreview } from './ContentThumbnailPreview';
import {
  CAPTION_FONT_SIZE_PRESETS,
  countCharacters,
  formatTimecode,
  formatVoiceGenderLabelMy,
  formatVoiceSpeedLabel,
  getVoiceSpeedFactor,
  truncateThumbnailTitle,
  VOICE_SPEED_STEPS,
} from '../utils/studioLogic';
import { getThumbnailPreset, PLATFORM_THUMBNAIL_PRESETS } from '../utils/thumbnailLogic';
import type {
  AutoBlurRegion,
  AutoBlurStyle,
  CaptionAnimationStyle,
  CaptionDecorationConfig,
  CaptionSegment,
  ExportResolution,
  MusicMood,
  MyanmarVoiceId,
  OverlayPosition,
  PipelineProgress,
  StudioTool,
  SyncSummary,
  ThumbnailAnalysis,
  ThumbnailAspectRatio,
  VoiceGender,
  VoiceSpeed,
} from '../types/studio';

/* ---------- Step 1: Link paste or MP4 upload ---------- */
interface Step1Props {
  activeTool: StudioTool;
  onChangeTool: (t: StudioTool) => void;
  linkInput: string;
  onChangeLinkInput: (v: string) => void;
  onSubmitLink: () => void;
  onUploadMp4: (f: File) => void;
  onLoadSample: () => void;
  sourceLoading: boolean;
  uploadPercent?: number | null;
  videoUrl: string | null;
  videoTitle: string;
  durationSeconds: number;
  onNext: () => void;
}

export const WizardStep1Video: React.FC<Step1Props> = ({
  activeTool,
  onChangeTool,
  linkInput,
  onChangeLinkInput,
  onSubmitLink,
  onUploadMp4,
  onLoadSample,
  sourceLoading,
  uploadPercent = null,
  videoUrl,
  videoTitle,
  durationSeconds,
  onNext,
}) => (
  <section className="mx-auto max-w-2xl glass-panel rounded-2xl p-5 sm:p-7 space-y-6">
    <div>
      <span className="text-xs font-semibold text-blue-400">အဆင့် ၁ / ၆</span>
      <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-slate-100">
        ဗီဒီယိုလင့်ခ် သို့မဟုတ် MP4 ဖိုင် ထည့်သွင်းပါ
      </h1>
      <p className="mt-1 text-xs sm:text-sm text-slate-400">
        YouTube, TikTok, Facebook, Instagram လင့်ခ် သို့မဟုတ် MP4 ဖိုင် (အများဆုံး ၁၂၀ မိနစ်)
      </p>
    </div>

    {/* 3 Main Tools */}
    <div>
      <span className="block text-xs font-medium text-slate-300 mb-2">အသုံးပြုမည့် Tool ရွေးချယ်ပါ</span>
      <div role="tablist" aria-label="အဓိက Tools များ" className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-[#090B10] p-1.5">
        {([
          { id: 'recap', label: 'Movie Recap', icon: Film },
          { id: 'dubbing', label: 'မြန်မာအသံသွင်း', icon: Mic },
          { id: 'captions', label: 'စာတန်းသီးသန့်', icon: Subtitles },
        ] as const).map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChangeTool(tool.id)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                active ? 'bg-blue-600 text-white blue-glow-cta' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{tool.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] sm:text-xs text-slate-400">
        {activeTool === 'recap'
          ? '• ဗီဒီယိုတစ်ခုလုံးအတွက် မြန်မာ Recap ဇာတ်ညွှန်းနှင့် AI အသံအသစ် (1.0x ~ 2.0x) ဖန်တီးပြီး ဗီဒီယိုတစ်ခုလုံးကို ညှိပေးမည်'
          : activeTool === 'dubbing'
            ? '• စကားပြောအပိုင်းတွင်သာ AI အသံအမြန်နှုန်း (1.0x ~ 2.0x) အတိုင်း ညှိပေးပြီး တိတ်ဆိတ်အပိုင်းများကို မူရင်း 1.0x အတိုင်း ထားမည်'
            : '• ဗီဒီယို၏ မူရင်းအသံကို မပြောင်းလဲဘဲ Dynamic မြန်မာစာတန်းများသာ ထည့်သွင်းပေးမည်'}
      </p>
    </div>

    {/* Public Link Input */}
    <div className="space-y-2">
      <label htmlFor="wizard-link-input" className="block text-xs font-medium text-slate-300">
        အများသုံး ဗီဒီယိုလင့်ခ် ထည့်ရန်
      </label>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id="wizard-link-input"
            type="url"
            value={linkInput}
            onChange={(e) => onChangeLinkInput(e.target.value)}
            placeholder="YouTube, TikTok, Facebook, Instagram လင့်ခ်ကူးထည့်ပါ"
            className="w-full rounded-xl border border-white/15 bg-[#090B10] py-3 pl-10 pr-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onSubmitLink}
          disabled={sourceLoading || !linkInput.trim()}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs sm:text-sm font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          လင့်ခ်စစ်ဆေးမည်
        </button>
      </div>
    </div>

    {/* MP4 Upload & Sample Quick Load */}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-center gap-2.5 rounded-xl border border-dashed border-blue-500/45 bg-blue-500/10 px-4 py-4 text-sm font-semibold text-blue-300 hover:bg-blue-500/15 transition-colors cursor-pointer">
        <Upload className="h-4 w-4 shrink-0" />
        <span>
          {uploadPercent !== null
            ? `တင်သွင်းနေသည် (${uploadPercent}%)...`
            : 'MP4 ဖိုင်တင်မည်'}
        </span>
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/*"
          disabled={sourceLoading}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUploadMp4(file);
          }}
        />
      </label>

      <button
        type="button"
        onClick={onLoadSample}
        disabled={sourceLoading}
        className="flex items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-4 text-sm font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 transition-colors cursor-pointer"
      >
        <Film className="h-4 w-4 text-blue-400 shrink-0" />
        <span>{sourceLoading ? 'ဖတ်နေပါသည်...' : 'နမူနာရုပ်ရှင် ဖွင့်ကြည့်ရန်'}</span>
      </button>
    </div>

    {/* Ready Confirmation */}
    {videoUrl && (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-500/35 bg-blue-500/10 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="truncate text-xs sm:text-sm font-medium text-blue-100">
            {videoTitle || 'ဗီဒီယို အဆင်သင့်ဖြစ်ပါပြီ'}
          </span>
        </div>
        <span className="font-mono-tabular text-xs font-semibold text-blue-300 shrink-0">
          {formatTimecode(durationSeconds)}
        </span>
      </div>
    )}

    <div className="flex justify-end pt-2 border-t border-white/10">
      <button
        type="button"
        onClick={onNext}
        disabled={!videoUrl || sourceLoading}
        className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 disabled:opacity-40 transition-colors cursor-pointer"
      >
        <span>ရှေ့ဆက်မည်</span>
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  </section>
);

/* ---------- Step 2: Myanmar Voice Selection & Voice Speed ---------- */
interface Step2Props {
  activeTool: StudioTool;
  voiceGender: VoiceGender | null;
  onChangeVoiceGender: (g: VoiceGender) => void;
  voiceStyle: MyanmarVoiceId;
  onChangeVoiceStyle: (v: MyanmarVoiceId) => void;
  voiceSpeed: VoiceSpeed;
  onChangeVoiceSpeed: (s: VoiceSpeed) => void;
  musicMood: MusicMood;
  onChangeMusicMood: (m: MusicMood) => void;
  sfxEnabled: boolean;
  onToggleSfx: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}

const VOICE_OPTIONS: Array<{ id: MyanmarVoiceId; nameMy: string; descMy: string }> = [
  {
    id: 'street_bro',
    nameMy: 'ရန်ကုန်လမ်းဘေးစကားပြော (Street Slang)',
    descMy: 'YouTube / TikTok Movie Recap များအတွက် သွက်လက်ဆွဲဆောင်မှုရှိသော စကားပြောပုံစံ',
  },
  {
    id: 'thriller_narrator',
    nameMy: 'သည်းထိတ်ရင်ဖို ဇာတ်ကြောင်းပြန် (Suspense)',
    descMy: 'လျှို့ဝှက်ဆန်းကြယ်နှင့် Action ဇာတ်ကားများအတွက် စိတ်လှုပ်ရှားဖွယ်ရာ အသံ',
  },
  {
    id: 'dramatic_story',
    nameMy: 'ခံစားချက်ဇာတ်လမ်းပြော (Dramatic Story)',
    descMy: 'ဒရာမာနှင့် ဇာတ်ရှိန်မြင့် ဇာတ်ဝင်ခန်းများအတွက် ခံစားမှုအပြည့် အသံ',
  },
];

export const WizardStep2Voice: React.FC<Step2Props> = ({
  activeTool,
  voiceGender,
  onChangeVoiceGender,
  voiceStyle,
  onChangeVoiceStyle,
  voiceSpeed,
  onChangeVoiceSpeed,
  musicMood,
  onChangeMusicMood,
  sfxEnabled,
  onToggleSfx,
  onBack,
  onNext,
}) => (
  <section className="mx-auto max-w-2xl glass-panel rounded-2xl p-5 sm:p-7 space-y-6">
    <div>
      <span className="text-xs font-semibold text-blue-400">အဆင့် ၂ / ၆</span>
      <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-slate-100">
        {activeTool === 'captions'
          ? 'မူရင်းအသံနှင့် Dynamic စာတန်း စစ်ဆေးပါ'
          : 'မြန်မာအသံ (Male / Female) နှင့် အမြန်နှုန်း ရွေးချယ်ပါ'}
      </h1>
      <p className="mt-1 text-xs sm:text-sm text-slate-400">
        {activeTool === 'recap'
          ? 'ဗီဒီယိုတစ်ခုလုံးအတွက် Male / Female AI အသံနှင့် 1.0x မှ 2.0x အမြန်နှုန်း ရွေးချယ်ပြီး ဗီဒီယိုတစ်ခုလုံးကို ညှိပေးမည်'
          : activeTool === 'dubbing'
            ? 'စကားပြောအပိုင်းများတွင်သာ Male / Female AI အသံနှင့် 1.0x မှ 2.0x အမြန်နှုန်းအတိုင်း ညှိပေးပြီး တိတ်ဆိတ်အပိုင်းများကို မူရင်း 1.0x အတိုင်း ထားရှိမည်'
            : 'မူရင်းအသံ (1.0x) ကို ဆက်လက်ထားရှိပြီး Dynamic မြန်မာစာတန်းများသာ ထည့်သွင်းပေးမည်'}
      </p>
    </div>

    {activeTool === 'captions' ? (
      <div
        data-testid="captions-only-no-speed-notice"
        className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-xs sm:text-sm text-blue-200 leading-relaxed"
      >
        “စာတန်းသီးသန့်” Tool ကို ရွေးချယ်ထားသဖြင့် AI အသံ (Male / Female) နှင့် အမြန်နှုန်း ပြောင်းလဲခြင်း မပါဝင်ဘဲ မူရင်းအသံ (1.0x) ဖြင့် Animated Myanmar Captions များကိုသာ ထည့်သွင်းပေးမည်ဖြစ်ပါသည်။
      </div>
    ) : (
      <>
        {/* Required Voice Gender Selection (Movie Recap & Myanmar Dubbing Only) */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="block text-xs font-medium text-slate-300">
              AI အသံအမျိုးအစား (Male / Female Voice) ရွေးချယ်ရန် *
            </span>
            {!voiceGender && (
              <span
                data-testid="voice-gender-required-notice"
                className="text-[11px] font-medium text-amber-300"
              >
                Gemini TTS မထုတ်မီ တစ်ခုရွေးချယ်ပါ
              </span>
            )}
          </div>
          <div
            role="radiogroup"
            aria-label="AI အသံအမျိုးအစား (Male / Female)"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          >
            {([
              {
                id: 'male',
                title: 'အမျိုးသားအသံ (Male Voice)',
                desc: 'ကြည်လင်ပြတ်သားပြီး အားပါသော အမျိုးသား AI အသံ',
              },
              {
                id: 'female',
                title: 'အမျိုးသမီးအသံ (Female Voice)',
                desc: 'နွေးထွေးဆွဲဆောင်မှုရှိပြီး သဘာဝကျသော အမျိုးသမီး AI အသံ',
              },
            ] as const).map((option) => {
              const selected = voiceGender === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`voice-gender-${option.id}`}
                  onClick={() => onChangeVoiceGender(option.id)}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-blue-500 bg-blue-600/20 blue-glow-ring'
                      : 'border-white/15 bg-[#090B10]/85 hover:border-white/30'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                      selected
                        ? 'border-blue-400 bg-blue-600 text-white'
                        : 'border-white/10 bg-white/5 text-slate-400'
                    }`}
                  >
                    <User className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-100">{option.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{option.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Myanmar Voice Style Selection */}
        <div className="space-y-2.5">
          <span className="block text-xs font-medium text-slate-300">မြန်မာအသံ စတိုင် ရွေးချယ်ရန်</span>
          <div className="space-y-2.5">
            {VOICE_OPTIONS.map((v) => {
              const selected = voiceStyle === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onChangeVoiceStyle(v.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all cursor-pointer ${
                    selected
                      ? 'border-blue-500/70 bg-blue-600/15 blue-glow-ring'
                      : 'border-white/10 bg-[#090B10]/80 hover:border-white/25'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-blue-400 bg-blue-600' : 'border-slate-600'
                    }`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-100">{v.nameMy}</div>
                    <div className="mt-0.5 text-xs text-slate-400">{v.descMy}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Voice Speed: Continuous 1.0x ~ 2.0x Slider & Step Buttons (Movie Recap & Myanmar Dubbing Only) */}
        <div className="space-y-3 rounded-xl border border-white/10 bg-[#090B10] p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="voice-speed-slider" className="block text-xs font-medium text-slate-300">
              အသံအမြန်နှုန်း (1.0x မှ 2.0x အထိ)
            </label>
            <span
              data-testid="voice-speed-value"
              className="font-mono-tabular rounded-lg border border-blue-500/40 bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-300"
            >
              {formatVoiceSpeedLabel(voiceSpeed)}
            </span>
          </div>

          <input
            id="voice-speed-slider"
            data-testid="voice-speed-slider"
            type="range"
            min={1.0}
            max={2.0}
            step={0.2}
            value={Math.min(2.0, Math.max(1.0, getVoiceSpeedFactor(voiceSpeed)))}
            onChange={(e) => onChangeVoiceSpeed(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-800 accent-blue-500"
          />

          <div
            role="radiogroup"
            aria-label="အသံအမြန်နှုန်း အဆင့်များ"
            className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1"
          >
            {VOICE_SPEED_STEPS.map((stepVal) => {
              const currentFactor = getVoiceSpeedFactor(voiceSpeed);
              const isSelected = Math.abs(currentFactor - stepVal) < 0.05;
              const label = `${stepVal.toFixed(1)}x`;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  data-testid={`voice-speed-${stepVal.toFixed(1)}`}
                  onClick={() => onChangeVoiceSpeed(stepVal)}
                  className={`font-mono-tabular rounded-lg border py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-500 bg-blue-600 text-white blue-glow-cta'
                      : 'border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/25 hover:text-slate-100'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Compact Audio Crossfade Options */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2 border-t border-white/10">
          <div>
            <label htmlFor="wizard-music-mood" className="block text-xs font-medium text-slate-300">
              နောက်ခံတီးလုံး (Audio Crossfade)
            </label>
            <select
              id="wizard-music-mood"
              value={musicMood}
              onChange={(e) => onChangeMusicMood(e.target.value as MusicMood)}
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-[#090B10] px-3 py-2.5 text-xs sm:text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="thriller">Thriller (သည်းထိတ်ရင်ဖို)</option>
              <option value="action">Action (အက်ရှင်)</option>
              <option value="emotional">Emotional (ခံစားမှု)</option>
              <option value="none">တီးလုံး မထည့်ပါ</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              role="switch"
              aria-checked={sfxEnabled}
              onClick={() => onToggleSfx(!sfxEnabled)}
              className={`w-full rounded-xl border px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                sfxEnabled
                  ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                  : 'border-white/10 bg-[#090B10] text-slate-400'
              }`}
            >
              Transition SFX အသံ: {sfxEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </>
    )}

    <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>နောက်သို့</span>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={activeTool !== 'captions' && !voiceGender}
        title={activeTool !== 'captions' && !voiceGender ? 'Male Voice သို့မဟုတ် Female Voice ကို ရွေးချယ်ပါ' : undefined}
        className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
      >
        <span>ရှေ့ဆက်မည်</span>
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  </section>
);

/* ---------- Step 3: Live Video Preview + Drag Subtitle + Custom Logo ---------- */
interface Step3Props {
  videoUrl: string | null;
  videoTitle: string;
  videoWidth?: number;
  videoHeight?: number;
  sourceRevision: number;
  durationSeconds: number;
  captions: CaptionSegment[];
  onUpdateCaption: (id: string, field: 'text' | 'emoji', val: string) => void;
  onNormalizeLongCaptions?: () => void;
  captionStyle: CaptionAnimationStyle;
  onChangeCaptionStyle: (s: CaptionAnimationStyle) => void;
  captionDecoration: CaptionDecorationConfig;
  onChangeCaptionDecoration: (next: CaptionDecorationConfig) => void;
  autoBlurEnabled: boolean;
  onToggleAutoBlur: (enabled: boolean) => void;
  autoBlurStrength: number;
  onChangeAutoBlurStrength: (strength: number) => void;
  autoBlurStyle: AutoBlurStyle;
  onChangeAutoBlurStyle: (style: AutoBlurStyle) => void;
  autoBlurRegions: AutoBlurRegion[];
  autoBlurStatus: 'idle' | 'analyzing' | 'ready' | 'error';
  autoBlurError: string | null;
  onRetryAutoBlur: () => void;
  subPos: OverlayPosition;
  onChangeSubPos: (p: OverlayPosition) => void;
  logoUrl: string | null;
  logoEnabled: boolean;
  onToggleLogo: (v: boolean) => void;
  logoScale: number;
  onChangeLogoScale: (v: number) => void;
  logoPos: OverlayPosition;
  onChangeLogoPos: (p: OverlayPosition) => void;
  onUploadLogo: (f: File) => void;
  ttsAudioUrl: string | null;
  thumbnailTitle: string;
  onThumbnailCanvasReady: (b: Blob | null) => void;
  onLoadSample: () => void;
  sourceLoading: boolean;
  onBack: () => void;
  onNext: () => void;
}

const CAPTION_TEXT_SWATCHES = ['#FFFFFF', '#FACC15', '#38BDF8', '#FB923C', '#4ADE80'];
const CAPTION_BORDER_SWATCHES = ['#090B10', '#000000', '#1D4ED8', '#EF4444'];

export const WizardStep3PreviewCustomize: React.FC<Step3Props> = ({
  videoUrl,
  videoTitle,
  videoWidth = 1280,
  videoHeight = 720,
  sourceRevision,
  durationSeconds,
  captions,
  onUpdateCaption,
  onNormalizeLongCaptions,
  captionStyle,
  onChangeCaptionStyle,
  captionDecoration,
  onChangeCaptionDecoration,
  autoBlurEnabled,
  onToggleAutoBlur,
  autoBlurStrength,
  onChangeAutoBlurStrength,
  autoBlurStyle,
  onChangeAutoBlurStyle,
  autoBlurRegions,
  autoBlurStatus,
  autoBlurError,
  onRetryAutoBlur,
  subPos,
  onChangeSubPos,
  logoUrl,
  logoEnabled,
  onToggleLogo,
  logoScale,
  onChangeLogoScale,
  logoPos,
  onChangeLogoPos,
  onUploadLogo,
  ttsAudioUrl,
  thumbnailTitle,
  onThumbnailCanvasReady,
  onLoadSample,
  sourceLoading,
  onBack,
  onNext,
}) => {
  const patchDeco = (patch: Partial<CaptionDecorationConfig>) => {
    onChangeCaptionDecoration({ ...captionDecoration, ...patch });
  };

  return (
    <section className="space-y-5">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        {/* Live Video Preview visible at the same time (Top on mobile, Right on desktop) */}
        <div className="order-first lg:order-last lg:col-span-7">
          <VideoStage
            videoUrl={videoUrl}
            videoTitle={videoTitle}
            videoWidth={videoWidth}
            videoHeight={videoHeight}
            sourceRevision={sourceRevision}
            durationSeconds={durationSeconds}
            captions={captions}
            onUpdateCaption={onUpdateCaption}
            onNormalizeLongCaptions={onNormalizeLongCaptions}
            captionStyle={captionStyle}
            captionDecoration={captionDecoration}
            autoBlurEnabled={autoBlurEnabled}
            autoBlurStrength={autoBlurStrength}
            autoBlurStyle={autoBlurStyle}
            autoBlurRegions={autoBlurRegions}
            subPos={subPos}
            onChangeSubPos={onChangeSubPos}
            logoUrl={logoUrl}
            logoEnabled={logoEnabled}
            logoScale={logoScale}
            logoPos={logoPos}
            onChangeLogoPos={onChangeLogoPos}
            ttsAudioUrl={ttsAudioUrl}
            thumbnailTitle={thumbnailTitle}
            onThumbnailCanvasReady={onThumbnailCanvasReady}
            onLoadSample={onLoadSample}
            sampleLoading={sourceLoading}
            showThumbnailCard={false}
          />
        </div>

        {/* Caption & Logo Controls */}
        <div className="lg:col-span-5 glass-panel rounded-2xl p-5 space-y-5">
          <div>
            <span className="text-xs font-semibold text-blue-400">အဆင့် ၃ / ၆</span>
            <h1 className="mt-1 font-display text-lg sm:text-xl font-bold text-slate-100">
              စာတန်းစတိုင်၊ လိုဂိုနှင့် နေရာချထားမှု
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              ဗီဒီယိုပေါ်ရှိ စာတန်းကို ဆွဲရွှေ့နိုင်ပြီး နှစ်ချက်နှိပ် (Double-click) ၍ စာသားတိုက်ရိုက်ပြင်နိုင်သည်
            </p>
          </div>

          <div className="space-y-3 rounded-xl border border-blue-500/25 bg-blue-500/[0.06] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="block text-xs font-semibold text-blue-200">အလိုအလျောက် စာသားနှင့် Logo ဖုံးကွယ်ရန်</span>
                <span className="text-[11px] text-slate-400">
                  {autoBlurStatus === 'analyzing'
                    ? 'ဗီဒီယိုကို အလိုအလျောက် စစ်ဆေးနေသည်...'
                    : autoBlurStatus === 'error'
                      ? autoBlurError || 'စစ်ဆေးမှု မအောင်မြင်ပါ'
                      : autoBlurStatus === 'ready'
                        ? autoBlurRegions.length > 0
                          ? `${autoBlurRegions.length} နေရာကို အလိုအလျောက် တွေ့ရှိထားသည်`
                          : 'ဖုံးကွယ်ရမည့်စာသား သို့မဟုတ် Logo မတွေ့ပါ'
                        : 'ဗီဒီယိုတင်ပြီးနောက် အလိုအလျောက် စစ်ဆေးပါမည်'}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoBlurEnabled}
                data-testid="auto-blur-toggle"
                onClick={() => onToggleAutoBlur(!autoBlurEnabled)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  autoBlurEnabled
                    ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                    : 'border-white/10 bg-white/5 text-slate-400'
                }`}
              >
                {autoBlurEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {autoBlurStatus === 'error' && (
              <button
                type="button"
                onClick={onRetryAutoBlur}
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
              >
                ထပ်မံစစ်ဆေးရန်
              </button>
            )}

            {autoBlurEnabled && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { id: 'blur', label: 'Blur' },
                    { id: 'pixelate', label: 'Pixelate' },
                    { id: 'solid', label: 'Solid' },
                  ] as const).map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      aria-pressed={autoBlurStyle === style.id}
                      data-testid={`auto-blur-style-${style.id}`}
                      onClick={() => onChangeAutoBlurStyle(style.id)}
                      className={`rounded-lg border py-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                        autoBlurStyle === style.id
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-white/10 bg-[#090B10] text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
                {autoBlurStyle !== 'solid' && (
                  <label className="flex items-center gap-2.5 text-[11px] text-slate-300">
                    <span className="w-20 shrink-0">ပြင်းအား</span>
                    <input
                      type="range"
                      data-testid="auto-blur-strength"
                      aria-label="အလိုအလျောက် ဖုံးကွယ်မှုပြင်းအား"
                      min={2}
                      max={40}
                      step={1}
                      value={autoBlurStrength}
                      onChange={(e) => onChangeAutoBlurStrength(Number(e.target.value))}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono-tabular w-7 text-right">{autoBlurStrength}</span>
                  </label>
                )}
              </>
            )}
          </div>

          {/* Dynamic Caption Style */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-300">Dynamic စာတန်း Animation စတိုင်</span>
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-[#090B10] p-1">
              {([
                { id: 'pop', label: 'Pop' },
                { id: 'glow', label: 'Glow' },
                { id: 'slide', label: 'Slide' },
              ] as const).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onChangeCaptionStyle(st.id)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    captionStyle === st.id
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          {/* Caption Decoration & Styling Controls */}
          <div className="space-y-3.5 rounded-xl border border-white/10 bg-[#090B10]/70 p-3.5">
            <span className="block text-xs font-semibold text-blue-300">စာတန်းအလှဆင်ခြင်း (Caption Styling)</span>

            {/* Font Size: Small / Medium / Large presets + Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">စာလုံးအရွယ်အစား</span>
                <span className="font-mono-tabular text-[11px] text-blue-300">
                  {Math.round(captionDecoration.fontSizeScale * 100)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/10 bg-[#090B10] p-1">
                {([
                  { id: 'small', label: 'သေး (S)' },
                  { id: 'medium', label: 'လတ် (M)' },
                  { id: 'large', label: 'ကြီး (L)' },
                ] as const).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    data-testid={`caption-size-${preset.id}`}
                    onClick={() =>
                      patchDeco({
                        fontSizePreset: preset.id,
                        fontSizeScale: CAPTION_FONT_SIZE_PRESETS[preset.id],
                      })
                    }
                    className={`rounded-md py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                      captionDecoration.fontSizePreset === preset.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                data-testid="caption-font-size-slider"
                aria-label="စာလုံးအရွယ်အစား Slider"
                min={0.7}
                max={1.7}
                step={0.05}
                value={captionDecoration.fontSizeScale}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  const preset = val <= 0.9 ? 'small' : val >= 1.2 ? 'large' : 'medium';
                  patchDeco({ fontSizeScale: val, fontSizePreset: preset });
                }}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            {/* Text Color Picker */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
              <label htmlFor="caption-text-color-input" className="text-xs text-slate-300 shrink-0">
                စာလုံးအရောင်
              </label>
              <div className="flex items-center gap-1.5">
                {CAPTION_TEXT_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`စာလုံးအရောင် ${hex}`}
                    onClick={() => patchDeco({ textColor: hex })}
                    style={{ backgroundColor: hex }}
                    className={`h-5 w-5 rounded-full border transition-transform cursor-pointer ${
                      captionDecoration.textColor.toUpperCase() === hex
                        ? 'border-blue-400 scale-110 ring-2 ring-blue-500/50'
                        : 'border-white/25'
                    }`}
                  />
                ))}
                <input
                  id="caption-text-color-input"
                  data-testid="caption-text-color-picker"
                  type="color"
                  aria-label="စာလုံးအရောင် ရွေးရန်"
                  value={captionDecoration.textColor}
                  onChange={(e) => patchDeco({ textColor: e.target.value.toUpperCase() })}
                  className="h-6 w-8 rounded border border-white/20 bg-transparent cursor-pointer"
                />
              </div>
            </div>

            {/* Border / Outline Toggle, Thickness & Color */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">စာလုံးအနားသတ် (Border / Outline)</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={captionDecoration.borderEnabled}
                  data-testid="caption-border-toggle"
                  onClick={() => patchDeco({ borderEnabled: !captionDecoration.borderEnabled })}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    captionDecoration.borderEnabled
                      ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                      : 'border-white/10 bg-white/5 text-slate-400'
                  }`}
                >
                  {captionDecoration.borderEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              {captionDecoration.borderEnabled && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-slate-400 w-20 shrink-0">အထူ (px)</span>
                    <input
                      type="range"
                      data-testid="caption-border-thickness"
                      aria-label="အနားသတ်အထူ"
                      min={1}
                      max={10}
                      step={0.5}
                      value={captionDecoration.borderThickness}
                      onChange={(e) => patchDeco({ borderThickness: Number(e.target.value) })}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-300 w-9 text-right">
                      {captionDecoration.borderThickness}px
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="caption-border-color-input" className="text-[11px] text-slate-400">
                      အနားသတ်အရောင်
                    </label>
                    <div className="flex items-center gap-1.5">
                      {CAPTION_BORDER_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`အနားသတ်အရောင် ${hex}`}
                          onClick={() => patchDeco({ borderColor: hex })}
                          style={{ backgroundColor: hex }}
                          className={`h-5 w-5 rounded-full border cursor-pointer ${
                            captionDecoration.borderColor.toUpperCase() === hex
                              ? 'border-blue-400 ring-2 ring-blue-500/50'
                              : 'border-white/25'
                          }`}
                        />
                      ))}
                      <input
                        id="caption-border-color-input"
                        data-testid="caption-border-color-picker"
                        type="color"
                        aria-label="အနားသတ်အရောင် ရွေးရန်"
                        value={captionDecoration.borderColor}
                        onChange={(e) => patchDeco({ borderColor: e.target.value.toUpperCase() })}
                        className="h-6 w-8 rounded border border-white/20 bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Blur Mask / Semi-Transparent Background */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">နောက်ခံ Blur Mask</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={captionDecoration.blurBgEnabled}
                  data-testid="caption-blur-toggle"
                  onClick={() => patchDeco({ blurBgEnabled: !captionDecoration.blurBgEnabled })}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    captionDecoration.blurBgEnabled
                      ? 'border-blue-500/60 bg-blue-500/20 text-blue-200'
                      : 'border-white/10 bg-white/5 text-slate-400'
                  }`}
                >
                  {captionDecoration.blurBgEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              {captionDecoration.blurBgEnabled && (
                <div className="space-y-2 pl-1">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-slate-400 w-20 shrink-0">Blur ပြင်းအား</span>
                    <input
                      type="range"
                      data-testid="caption-blur-intensity"
                      aria-label="နောက်ခံ Blur ပြင်းအား"
                      min={0}
                      max={24}
                      step={1}
                      value={captionDecoration.blurIntensity}
                      onChange={(e) => patchDeco({ blurIntensity: Number(e.target.value) })}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-300 w-9 text-right">
                      {captionDecoration.blurIntensity}px
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-slate-400 w-20 shrink-0">အကြည်နှုန်း</span>
                    <input
                      type="range"
                      data-testid="caption-bg-opacity"
                      aria-label="နောက်ခံ အကြည်နှုန်း"
                      min={0}
                      max={100}
                      step={2}
                      value={captionDecoration.bgOpacity}
                      onChange={(e) => patchDeco({ bgOpacity: Number(e.target.value) })}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-300 w-9 text-right">
                      {captionDecoration.bgOpacity}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-slate-400 w-20 shrink-0">ထောင့်ဝိုင်း</span>
                    <input
                      type="range"
                      data-testid="caption-bg-radius"
                      aria-label="နောက်ခံ ထောင့်ဝိုင်း"
                      min={0}
                      max={28}
                      step={1}
                      value={captionDecoration.bgCornerRadius}
                      onChange={(e) => patchDeco({ bgCornerRadius: Number(e.target.value) })}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="font-mono-tabular text-[11px] text-slate-300 w-9 text-right">
                      {captionDecoration.bgCornerRadius}px
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sample Editable Captions Preview */}
          <div className="space-y-2">
            <div>
              <span className="block text-xs font-medium text-slate-300">အစမ်းစာတန်း နှင့် Emoji ပြင်ဆင်ရန်</span>
              <span className="block text-[11px] text-slate-400">
                စာတန်းတစ်ခုလျှင် အများဆုံး ၂ ကြောင်း (72% အကျယ်) · ရှည်လွန်းပါက အချိန်ပိုင်းအသစ်ဖြင့် အလိုအလျောက် ခွဲပေးမည်
              </span>
            </div>
            <div className="max-h-36 space-y-2 overflow-y-auto pr-1" data-testid="caption-editor-list">
              {captions.map((cap) => (
                <div
                  key={cap.id}
                  data-testid={`caption-row-${cap.id}`}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#090B10]/80 p-2"
                >
                  <span className="font-mono-tabular text-[11px] text-slate-400 w-20 shrink-0">
                    {cap.start.toFixed(1)}s–{cap.end.toFixed(1)}s
                  </span>
                  <input
                    type="text"
                    aria-label="စာတန်းစာသား"
                    value={cap.text.replace(/\n+/g, ' ')}
                    onChange={(e) => onUpdateCaption(cap.id, 'text', e.target.value)}
                    onBlur={() => onNormalizeLongCaptions?.()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="flex-1 min-w-0 bg-transparent text-xs text-slate-100 focus:outline-none"
                  />
                  <input
                    type="text"
                    aria-label="Emoji"
                    value={cap.emoji}
                    onChange={(e) => onUpdateCaption(cap.id, 'emoji', e.target.value)}
                    className="w-9 rounded-lg border border-white/10 bg-white/5 px-1 py-1 text-center text-xs focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom Logo Upload, Toggle & Scale */}
          <div className="border-t border-white/10 pt-4 space-y-3">
            <span className="block text-xs font-medium text-slate-300">ကိုယ်ပိုင် Channel Logo</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 transition-colors cursor-pointer">
              <ImagePlus className="h-3.5 w-3.5 text-blue-400" />
              <span>Logo ပုံတင်မည်</span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadLogo(f);
                }}
              />
            </label>

            <button
              type="button"
              role="switch"
              aria-checked={logoEnabled}
              onClick={() => onToggleLogo(!logoEnabled)}
              className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                logoEnabled
                  ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                  : 'border-white/10 bg-white/[0.03] text-slate-400'
              }`}
            >
              လိုဂို: {logoEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {logoEnabled && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 shrink-0">Logo အရွယ်အစား</span>
              <input
                type="range"
                aria-label="လိုဂိုအရွယ်အစား"
                min={8}
                max={28}
                value={logoScale}
                onChange={(e) => onChangeLogoScale(Number(e.target.value))}
                className="flex-1 accent-blue-500 cursor-pointer"
              />
              <span className="font-mono-tabular text-xs text-slate-300 w-9 text-right">{logoScale}%</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>နောက်သို့</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 transition-colors cursor-pointer"
          >
            <span>ရှေ့ဆက်မည်</span>
            <ArrowRight className="h-4 w-4" />
          </button>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ---------- Step 4: Export Quality, Content-Driven Thumbnail Setup & Generate CTA ---------- */
interface Step4Props {
  videoUrl: string | null;
  resolution: ExportResolution;
  onChangeResolution: (r: ExportResolution) => void;
  thumbnailTitle: string;
  onChangeThumbnailTitle: (t: string) => void;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  onChangeThumbnailAspectRatio: (r: ThumbnailAspectRatio) => void;
  thumbnailAnalysis: ThumbnailAnalysis | null;
  thumbnailAnalyzing: boolean;
  onAnalyzeThumbnail: () => void;
  onThumbnailCanvasReady: (b: Blob | null) => void;
  credits: number;
  creditCost: number;
  onOpenCredits: () => void;
  onBack: () => void;
  onGenerate: () => void;
}

export const WizardStep4Export: React.FC<Step4Props> = ({
  videoUrl,
  resolution,
  onChangeResolution,
  thumbnailTitle,
  onChangeThumbnailTitle,
  thumbnailAspectRatio,
  onChangeThumbnailAspectRatio,
  thumbnailAnalysis,
  thumbnailAnalyzing,
  onAnalyzeThumbnail,
  onThumbnailCanvasReady,
  credits,
  creditCost,
  onOpenCredits,
  onBack,
  onGenerate,
}) => {
  const titleChars = countCharacters(thumbnailTitle);
  const insufficient = credits < creditCost;

  return (
    <section className="mx-auto max-w-3xl glass-panel rounded-2xl p-5 sm:p-7 space-y-6">
      <div>
        <span className="text-xs font-semibold text-blue-400">အဆင့် ၄ / ၆</span>
        <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-slate-100">
          Export အရည်အသွေးနှင့် ဗီဒီယိုအခြေခံ Thumbnail ပြင်ဆင်ပါ
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-400">
          ဗီဒီယိုအတွင်းရှိ အဓိကအကြောင်းအရာကို စစ်ဆေးပြီး ပလက်ဖောင်းအလိုက် Thumbnail အချိုးအစား ရွေးချယ်ပါ
        </p>
      </div>

      {/* Export Quality Selection */}
      <div className="space-y-2">
        <span className="block text-xs font-medium text-slate-300">ဗီဒီယို အရည်အသွေး (Export Quality)</span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChangeResolution('1080p')}
            className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
              resolution === '1080p'
                ? 'border-blue-500/70 bg-blue-600/15 blue-glow-ring'
                : 'border-white/10 bg-[#090B10]/80 hover:border-white/25'
            }`}
          >
            <div className="text-sm font-bold text-slate-100">1080p Full HD</div>
            <div className="mt-1 text-xs text-slate-400">TikTok, Reels, YouTube Shorts အတွက် မြန်ဆန်ကြည်လင်</div>
          </button>

          <button
            type="button"
            onClick={() => onChangeResolution('4k')}
            className={`rounded-xl border p-4 text-left transition-all cursor-pointer ${
              resolution === '4k'
                ? 'border-blue-500/70 bg-blue-600/15 blue-glow-ring'
                : 'border-white/10 bg-[#090B10]/80 hover:border-white/25'
            }`}
          >
            <div className="text-sm font-bold text-slate-100">4K Ultra HD</div>
            <div className="mt-1 text-xs text-slate-400">အမြင့်ဆုံး Cinema အရည်အသွေး Export (+4 Credits)</div>
          </button>
        </div>
      </div>

      {/* Platform Aspect Ratio Selector & Video Content Thumbnail Analysis */}
      <div className="space-y-4 rounded-xl border border-white/10 bg-[#090B10]/65 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div>
            <span className="block text-xs font-semibold text-slate-200">
              ပလက်ဖောင်းအလိုက် Thumbnail အချိုးအစား (Aspect Ratio)
            </span>
            <p className="mt-0.5 text-[11px] text-slate-400">
              ဗီဒီယိုပုံရိပ်အစစ်မှ အဓိကအရာကို ဗဟိုပြု၍ အလိုအလျောက် ဖြတ်တောက်ပေးမည်
            </p>
          </div>
          <button
            type="button"
            onClick={onAnalyzeThumbnail}
            disabled={!videoUrl || thumbnailAnalyzing}
            data-testid="analyze-thumbnail-btn"
            className="inline-flex items-center gap-2 rounded-xl border border-blue-500/50 bg-blue-500/15 px-3.5 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 disabled:opacity-45 transition-colors cursor-pointer whitespace-nowrap"
          >
            {thumbnailAnalyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>{thumbnailAnalyzing ? 'ဗီဒီယိုစစ်ဆေးနေသည်...' : 'ဗီဒီယိုစစ်ဆေးပြီး Thumbnail ဖန်တီးမည်'}</span>
          </button>
        </div>

        <div
          role="radiogroup"
          aria-label="Thumbnail ပလက်ဖောင်းအချိုးအစား"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PLATFORM_THUMBNAIL_PRESETS.map((preset) => {
            const active = thumbnailAspectRatio === preset.ratio;
            return (
              <button
                key={preset.ratio}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`ratio-btn-${preset.ratio}`}
                onClick={() => onChangeThumbnailAspectRatio(preset.ratio)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-all cursor-pointer ${
                  active
                    ? 'border-blue-500 bg-blue-600/20 text-white blue-glow-ring'
                    : 'border-white/10 bg-[#090B10] text-slate-300 hover:border-white/25'
                }`}
              >
                <div className="text-xs font-bold">{preset.shortLabel}</div>
                <div className="font-mono-tabular text-[11px] text-blue-300 mt-0.5">{preset.ratio}</div>
              </button>
            );
          })}
        </div>

        {/* Live Content-Driven Thumbnail Canvas Preview */}
        <ContentThumbnailPreview
          thumbnailTitle={thumbnailTitle}
          aspectRatio={thumbnailAspectRatio}
          videoUrl={videoUrl}
          analysis={thumbnailAnalysis}
          analyzing={thumbnailAnalyzing}
          onBlobReady={onThumbnailCanvasReady}
        />

        {/* Viral Thumbnail Headline (<25 chars) */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="wizard-thumb-title" className="text-xs font-medium text-slate-300">
              Thumbnail ခေါင်းစဉ် (စာလုံး ၂၅ လုံးအောက်)
            </label>
            <span className="font-mono-tabular text-xs text-blue-400 shrink-0 whitespace-nowrap">
              {titleChars} / 24
            </span>
          </div>
          <input
            id="wizard-thumb-title"
            type="text"
            value={thumbnailTitle}
            onChange={(e) => onChangeThumbnailTitle(truncateThumbnailTitle(e.target.value))}
            placeholder="ဗီဒီယိုအကြောင်းအရာနှင့် ကိုက်ညီသော ခေါင်းစဉ်"
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-[#090B10] px-4 py-3 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Required Credits Summary */}
      <div className="rounded-xl border border-white/10 bg-[#090B10]/80 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-400">လိုအပ်သော ခရက်ဒစ် ပမာဏ</div>
          <div className="font-mono-tabular text-2xl font-bold text-blue-400">
            {creditCost} Credits
          </div>
        </div>
        <div className="text-right space-y-1">
          <div className="text-xs text-slate-400">
            လက်ကျန်ခရက်ဒစ်: <span className="font-mono-tabular font-semibold text-slate-100">{credits}</span>
          </div>
          {insufficient ? (
            <button
              type="button"
              onClick={onOpenCredits}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 underline cursor-pointer"
            >
              <Coins className="h-3.5 w-3.5" />
              <span>ခရက်ဒစ် မလုံလောက်ပါ — ဝယ်ယူရန်</span>
            </button>
          ) : (
            <div className="text-xs text-slate-400">
              ထုတ်လုပ်ပြီးနောက် ကျန်ရှိမည်: <span className="font-mono-tabular text-slate-200">{credits - creditCost} Credits</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2 border-t border-white/10">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>နောက်သို့</span>
        </button>

        <button
          type="button"
          onClick={onGenerate}
          className="inline-flex w-full sm:flex-1 items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-6 py-4 text-base font-bold text-white blue-glow-cta hover:bg-blue-500 transition-colors cursor-pointer"
        >
          <Wand2 className="h-5 w-5" />
          <span>ဗီဒီယို စတင်ဖန်တီးမည် ({creditCost} Credits)</span>
        </button>
      </div>
    </section>
  );
};

/* ---------- Step 5: Processing Page with Progress Bar & Loading Animation ---------- */
interface Step5Props {
  activeTool: StudioTool;
  progress: PipelineProgress | null;
  errorText: string | null;
  onRetry: () => void;
  onBackToStep4: () => void;
}

function getProcessingStages(tool: StudioTool) {
  if (tool === 'recap') {
    return [
      { step: 1, title: 'Groq API ဖြင့် ဗီဒီယိုအကြောင်းအရာ ဖတ်ရှုစစ်ဆေးခြင်း' },
      { step: 2, title: 'ဗီဒီယိုတစ်ခုလုံးအတွက် မြန်မာ Movie Recap ဇာတ်ညွှန်း ရေးသားခြင်း' },
      { step: 3, title: 'မြန်မာ Recap AI အသံအသစ် ထုတ်လုပ်ခြင်း' },
      { step: 4, title: 'AI အသံကြာချိန်အတိုင်း ဗီဒီယိုတစ်ခုလုံး ညှိ၍ စာတန်းနှင့် Thumbnail ထုတ်ခြင်း' },
    ];
  }
  if (tool === 'captions') {
    return [
      { step: 1, title: 'Groq API ဖြင့် မူရင်းစကားပြောအချိန်များ ဖတ်ရှုခြင်း' },
      { step: 2, title: 'မူရင်းအသံအချိန်အတိုင်း Dynamic မြန်မာစာတန်း ဘာသာပြန်ခြင်း' },
      { step: 3, title: 'မူရင်းအသံ (1.0x) ကို မပြောင်းလဲဘဲ ထိန်းသိမ်းထားခြင်း' },
      { step: 4, title: 'စာတန်း၊ လိုဂိုနှင့် Content Thumbnail ထည့်သွင်း ထုတ်လုပ်ခြင်း' },
    ];
  }
  return [
    { step: 1, title: 'Groq ဖြင့် စကားပြောအပိုင်းနှင့် တိတ်ဆိတ်အပိုင်းများ ခွဲထုတ်ခြင်း' },
    { step: 2, title: 'စကားပြောအပိုင်းများအတွက်သာ မြန်မာ Dubbing ဇာတ်ညွှန်း ရေးသားခြင်း' },
    { step: 3, title: 'စကားပြောအပိုင်းတစ်ခုချင်းစီ Gemini TTS ထုတ်ပြီး အမြန်နှုန်းညှိခြင်း' },
    { step: 4, title: 'တိတ်ဆိတ်အပိုင်း 1.0x မူရင်းအတိုင်း ပြန်လည်ပေါင်းစည်း ထုတ်လုပ်ခြင်း' },
  ];
}

export const WizardStep5Processing: React.FC<Step5Props> = ({
  activeTool,
  progress,
  errorText,
  onRetry,
  onBackToStep4,
}) => {
  const currentStepNum = progress?.step ?? 1;
  const percent = progress?.percent ?? 12;
  const stages = getProcessingStages(activeTool);

  return (
    <section className="mx-auto max-w-xl glass-panel rounded-2xl p-6 sm:p-8 space-y-6 text-center">
      {!errorText ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-500/40 bg-blue-500/15 blue-glow-ring">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          </div>

          <div>
            <span className="text-xs font-semibold text-blue-400">အဆင့် ၅ / ၆</span>
            <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-slate-100">
              {activeTool === 'recap'
                ? 'သင့် Movie Recap ဗီဒီယိုကို ဖန်တီးနေပါသည်...'
                : activeTool === 'captions'
                  ? 'Dynamic မြန်မာစာတန်း ဗီဒီယိုကို ဖန်တီးနေပါသည်...'
                  : 'သင့်မြန်မာ Dubbing ဗီဒီယိုကို ဖန်တီးနေပါသည်...'}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-blue-200">
              {progress?.labelMy || 'လုပ်ငန်းစဉ် စတင်နေပါသည်...'}
            </p>
          </div>

          <div className="space-y-2 text-left">
            <div className="flex justify-between text-xs font-mono-tabular text-slate-400">
              <span>အဆင့် {currentStepNum} / 4</span>
              <span className="text-blue-400 font-semibold">{percent}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="space-y-2 text-left pt-2">
            {stages.map((st) => {
              const done = currentStepNum > st.step;
              const active = currentStepNum === st.step;
              return (
                <div
                  key={st.step}
                  className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${
                    active
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-100'
                      : done
                        ? 'border-white/10 bg-white/[0.03] text-slate-300'
                        : 'border-white/5 bg-transparent text-slate-500'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0" />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400 shrink-0" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-slate-600 shrink-0" />
                  )}
                  <span>{st.title}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div className="text-sm font-medium text-red-200 leading-relaxed">{errorText}</div>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={onBackToStep4}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-200 hover:bg-white/10 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>အဆင့် ၄ သို့ ပြန်သွားမည်</span>
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white blue-glow-cta hover:bg-blue-500 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>ပြန်လည်ကြိုးစားမည်</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

/* ---------- Step 6: Thumbnail Preview, Download Button & Telegram Send ---------- */
interface Step6Props {
  finalVideoUrl: string | null;
  finalThumbnailUrl: string | null;
  thumbnailTitle: string;
  thumbnailAspectRatio: ThumbnailAspectRatio;
  thumbnailAnalysis: ThumbnailAnalysis | null;
  thumbnailUpdating?: boolean;
  onChangeResultThumbnailRatio: (ratio: ThumbnailAspectRatio) => void;
  resolution: ExportResolution;
  syncSummary: SyncSummary | null;
  telegramChatId: string;
  onChangeTelegramChatId: (v: string) => void;
  onSendTelegram: () => void;
  telegramSending: boolean;
  onBackToEdit: () => void;
  onStartNew: () => void;
}

export const WizardStep6Result: React.FC<Step6Props> = ({
  finalVideoUrl,
  finalThumbnailUrl,
  thumbnailTitle,
  thumbnailAspectRatio,
  thumbnailAnalysis,
  thumbnailUpdating = false,
  onChangeResultThumbnailRatio,
  resolution,
  syncSummary,
  telegramChatId,
  onChangeTelegramChatId,
  onSendTelegram,
  telegramSending,
  onBackToEdit,
  onStartNew,
}) => {
  const thumbPreset = getThumbnailPreset(thumbnailAspectRatio);

  return (
    <section className="mx-auto max-w-4xl glass-panel rounded-2xl p-5 sm:p-7 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-blue-400">အဆင့် ၆ / ၆</span>
          <h1 className="mt-1 font-display text-xl sm:text-2xl font-bold text-slate-100">
            ဗီဒီယိုနှင့် Viral Thumbnail အဆင်သင့်ဖြစ်ပါပြီ ({resolution.toUpperCase()})
          </h1>
        </div>
        {syncSummary && (
          <span
            data-testid="sync-summary-badge"
            className="font-mono-tabular rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-200"
          >
            {syncSummary.tool === 'captions'
              ? `စာတန်းသီးသန့် · မူရင်းအသံ (1.0x) · AI Voice မပါ`
              : syncSummary.tool === 'recap'
                ? `Movie Recap · ${syncSummary.voiceGender ? `${formatVoiceGenderLabelMy(syncSummary.voiceGender)} · ` : ''}ဗီဒီယိုတစ်ခုလုံး (${formatVoiceSpeedLabel(syncSummary.voiceSpeed)} · ${syncSummary.videoPlaybackRate}x) · AI Voice ${syncSummary.aiVoiceDuration}s`
                : `မြန်မာအသံသွင်း · ${syncSummary.voiceGender ? `${formatVoiceGenderLabelMy(syncSummary.voiceGender)} · ` : ''}စကားပြော ${syncSummary.speakingSegmentCount ?? syncSummary.segmentCount} ပိုင်း (${formatVoiceSpeedLabel(syncSummary.voiceSpeed)} · ${syncSummary.videoPlaybackRate}x) · တိတ်ဆိတ် ${syncSummary.silenceSegmentCount ?? 0} ပိုင်း (1.0x မူရင်း)`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Final Video Player */}
        <div className="lg:col-span-7 space-y-3">
          <span className="block text-xs font-medium text-slate-300">အပြီးသတ် ဗီဒီယို အစမ်းကြည့်ရှုရန်</span>
          {finalVideoUrl && (
            <video
              controls
              src={finalVideoUrl}
              className="aspect-video w-full rounded-xl border border-white/10 bg-black"
            />
          )}
          {finalVideoUrl && (
            <a
              href={finalVideoUrl}
              download={`alpharecap_${resolution}.mp4`}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white blue-glow-cta hover:bg-blue-500 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>ဗီဒီယို ဒေါင်းလုဒ်ဆွဲရန် ({resolution.toUpperCase()})</span>
            </a>
          )}
        </div>

        {/* Content-Driven Thumbnail Preview in Exact Platform Aspect Ratio */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="block text-xs font-medium text-slate-300 truncate">
              Thumbnail ({thumbPreset.platformMy})
            </span>
            <span className="font-mono-tabular text-[11px] text-blue-300 shrink-0">
              {thumbPreset.width} × {thumbPreset.height}
            </span>
          </div>

          {finalThumbnailUrl && (
            <div className="flex items-center justify-center rounded-xl border border-white/10 bg-[#05070B] p-2.5">
              <div
                style={{ aspectRatio: thumbPreset.cssAspectRatio }}
                className={`relative overflow-hidden rounded-lg bg-black ${
                  thumbnailAspectRatio === '9:16'
                    ? 'h-[280px] w-auto'
                    : thumbnailAspectRatio === '1:1'
                      ? 'h-[230px] w-auto'
                      : 'w-full'
                }`}
              >
                <img
                  src={finalThumbnailUrl}
                  alt={thumbnailTitle}
                  className="h-full w-full object-cover"
                />
                {thumbnailUpdating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#090B10]/70">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                  </div>
                )}
              </div>
            </div>
          )}

          {thumbnailAnalysis && (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/8 px-3 py-2 text-[11px] text-slate-300 space-y-0.5">
              <div className="font-semibold text-blue-300">{thumbnailAnalysis.subjectLabelMy}</div>
              <div>{thumbnailAnalysis.subjectSummaryMy}</div>
            </div>
          )}

          {/* Switch Thumbnail Platform Ratio Directly in Result */}
          <div className="grid grid-cols-4 gap-1.5">
            {PLATFORM_THUMBNAIL_PRESETS.map((p) => (
              <button
                key={p.ratio}
                type="button"
                disabled={thumbnailUpdating}
                onClick={() => onChangeResultThumbnailRatio(p.ratio)}
                className={`rounded-lg border py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  thumbnailAspectRatio === p.ratio
                    ? 'border-blue-500 bg-blue-600/25 text-white'
                    : 'border-white/10 bg-[#090B10] text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.ratio}
              </button>
            ))}
          </div>

          {finalThumbnailUrl && (
            <a
              href={finalThumbnailUrl}
              download={`alpharecap_thumb_${thumbnailAspectRatio.replace(':', 'x')}.jpg`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Download className="h-4 w-4 text-blue-400" />
              <span>Thumbnail ပုံ ဒေါင်းရန် ({thumbPreset.ratio})</span>
            </a>
          )}
        </div>
      </div>

      {/* Telegram Bot Direct Delivery */}
      <div className="rounded-xl border border-white/10 bg-[#090B10]/80 p-4 space-y-3">
        <div className="text-xs sm:text-sm font-semibold text-slate-200">
          Telegram Bot သို့ ဗီဒီယိုနှင့် Thumbnail တိုက်ရိုက်ပေးပို့ရန်
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            aria-label="Telegram Chat ID"
            value={telegramChatId}
            onChange={(e) => onChangeTelegramChatId(e.target.value)}
            placeholder="သင့် Telegram Chat ID ထည့်ပါ (ဥပမာ 123456789)"
            className="flex-1 rounded-xl border border-white/15 bg-[#10141D] px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onSendTelegram}
            disabled={telegramSending}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/50 bg-blue-500/20 px-5 py-3 text-sm font-semibold text-blue-200 hover:bg-blue-500/30 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Send className="h-4 w-4" />
            <span>{telegramSending ? 'ပေးပို့နေသည်...' : 'Telegram Bot သို့ ပို့မည်'}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10">
        <button
          type="button"
          onClick={onBackToEdit}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs sm:text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>စာတန်း/လိုဂို ပြန်ပြင်မည်</span>
        </button>
        <button
          type="button"
          onClick={onStartNew}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-100 hover:bg-white/10 transition-colors cursor-pointer"
        >
          <RotateCcw className="h-4 w-4 text-blue-400" />
          <span>ဗီဒီယိုအသစ် ဖန်တီးမည်</span>
        </button>
      </div>
    </section>
  );
};
