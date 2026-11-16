import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { HeaderBar } from './components/HeaderBar';
import { WizardStepper } from './components/WizardStepper';
import {
  WizardStep1Video,
  WizardStep2Voice,
  WizardStep3PreviewCustomize,
  WizardStep4Export,
  WizardStep5Processing,
  WizardStep6Result,
} from './components/StepPanels';
import { CreditModal } from './components/CreditModal';
import { DeployGuideModal } from './components/DeployGuideModal';
import {
  calculateCreditCost,
  computeUploadChunkPlan,
  DEFAULT_CAPTION_DECORATION,
  splitLongCaptionsToMaxTwoLines,
  truncateThumbnailTitle,
  validateUploadFileSize,
} from './utils/studioLogic';
import { renderViralThumbnailBlob } from './utils/thumbnailCanvas';
import { suggestDefaultAspectRatio } from './utils/thumbnailLogic';
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
  TranscriptSegment,
  VideoTimelineSegment,
  VoiceGender,
  VoiceSpeed,
  WizardStep,
} from './types/studio';

const INITIAL_CAPTIONS: CaptionSegment[] = [
  {
    id: 'cap_1',
    start: 0.2,
    end: 3.8,
    text: 'မိုးရွာနေတဲ့ညမှာ စုံထောက်ကြီး တစ်ယောက်တည်း စောင့်နေတယ်',
    emoji: '🌧️',
  },
  {
    id: 'cap_2',
    start: 4.0,
    end: 7.8,
    text: 'ဒါပေမဲ့ သူ့နောက်ကွယ်က လျှို့ဝှက်ချက်က အရမ်းကြောက်စရာကောင်းတယ်',
    emoji: '😱',
  },
  {
    id: 'cap_3',
    start: 8.0,
    end: 11.8,
    text: 'နောက်ဆုံး ဘယ်သူတရားခံလဲ ဆိုတာ ကြည့်လိုက်ကြရအောင်',
    emoji: '🔥',
  },
];

const INITIAL_SCRIPT_MY =
  'ဟေ့ကောင်တွေ ဒီညကတော့ တကယ်မလွယ်ဘူးနော်။ မိုးရွာနေတဲ့ တံတားပေါ်မှာ စုံထောက်ကြီးက သဲလွန်စတစ်ခုကို စောင့်နေတာ။ ဒါပေမဲ့ တကယ်တမ်း ထင်မှတ်မထားတဲ့ အလှည့်အပြောင်းကြီးက အခုမှ စမှာ!';

export default function App() {
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  // Wizard Navigation State (One step at a time)
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>(1);

  const [activeTool, setActiveTool] = useState<StudioTool>('recap');
  const [credits, setCredits] = useState<number>(30);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);

  // Step 1: Ephemeral Video Source State
  const [linkInput, setLinkInput] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [durationSeconds, setDurationSeconds] = useState<number>(12);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720,
  });
  const [autoBlurRegions, setAutoBlurRegions] = useState<AutoBlurRegion[]>([]);
  const [autoBlurSourceVersion, setAutoBlurSourceVersion] = useState(0);
  const [autoBlurEnabled, setAutoBlurEnabled] = useState(true);
  const [autoBlurStrength, setAutoBlurStrength] = useState(12);
  const [autoBlurStyle, setAutoBlurStyle] = useState<AutoBlurStyle>('blur');
  const [autoBlurStatus, setAutoBlurStatus] = useState<'idle' | 'analyzing' | 'ready' | 'error'>('idle');
  const [autoBlurError, setAutoBlurError] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState<boolean>(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  // Step 2: Myanmar Voice, Gender (Male/Female), Speed & Crossfade Audio
  const [voiceGender, setVoiceGender] = useState<VoiceGender | null>(null);
  const [voiceStyle, setVoiceStyle] = useState<MyanmarVoiceId>('street_bro');
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>(1.0);
  const [musicMood, setMusicMood] = useState<MusicMood>('thriller');
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);

  // Step 3: Captions, Logo & Live Drag Positions
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [timelineSegments, setTimelineSegments] = useState<VideoTimelineSegment[]>([]);
  const [scriptMy, setScriptMy] = useState<string>(INITIAL_SCRIPT_MY);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [captions, setCaptions] = useState<CaptionSegment[]>(INITIAL_CAPTIONS);
  const [captionStyle, setCaptionStyle] = useState<CaptionAnimationStyle>('pop');
  const [captionDecoration, setCaptionDecoration] = useState<CaptionDecorationConfig>(
    DEFAULT_CAPTION_DECORATION
  );
  const [subPos, setSubPos] = useState<OverlayPosition>({ x: 50, y: 80 });
  const [logoPos, setLogoPos] = useState<OverlayPosition>({ x: 86, y: 12 });
  const [logoEnabled, setLogoEnabled] = useState<boolean>(true);
  const [logoScale, setLogoScale] = useState<number>(14);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Step 4: Export Quality, Platform Aspect Ratio & Content-Driven Thumbnail
  const [thumbnailTitle, setThumbnailTitle] = useState<string>('ဗီဒီယိုအနှစ်ချုပ်');
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState<ThumbnailAspectRatio>('16:9');
  const [thumbnailAnalysis, setThumbnailAnalysis] = useState<ThumbnailAnalysis | null>(null);
  const [thumbnailAnalyzing, setThumbnailAnalyzing] = useState<boolean>(false);
  const [thumbnailUpdating, setThumbnailUpdating] = useState<boolean>(false);
  const [resolution, setResolution] = useState<ExportResolution>('1080p');
  const thumbnailBlobRef = useRef<Blob | null>(null);
  const hasCustomThumbTitleRef = useRef<boolean>(false);
  const analyzedVideoKeyRef = useRef<string>('');

  // Step 5 & 6: Processing, Final Output & Telegram
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalThumbnailUrl, setFinalThumbnailUrl] = useState<string | null>(null);
  const [telegramChatId, setTelegramChatId] = useState<string>('');
  const [telegramSending, setTelegramSending] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const creditCost = calculateCreditCost(activeTool, resolution === '4k', durationSeconds);

  // Auto-clean server ephemeral session files when user closes page/tab
  useEffect(() => {
    const cleanup = () => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/session/cleanup?sessionId=${encodeURIComponent(sessionId)}`);
      }
    };
    window.addEventListener('pagehide', cleanup);
    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('pagehide', cleanup);
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [sessionId]);

  const showError = (text: string) => setBanner({ type: 'error', text });
  const showSuccess = (text: string) => setBanner({ type: 'success', text });

  const goToStep = (step: WizardStep) => {
    setBanner(null);
    setCurrentStep(step);
    setMaxReachedStep((prev) => (step > prev ? step : prev));
  };

  const resetVideoDerivedState = () => {
    setFinalVideoUrl(null);
    setFinalThumbnailUrl(null);
    setTtsAudioUrl(null);
    setSyncSummary(null);
    setTranscriptSegments([]);
    setTimelineSegments([]);
    setThumbnailAnalysis(null);
    analyzedVideoKeyRef.current = '';
    hasCustomThumbTitleRef.current = false;
    setProcessingError(null);
  };

  const applyVideoSourceMeta = (data: {
    videoUrl: string;
    title: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
  }) => {
    setAutoBlurSourceVersion((version) => version + 1);
    setVideoUrl(data.videoUrl);
    setVideoTitle(data.title);
    setDurationSeconds(data.durationSeconds || 12);
    if (data.width && data.height) {
      setVideoDimensions({ width: data.width, height: data.height });
      setThumbnailAspectRatio(suggestDefaultAspectRatio(data.width, data.height));
    } else {
      setVideoDimensions({ width: 1280, height: 720 });
    }
    resetVideoDerivedState();
  };

  useEffect(() => {
    if (!videoUrl) {
      setAutoBlurRegions([]);
      setAutoBlurStatus('idle');
      setAutoBlurError(null);
      return;
    }

    const controller = new AbortController();
    setAutoBlurRegions([]);
    setAutoBlurStatus('analyzing');
    setAutoBlurError(null);
    fetch('/api/analyze-auto-blur', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as { regions?: AutoBlurRegion[]; errorMy?: string };
        if (!res.ok) throw new Error(data.errorMy || 'ဗီဒီယိုအတွင်းရှိ စာသားနှင့် လိုဂိုများကို စစ်ဆေး၍မရပါ');
        if (!Array.isArray(data.regions)) throw new Error('အလိုအလျောက် စစ်ဆေးမှုရလဒ် မမှန်ကန်ပါ');
        setAutoBlurRegions(data.regions);
        setAutoBlurStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAutoBlurError(
          error instanceof Error ? error.message : 'ဗီဒီယိုကို အလိုအလျောက်စစ်ဆေးရာတွင် အမှားဖြစ်ပွားပါသည်'
        );
        setAutoBlurStatus('error');
      });

    return () => controller.abort();
  }, [sessionId, videoUrl, autoBlurSourceVersion]);

  const handleLoadSample = async () => {
    setBanner(null);
    setSourceLoading(true);
    try {
      const res = await fetch('/api/load-sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.errorMy || 'နမူနာဗီဒီယို ဖွင့်၍မရပါ');
        return;
      }
      applyVideoSourceMeta(data);
      showSuccess('နမူနာရုပ်ရှင်ကို ထည့်သွင်းပြီးပါပြီ — “ရှေ့ဆက်မည်” ကို နှိပ်ပါ');
    } catch {
      showError('Server နှင့် ချိတ်ဆက်ရာတွင် အမှားဖြစ်ပွားပါသည်');
    } finally {
      setSourceLoading(false);
    }
  };

  const handleSubmitLink = async () => {
    setBanner(null);
    setSourceLoading(true);
    try {
      const res = await fetch('/api/resolve-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkInput, sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.errorMy || 'ဗီဒီယိုလင့်ခ် စစ်ဆေးရာတွင် အမှားဖြစ်ပွားပါသည်');
        return;
      }
      applyVideoSourceMeta(data);
      showSuccess(`${data.platform} ဗီဒီယိုကို အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ`);
    } catch {
      showError('လင့်ခ်မှ ဗီဒီယိုရယူရာတွင် အမှားဖြစ်ပွားပါသည်');
    } finally {
      setSourceLoading(false);
    }
  };

  const parseJsonResponseSafe = async (res: Response): Promise<Record<string, unknown>> => {
    const rawText = await res.text();
    if (!rawText) return {};
    try {
      return JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return {
        errorMy:
          res.status === 413
            ? 'ဖိုင်အရွယ်အစား ဆာဗာကန့်သတ်ချက်ထက် ကျော်လွန်နေပါသည် — ထပ်မံကြိုးစားပါ'
            : `ဆာဗာတုံ့ပြန်မှု မမှန်ကန်ပါ (HTTP ${res.status})`,
      };
    }
  };

  const handleUploadMp4 = async (file: File) => {
    setBanner(null);
    const sizeCheck = validateUploadFileSize(file.size);
    if (!sizeCheck.valid) {
      showError(sizeCheck.errorMy || 'ဗီဒီယိုဖိုင် အရွယ်အစား မမှန်ကန်ပါ');
      return;
    }

    setSourceLoading(true);
    setUploadPercent(0);
    try {
      const plan = computeUploadChunkPlan(file.size);
      let data: Record<string, unknown> = {};

      if (!plan.useChunked) {
        const form = new FormData();
        form.append('sessionId', sessionId);
        form.append('video', file);
        const res = await fetch('/api/upload-video', {
          method: 'POST',
          headers: { 'x-session-id': sessionId },
          body: form,
        });
        data = await parseJsonResponseSafe(res);
        if (!res.ok) {
          showError(String(data.errorMy || 'MP4 ဖိုင်တင်သွင်းရာတွင် အမှားဖြစ်ပွားပါသည်'));
          return;
        }
        setUploadPercent(100);
      } else {
        const uploadId = crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
        for (let idx = 0; idx < plan.totalChunks; idx++) {
          const start = idx * plan.chunkSizeBytes;
          const end = Math.min(file.size, start + plan.chunkSizeBytes);
          const slice = file.slice(start, end);

          let chunkOk = false;
          let lastChunkErr = 'MP4 ဖိုင်အပိုင်း တင်သွင်းရာတွင် အမှားဖြစ်ပွားပါသည်';

          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const chunkForm = new FormData();
              chunkForm.append('sessionId', sessionId);
              chunkForm.append('uploadId', uploadId);
              chunkForm.append('chunkIndex', String(idx));
              chunkForm.append('totalChunks', String(plan.totalChunks));
              chunkForm.append('chunk', slice, `${file.name}.part${idx}`);

              const cRes = await fetch('/api/upload-video/chunk', {
                method: 'POST',
                headers: { 'x-session-id': sessionId },
                body: chunkForm,
              });
              const cData = await parseJsonResponseSafe(cRes);
              if (cRes.ok) {
                chunkOk = true;
                break;
              }
              lastChunkErr = String(cData.errorMy || lastChunkErr);
              if (cRes.status >= 400 && cRes.status < 500) break;
            } catch {
              // Retry transient network reset/disconnect
            }
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }

          if (!chunkOk) {
            showError(lastChunkErr);
            return;
          }
          setUploadPercent(Math.min(95, Math.round(((idx + 1) / plan.totalChunks) * 95)));
        }

        const completeRes = await fetch('/api/upload-video/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
          body: JSON.stringify({
            sessionId,
            uploadId,
            totalChunks: plan.totalChunks,
            filename: file.name,
          }),
        });
        data = await parseJsonResponseSafe(completeRes);
        if (!completeRes.ok) {
          showError(String(data.errorMy || 'MP4 ဖိုင်ပေါင်းစည်းရာတွင် အမှားဖြစ်ပွားပါသည်'));
          return;
        }
        setUploadPercent(100);
      }

      applyVideoSourceMeta({
        videoUrl: String(data.videoUrl || ''),
        durationSeconds: Number(data.durationSeconds || 0),
        width: Number(data.width || 1280),
        height: Number(data.height || 720),
        title: String(data.title || file.name),
      });
      showSuccess('MP4 ဗီဒီယိုဖိုင်ကို စစ်ဆေးထည့်သွင်းပြီးပါပြီ');
    } catch {
      showError('MP4 ဖိုင်တင်သွင်းရာတွင် ကွန်ရက်ချိတ်ဆက်မှု အမှားဖြစ်ပွားပါသည် — ထပ်မံကြိုးစားပါ');
    } finally {
      setSourceLoading(false);
      setUploadPercent(null);
    }
  };

  const analyzeVideoContentThumbnail = async (
    ratioOverride?: ThumbnailAspectRatio,
    contextOverride?: { transcript?: string; scriptMy?: string; silent?: boolean }
  ): Promise<ThumbnailAnalysis | null> => {
    if (!videoUrl) return null;
    const ratio = ratioOverride ?? thumbnailAspectRatio;
    setThumbnailAnalyzing(true);
    try {
      const res = await fetch('/api/analyze-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          aspectRatio: ratio,
          transcript:
            contextOverride?.transcript ??
            transcriptSegments.map((s) => s.text).join(' '),
          scriptMy: contextOverride?.scriptMy ?? scriptMy,
          videoTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!contextOverride?.silent) {
          showError(data.errorMy || 'ဗီဒီယိုဖရိန်များ စစ်ဆေးရာတွင် အမှားဖြစ်ပွားပါသည်');
        }
        return null;
      }
      const analysis = data as ThumbnailAnalysis;
      analyzedVideoKeyRef.current = `${sessionId}:${videoUrl}`;
      setThumbnailAnalysis(analysis);
      if (!hasCustomThumbTitleRef.current && analysis.headlineMy) {
        setThumbnailTitle(truncateThumbnailTitle(analysis.headlineMy));
      }
      if (!contextOverride?.silent) {
        showSuccess(`ဗီဒီယိုမှ ${analysis.subjectLabelMy} ကို တွေ့ရှိပြီး Thumbnail ပြင်ဆင်ပြီးပါပြီ`);
      }
      return analysis;
    } catch {
      if (!contextOverride?.silent) {
        showError('ဗီဒီယို Thumbnail စစ်ဆေးရာတွင် ချိတ်ဆက်မှု အမှားဖြစ်ပွားပါသည်');
      }
      return null;
    } finally {
      setThumbnailAnalyzing(false);
    }
  };

  // Auto-analyze video frames cleanly when user lands on Step 4 without prior analysis
  useEffect(() => {
    if (currentStep === 4 && videoUrl && !thumbnailAnalysis && !thumbnailAnalyzing) {
      void analyzeVideoContentThumbnail(thumbnailAspectRatio, { silent: true });
    }
  }, [currentStep, videoUrl]);

  const handleUploadLogo = (file: File) => {
    setLogoFile(file);
    setLogoEnabled(true);
    setLogoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    showSuccess('ကိုယ်ပိုင် Logo ပုံကို ထည့်သွင်းပြီးပါပြီ — ဗီဒီယိုပေါ်တွင် ဆွဲရွှေ့နိုင်ပါသည်');
  };

  const handleUpdateCaption = (id: string, field: 'text' | 'emoji', value: string) => {
    setCaptions((prev) => {
      const next = prev.map((c) => (c.id === id ? { ...c, [field]: value } : c));
      if (field === 'text') {
        setScriptMy(next.map((c) => c.text.replace(/\n+/g, ' ').trim()).filter(Boolean).join(' '));
      }
      return next;
    });
  };

  const handleNormalizeLongCaptions = () => {
    setCaptions((prev) =>
      splitLongCaptionsToMaxTwoLines(prev, {
        videoWidth: videoDimensions.width,
        videoHeight: videoDimensions.height,
        fontSizeScale: captionDecoration.fontSizeScale,
      })
    );
  };

  const runFullGenerationPipeline = async () => {
    if (autoBlurEnabled && autoBlurStatus !== 'ready') {
      showError(
        autoBlurStatus === 'analyzing'
          ? 'အလိုအလျောက် Blur စစ်ဆေးမှု ပြီးဆုံးသည်အထိ စောင့်ပါ'
          : autoBlurError || 'အလိုအလျောက် Blur စစ်ဆေးမှု မအောင်မြင်ပါ — ပြန်စမ်းပါ သို့မဟုတ် Auto Blur ကို ပိတ်ပါ'
      );
      setCurrentStep(3);
      return;
    }
    if (activeTool !== 'captions' && !voiceGender) {
      showError('Gemini TTS အသံမထုတ်လုပ်မီ Male Voice သို့မဟုတ် Female Voice ကို အဆင့် (၂) တွင် ရွေးချယ်ပါ');
      setCurrentStep(2);
      return;
    }
    if (credits < creditCost) {
      showError('ခရက်ဒစ် မလုံလောက်ပါ — ကျေးဇူးပြု၍ ခရက်ဒစ် ထပ်မံဝယ်ယူပါ');
      setIsCreditModalOpen(true);
      return;
    }

    setBanner(null);
    setProcessingError(null);
    setCurrentStep(5);
    setMaxReachedStep((prev) => (prev < 5 ? 5 : prev));

    try {
      // 1. Groq Audio Analysis / Timestamp Extraction
      setProgress({
        step: 1,
        totalSteps: 4,
        labelMy:
          activeTool === 'dubbing'
            ? 'Groq API ဖြင့် စကားပြောအပိုင်းနှင့် တိတ်ဆိတ်အပိုင်းများကို အချိန်အတိအကျ ခွဲထုတ်နေသည်...'
            : 'Groq API ဖြင့် ဗီဒီယိုအကြောင်းအရာနှင့် စာသားအချိန်မှတ်တမ်း ထုတ်ယူနေသည်...',
        percent: 20,
      });
      const tRes = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const tData = await tRes.json();
      if (!tRes.ok) {
        throw new Error(tData.errorMy || 'Groq Transcript ထုတ်ယူရာတွင် အမှားဖြစ်ပွားပါသည်');
      }
      const segs = Array.isArray(tData.segments) ? (tData.segments as TranscriptSegment[]) : [];
      const groqTimeline = Array.isArray(tData.timelineSegments)
        ? (tData.timelineSegments as VideoTimelineSegment[])
        : timelineSegments;
      setTranscriptSegments(segs);
      setTimelineSegments(activeTool === 'dubbing' ? groqTimeline : []);

      // 2. Gemini Script Generation (Tool-specific: full Recap vs Speaking-Only Dubbing vs Original-Audio Captions)
      setProgress({
        step: 2,
        totalSteps: 4,
        labelMy:
          activeTool === 'recap'
            ? 'ဗီဒီယိုတစ်ခုလုံးအတွက် မြန်မာ Movie Recap ဇာတ်ညွှန်းအသစ် ရေးသားနေသည်...'
            : activeTool === 'captions'
              ? 'မူရင်းအသံအတွက် Dynamic Myanmar Captions ဘာသာပြန် ရေးသားနေသည်...'
              : 'စကားပြောအပိုင်းများအတွက်သာ မြန်မာ Dubbing ဇာတ်ညွှန်း ရေးသားနေသည်...',
        percent: 45,
      });
      const sRes = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: tData.transcript,
          segments: segs.length > 0 ? segs : transcriptSegments,
          timelineSegments: activeTool === 'dubbing' ? groqTimeline : undefined,
          tool: activeTool,
          voiceSpeed,
          durationSeconds,
          videoWidth: videoDimensions.width,
          videoHeight: videoDimensions.height,
        }),
      });
      const sData = await sRes.json();
      if (!sRes.ok) {
        throw new Error(sData.errorMy || 'Gemini ဇာတ်ညွှန်းဖန်တီးရာတွင် အမှားဖြစ်ပွားပါသည်');
      }

      const nextScript = String(sData.scriptMy ?? scriptMy);
      const scriptedTimeline =
        activeTool === 'dubbing' && Array.isArray(sData.timelineSegments)
          ? (sData.timelineSegments as VideoTimelineSegment[])
          : [];
      setTimelineSegments(scriptedTimeline);

      let finalCaptions: CaptionSegment[] = splitLongCaptionsToMaxTwoLines(
        Array.isArray(sData.captions) ? (sData.captions as CaptionSegment[]) : captions,
        {
          videoWidth: videoDimensions.width,
          videoHeight: videoDimensions.height,
          fontSizeScale: captionDecoration.fontSizeScale,
        }
      );

      setScriptMy(nextScript);
      setCaptions(finalCaptions);

      // 2b. Video Content-Driven Thumbnail Analysis (reuse Step 4 analysis if already extracted for this video)
      const videoAnalysisKey = videoUrl ? `${sessionId}:${videoUrl}` : '';
      const hasExistingAnalysis =
        Boolean(thumbnailAnalysis) &&
        Boolean(videoAnalysisKey) &&
        analyzedVideoKeyRef.current === videoAnalysisKey;
      const latestThumbAnalysis = hasExistingAnalysis
        ? thumbnailAnalysis
        : (await analyzeVideoContentThumbnail(thumbnailAspectRatio, {
            transcript: tData.transcript,
            scriptMy: nextScript,
            silent: true,
          })) || thumbnailAnalysis;

      const resolvedThumbTitle = truncateThumbnailTitle(
        (hasCustomThumbTitleRef.current ? thumbnailTitle.trim() : '') ||
          latestThumbAnalysis?.headlineMy ||
          sData.thumbnailTitleMy ||
          thumbnailTitle.trim() ||
          'ဗီဒီယိုအနှစ်ချုပ်'
      );
      setThumbnailTitle(resolvedThumbTitle);

      // 3. Tool-specific TTS Step:
      //    - 'recap': full continuous TTS narration across whole video
      //    - 'dubbing': per-speaking-segment TTS (silence stays 1.0x)
      //    - 'captions': NO AI voice, preserve original video audio
      let plannedTimeline = scriptedTimeline;
      if (activeTool === 'captions') {
        setTtsAudioUrl(null);
        setSyncSummary({
          tool: 'captions',
          segmentCount: finalCaptions.length,
          originalVideoDuration: durationSeconds,
          aiVoiceDuration: 0,
          finalVideoDuration: durationSeconds,
          videoPlaybackRate: 1.0,
          voiceSpeed,
        });
      } else {
        setProgress({
          step: 3,
          totalSteps: 4,
          labelMy:
            activeTool === 'recap'
              ? 'ဗီဒီယိုတစ်ခုလုံးအတွက် မြန်မာ Recap AI အသံ ဖန်တီးနေသည်...'
              : 'စကားပြောအပိုင်းတစ်ခုချင်းစီအတွက် Gemini TTS ထုတ်ပြီး စကားပြောအပိုင်းအမြန်နှုန်းကိုသာ ညှိနေသည်...',
          percent: 70,
        });
        const ttsRes = await fetch('/api/generate-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            tool: activeTool,
            scriptMy: nextScript,
            speed: voiceSpeed,
            voiceStyle,
            voiceGender,
            captions: finalCaptions,
            timelineSegments: activeTool === 'dubbing' ? scriptedTimeline : [],
            durationSeconds,
          }),
        });
        const ttsData = await ttsRes.json();
        if (!ttsRes.ok) {
          throw new Error(ttsData.errorMy || 'Gemini TTS အသံထုတ်လုပ်ရာတွင် အမှားဖြစ်ပွားပါသည်');
        }
        setTtsAudioUrl(ttsData.audioUrl || null);
        setSyncSummary(ttsData.syncSummary || null);
        if (activeTool === 'dubbing' && Array.isArray(ttsData.timelineSegments) && ttsData.timelineSegments.length > 0) {
          plannedTimeline = ttsData.timelineSegments as VideoTimelineSegment[];
          setTimelineSegments(plannedTimeline);
        }
        if (Array.isArray(ttsData.syncedCaptions)) {
          finalCaptions = splitLongCaptionsToMaxTwoLines(ttsData.syncedCaptions as CaptionSegment[], {
            videoWidth: videoDimensions.width,
            videoHeight: videoDimensions.height,
            fontSizeScale: captionDecoration.fontSizeScale,
          });
          setCaptions(finalCaptions);
        }
      }

      // 4. Final 1080p / 4K Render
      setProgress({
        step: 4,
        totalSteps: 4,
        labelMy:
          activeTool === 'recap'
            ? `AI Recap အသံနှင့် ဗီဒီယိုတစ်ခုလုံး ကိုက်ညီအောင် ${resolution.toUpperCase()} ထုတ်လုပ်နေသည်...`
            : activeTool === 'captions'
              ? `မူရင်းအသံ (1.0x) နှင့် Dynamic Captions များကို ${resolution.toUpperCase()} ထုတ်လုပ်နေသည်...`
              : `ညှိပြီးသား စကားပြောအပိုင်းနှင့် 1.0x တိတ်ဆိတ်အပိုင်းများကို ${resolution.toUpperCase()} အဖြစ် ပေါင်းစည်းနေသည်...`,
        percent: 90,
      });

      const freshThumbBlob =
        (await renderViralThumbnailBlob(
          resolvedThumbTitle,
          videoUrl,
          thumbnailAspectRatio,
          latestThumbAnalysis
        )) || thumbnailBlobRef.current;

      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('tool', activeTool);
      form.append('resolution', resolution);
      form.append('musicMood', musicMood);
      form.append('crossfadeSeconds', '2.0');
      form.append('sfxEnabled', String(sfxEnabled));
      form.append('logoEnabled', String(logoEnabled));
      form.append('logoScale', String(logoScale));
      form.append('subPos', JSON.stringify(subPos));
      form.append('logoPos', JSON.stringify(logoPos));
      form.append('captions', JSON.stringify(finalCaptions));
      form.append('captionDecoration', JSON.stringify(captionDecoration));
      form.append('autoBlurEnabled', String(autoBlurEnabled));
      form.append('autoBlurStyle', autoBlurStyle);
      form.append('autoBlurStrength', String(autoBlurStrength));
      form.append('autoBlurRegions', JSON.stringify(autoBlurRegions));
      if (activeTool === 'dubbing') {
        form.append('timelineSegments', JSON.stringify(plannedTimeline));
      }
      form.append('thumbnailTitle', resolvedThumbTitle);
      form.append('thumbnailAspectRatio', thumbnailAspectRatio);

      if (logoEnabled && logoFile) {
        form.append('logo', logoFile);
      }
      if (freshThumbBlob) {
        form.append('thumbnail', freshThumbBlob, 'thumbnail.jpg');
      }

      const renderRes = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'x-session-id': sessionId },
        body: form,
      });
      const renderData = await renderRes.json();
      if (!renderRes.ok) {
        throw new Error(renderData.errorMy || 'ဗီဒီယို အပြီးသတ်ထုတ်လုပ်ရာတွင် အမှားဖြစ်ပွားပါသည်');
      }

      setFinalVideoUrl(renderData.outputVideoUrl);
      setFinalThumbnailUrl(renderData.thumbnailUrl);
      setCredits((c) => Math.max(0, c - creditCost));
      setProgress({ step: 4, totalSteps: 4, labelMy: 'ပြီးစီးပါပြီ!', percent: 100 });
      setCurrentStep(6);
      setMaxReachedStep(6);
      showSuccess(`${resolution.toUpperCase()} ဗီဒီယိုနှင့် Viral Thumbnail ဖန်တီးမှု အောင်မြင်စွာ ပြီးဆုံးပါပြီ!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'လုပ်ငန်းစဉ်အတွင်း အမှားဖြစ်ပွားပါသည်';
      setProcessingError(msg);
      showError(msg);
    } finally {
      setProgress(null);
    }
  };

  const handleSwitchResultThumbnailRatio = async (newRatio: ThumbnailAspectRatio) => {
    setThumbnailAspectRatio(newRatio);
    setThumbnailUpdating(true);
    try {
      const blob = await renderViralThumbnailBlob(
        thumbnailTitle,
        videoUrl,
        newRatio,
        thumbnailAnalysis
      );
      if (!blob) return;
      thumbnailBlobRef.current = blob;
      const form = new FormData();
      form.append('sessionId', sessionId);
      form.append('thumbnailAspectRatio', newRatio);
      form.append('thumbnail', blob, 'thumbnail.jpg');
      const res = await fetch('/api/render-thumbnail', {
        method: 'POST',
        headers: { 'x-session-id': sessionId },
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.thumbnailUrl) {
        setFinalThumbnailUrl(data.thumbnailUrl);
      }
    } catch {
      showError('Thumbnail အချိုးအစား ပြောင်းလဲရာတွင် အမှားဖြစ်ပွားပါသည်');
    } finally {
      setThumbnailUpdating(false);
    }
  };

  const handleSendTelegram = async () => {
    setBanner(null);
    if (!telegramChatId.trim()) {
      showError('Telegram Chat ID ထည့်သွင်းပေးပါ');
      return;
    }
    setTelegramSending(true);
    try {
      const res = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          chatId: telegramChatId.trim(),
          resolution,
          thumbnailTitle: truncateThumbnailTitle(thumbnailTitle),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.errorMy || 'Telegram ပေးပို့ရာတွင် အမှားဖြစ်ပွားပါသည်');
        return;
      }
      showSuccess(data.messageMy);
    } catch {
      showError('Telegram Bot နှင့် ချိတ်ဆက်ရာတွင် အမှားဖြစ်ပွားပါသည်');
    } finally {
      setTelegramSending(false);
    }
  };

  const handleStartNew = () => {
    setBanner(null);
    setLinkInput('');
    setVideoUrl(null);
    setVideoTitle('');
    setDurationSeconds(12);
    resetVideoDerivedState();
    setCaptions(INITIAL_CAPTIONS);
    setScriptMy(INITIAL_SCRIPT_MY);
    setCurrentStep(1);
    setMaxReachedStep(1);
  };

  return (
    <div id="studio-top" className="min-h-screen flex flex-col bg-[#090B10] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.14),transparent_70%)]"
      />

      <HeaderBar
        credits={credits}
        onOpenCredits={() => setIsCreditModalOpen(true)}
        onOpenDeployGuide={() => setIsDeployModalOpen(true)}
        onGoHome={() => {
          if (currentStep !== 5) setCurrentStep(1);
        }}
      />

      <main className="relative flex-1 mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:py-8">
        <WizardStepper
          currentStep={currentStep}
          maxReachedStep={maxReachedStep}
          onSelectStep={(step) => goToStep(step)}
          isProcessing={currentStep === 5 && !processingError}
        />

        {banner && (
          <div
            role="status"
            className={`mx-auto mb-5 flex max-w-4xl items-center gap-3 rounded-xl border px-4 py-3 text-xs sm:text-sm font-medium ${
              banner.type === 'error'
                ? 'border-red-500/40 bg-red-500/10 text-red-200'
                : 'border-blue-500/40 bg-blue-500/12 text-blue-200'
            }`}
          >
            {banner.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {/* Active Step View — Strictly One Step at a Time */}
        {currentStep === 1 && (
          <WizardStep1Video
            activeTool={activeTool}
            onChangeTool={setActiveTool}
            linkInput={linkInput}
            onChangeLinkInput={setLinkInput}
            onSubmitLink={handleSubmitLink}
            onUploadMp4={handleUploadMp4}
            onLoadSample={handleLoadSample}
            sourceLoading={sourceLoading}
            uploadPercent={uploadPercent}
            videoUrl={videoUrl}
            videoTitle={videoTitle}
            durationSeconds={durationSeconds}
            onNext={() => goToStep(2)}
          />
        )}

        {currentStep === 2 && (
          <WizardStep2Voice
            activeTool={activeTool}
            voiceGender={voiceGender}
            onChangeVoiceGender={setVoiceGender}
            voiceStyle={voiceStyle}
            onChangeVoiceStyle={setVoiceStyle}
            voiceSpeed={voiceSpeed}
            onChangeVoiceSpeed={setVoiceSpeed}
            musicMood={musicMood}
            onChangeMusicMood={setMusicMood}
            sfxEnabled={sfxEnabled}
            onToggleSfx={setSfxEnabled}
            onBack={() => goToStep(1)}
            onNext={() => goToStep(3)}
          />
        )}

        {currentStep === 3 && (
          <WizardStep3PreviewCustomize
            videoUrl={videoUrl}
            videoTitle={videoTitle}
            videoWidth={videoDimensions.width}
            videoHeight={videoDimensions.height}
            sourceRevision={autoBlurSourceVersion}
            durationSeconds={durationSeconds}
            captions={captions}
            onUpdateCaption={handleUpdateCaption}
            onNormalizeLongCaptions={handleNormalizeLongCaptions}
            captionStyle={captionStyle}
            onChangeCaptionStyle={setCaptionStyle}
            captionDecoration={captionDecoration}
            onChangeCaptionDecoration={setCaptionDecoration}
            autoBlurEnabled={autoBlurEnabled}
            onToggleAutoBlur={setAutoBlurEnabled}
            autoBlurStrength={autoBlurStrength}
            onChangeAutoBlurStrength={setAutoBlurStrength}
            autoBlurStyle={autoBlurStyle}
            onChangeAutoBlurStyle={setAutoBlurStyle}
            autoBlurRegions={autoBlurRegions}
            autoBlurStatus={autoBlurStatus}
            autoBlurError={autoBlurError}
            onRetryAutoBlur={() => setAutoBlurSourceVersion((version) => version + 1)}
            subPos={subPos}
            onChangeSubPos={setSubPos}
            logoUrl={logoPreviewUrl}
            logoEnabled={logoEnabled}
            onToggleLogo={setLogoEnabled}
            logoScale={logoScale}
            onChangeLogoScale={setLogoScale}
            logoPos={logoPos}
            onChangeLogoPos={setLogoPos}
            onUploadLogo={handleUploadLogo}
            ttsAudioUrl={ttsAudioUrl}
            thumbnailTitle={thumbnailTitle}
            onThumbnailCanvasReady={(blob) => {
              thumbnailBlobRef.current = blob;
            }}
            onLoadSample={handleLoadSample}
            sourceLoading={sourceLoading}
            onBack={() => goToStep(2)}
            onNext={() => goToStep(4)}
          />
        )}

        {currentStep === 4 && (
          <WizardStep4Export
            videoUrl={videoUrl}
            resolution={resolution}
            onChangeResolution={setResolution}
            thumbnailTitle={thumbnailTitle}
            onChangeThumbnailTitle={(val) => {
              hasCustomThumbTitleRef.current = true;
              setThumbnailTitle(val);
            }}
            thumbnailAspectRatio={thumbnailAspectRatio}
            onChangeThumbnailAspectRatio={setThumbnailAspectRatio}
            thumbnailAnalysis={thumbnailAnalysis}
            thumbnailAnalyzing={thumbnailAnalyzing}
            onAnalyzeThumbnail={() => {
              hasCustomThumbTitleRef.current = false;
              void analyzeVideoContentThumbnail();
            }}
            onThumbnailCanvasReady={(blob) => {
              thumbnailBlobRef.current = blob;
            }}
            credits={credits}
            creditCost={creditCost}
            onOpenCredits={() => setIsCreditModalOpen(true)}
            onBack={() => goToStep(3)}
            onGenerate={runFullGenerationPipeline}
          />
        )}

        {currentStep === 5 && (
          <WizardStep5Processing
            activeTool={activeTool}
            progress={progress}
            errorText={processingError}
            onRetry={runFullGenerationPipeline}
            onBackToStep4={() => {
              setProcessingError(null);
              goToStep(4);
            }}
          />
        )}

        {currentStep === 6 && (
          <WizardStep6Result
            finalVideoUrl={finalVideoUrl}
            finalThumbnailUrl={finalThumbnailUrl}
            thumbnailTitle={thumbnailTitle}
            thumbnailAspectRatio={thumbnailAspectRatio}
            thumbnailAnalysis={thumbnailAnalysis}
            thumbnailUpdating={thumbnailUpdating}
            onChangeResultThumbnailRatio={(r) => void handleSwitchResultThumbnailRatio(r)}
            resolution={resolution}
            syncSummary={syncSummary}
            telegramChatId={telegramChatId}
            onChangeTelegramChatId={setTelegramChatId}
            onSendTelegram={handleSendTelegram}
            telegramSending={telegramSending}
            onBackToEdit={() => goToStep(3)}
            onStartNew={handleStartNew}
          />
        )}
      </main>

      <footer className="border-t border-white/10 py-5 text-xs text-slate-500">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0" />
            <span>အကောင့်မလို · စာမျက်နှာပိတ်သည်နှင့် ဖိုင်အားလုံး အလိုအလျောက် ဖျက်သိမ်းပေးသည်</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setIsCreditModalOpen(true)}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              KBZPay / PromptPay ခရက်ဒစ်
            </button>
            <button
              type="button"
              onClick={() => setIsDeployModalOpen(true)}
              className="hover:text-slate-200 transition-colors cursor-pointer"
            >
              Render & GitHub Pages Deploy လမ်းညွှန်
            </button>
          </div>
        </div>
      </footer>

      <CreditModal
        isOpen={isCreditModalOpen}
        currentCredits={credits}
        onClose={() => setIsCreditModalOpen(false)}
        onSuccessAddCredits={(added, msg) => {
          setCredits((c) => c + added);
          showSuccess(msg);
        }}
      />

      <DeployGuideModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
      />
    </div>
  );
}
