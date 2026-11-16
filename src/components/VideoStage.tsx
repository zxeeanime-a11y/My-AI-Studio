import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Film,
  Image as ImageIcon,
  Move,
  Pause,
  Pencil,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AutoBlurRegion,
  AutoBlurStyle,
  CaptionAnimationStyle,
  CaptionDecorationConfig,
  CaptionSegment,
  OverlayPosition,
} from '../types/studio';
import {
  CAPTION_BOTTOM_SAFETY_MARGIN_PCT,
  CAPTION_BOX_MAX_WIDTH_PCT,
  CAPTION_LINE_HEIGHT,
  CAPTION_SIDE_SAFETY_MARGIN_PCT,
  clampPointerToVideoViewport,
  computeContainedVideoRect,
  countCharacters,
  DEFAULT_CAPTION_DECORATION,
  formatTimecode,
  getActiveCaptionAtTime,
  hexToRgba,
  sanitizeCaptionDecoration,
  splitLongCaptionsToMaxTwoLines,
} from '../utils/studioLogic';
import { renderViralThumbnailToCanvas } from '../utils/thumbnailCanvas';

interface VideoStageProps {
  videoUrl: string | null;
  videoTitle: string;
  videoWidth?: number;
  videoHeight?: number;
  sourceRevision: number;
  durationSeconds: number;
  captions: CaptionSegment[];
  onUpdateCaption?: (id: string, field: 'text' | 'emoji', val: string) => void;
  onNormalizeLongCaptions?: () => void;
  captionStyle: CaptionAnimationStyle;
  captionDecoration?: CaptionDecorationConfig;
  autoBlurEnabled: boolean;
  autoBlurStrength: number;
  autoBlurStyle: AutoBlurStyle;
  autoBlurRegions: AutoBlurRegion[];
  subPos: OverlayPosition;
  onChangeSubPos: (pos: OverlayPosition) => void;
  logoUrl: string | null;
  logoEnabled: boolean;
  logoScale: number;
  logoPos: OverlayPosition;
  onChangeLogoPos: (pos: OverlayPosition) => void;
  ttsAudioUrl: string | null;
  thumbnailTitle: string;
  onThumbnailCanvasReady: (blob: Blob | null) => void;
  onLoadSample: () => void;
  sampleLoading: boolean;
  showThumbnailCard?: boolean;
}

export const VideoStage: React.FC<VideoStageProps> = ({
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
  captionDecoration,
  autoBlurEnabled,
  autoBlurStrength,
  autoBlurStyle,
  autoBlurRegions,
  subPos,
  onChangeSubPos,
  logoUrl,
  logoEnabled,
  logoScale,
  logoPos,
  onChangeLogoPos,
  ttsAudioUrl,
  thumbnailTitle,
  onThumbnailCanvasReady,
  onLoadSample,
  sampleLoading,
  showThumbnailCard = true,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const captionBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoBlurCanvasRef = useRef<HTMLCanvasElement>(null);
  const blurBufferRef = useRef<HTMLCanvasElement | null>(null);
  const pixelBufferRef = useRef<HTMLCanvasElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);
  const pendingDragRef = useRef<{
    target: 'subtitle' | 'logo';
    startX: number;
    startY: number;
    pointerId: number;
    el: HTMLElement;
    activated: boolean;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingTarget, setDraggingTarget] = useState<'subtitle' | 'logo' | null>(null);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState<string>('');
  const [thumbPreviewUrl, setThumbPreviewUrl] = useState<string>('');
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number }>({
    width: videoWidth > 0 ? videoWidth : 1280,
    height: videoHeight > 0 ? videoHeight : 720,
  });
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 640,
    height: 360,
  });

  const deco = sanitizeCaptionDecoration(captionDecoration || DEFAULT_CAPTION_DECORATION);

  const paintAutoBlurFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = autoBlurCanvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;

    const scale = Math.min(1, 1280 / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    if (!autoBlurEnabled || autoBlurRegions.length === 0) return;

    if (autoBlurStyle === 'blur') {
      if (!blurBufferRef.current) blurBufferRef.current = document.createElement('canvas');
      const buffer = blurBufferRef.current;
      if (buffer.width !== width || buffer.height !== height) {
        buffer.width = width;
        buffer.height = height;
      }
      const bufferContext = buffer.getContext('2d');
      if (!bufferContext) return;
      bufferContext.filter = `blur(${Math.max(1, autoBlurStrength * scale)}px)`;
      bufferContext.drawImage(video, 0, 0, width, height);
      bufferContext.filter = 'none';
      for (const region of autoBlurRegions) {
        const paddingX = Math.max(2, Math.round((region.width / 1000) * width * 0.06));
        const paddingY = Math.max(2, Math.round((region.height / 1000) * height * 0.12));
        const x = Math.max(0, Math.floor((region.x / 1000) * width) - paddingX);
        const y = Math.max(0, Math.floor((region.y / 1000) * height) - paddingY);
        const right = Math.min(width, Math.ceil(((region.x + region.width) / 1000) * width) + paddingX);
        const bottom = Math.min(height, Math.ceil(((region.y + region.height) / 1000) * height) + paddingY);
        if (right > x && bottom > y) {
          context.drawImage(buffer, x, y, right - x, bottom - y, x, y, right - x, bottom - y);
        }
      }
      return;
    }

    for (const region of autoBlurRegions) {
      const paddingX = Math.max(2, Math.round((region.width / 1000) * width * 0.06));
      const paddingY = Math.max(2, Math.round((region.height / 1000) * height * 0.12));
      const x = Math.max(0, Math.floor((region.x / 1000) * width) - paddingX);
      const y = Math.max(0, Math.floor((region.y / 1000) * height) - paddingY);
      const right = Math.min(width, Math.ceil(((region.x + region.width) / 1000) * width) + paddingX);
      const bottom = Math.min(height, Math.ceil(((region.y + region.height) / 1000) * height) + paddingY);
      const regionWidth = right - x;
      const regionHeight = bottom - y;
      if (regionWidth <= 0 || regionHeight <= 0) continue;

      if (autoBlurStyle === 'solid') {
        context.fillStyle = '#000000';
        context.fillRect(x, y, regionWidth, regionHeight);
        continue;
      }

      const blockSize = Math.max(2, Math.round(autoBlurStrength * scale));
      const smallWidth = Math.max(1, Math.round(regionWidth / blockSize));
      const smallHeight = Math.max(1, Math.round(regionHeight / blockSize));
      if (!pixelBufferRef.current) pixelBufferRef.current = document.createElement('canvas');
      const pixelBuffer = pixelBufferRef.current;
      pixelBuffer.width = smallWidth;
      pixelBuffer.height = smallHeight;
      const pixelContext = pixelBuffer.getContext('2d');
      if (!pixelContext) return;
      pixelContext.drawImage(video, x, y, regionWidth, regionHeight, 0, 0, smallWidth, smallHeight);
      context.imageSmoothingEnabled = false;
      context.drawImage(pixelBuffer, 0, 0, smallWidth, smallHeight, x, y, regionWidth, regionHeight);
      context.imageSmoothingEnabled = true;
    }
  }, [autoBlurEnabled, autoBlurRegions, autoBlurStrength, autoBlurStyle]);

  useEffect(() => {
    let frameId = 0;
    const paint = () => {
      paintAutoBlurFrame();
      if (isPlaying) frameId = window.requestAnimationFrame(paint);
    };
    paint();
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [isPlaying, paintAutoBlurFrame, sourceRevision, videoUrl]);

  useEffect(() => {
    setNaturalDims({
      width: videoWidth > 0 ? videoWidth : 1280,
      height: videoHeight > 0 ? videoHeight : 720,
    });
  }, [videoWidth, videoHeight, videoUrl]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setStageSize({ width: r.width, height: r.height });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const containedRect = computeContainedVideoRect(
    stageSize.width,
    stageSize.height,
    naturalDims.width,
    naturalDims.height
  );

  // Sync TTS preview audio with video playback when available
  const togglePlayback = async () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      await vid.play();
      if (ttsAudioRef.current && ttsAudioUrl) {
        ttsAudioRef.current.currentTime = Math.min(vid.currentTime, ttsAudioRef.current.duration || 0);
        ttsAudioRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    } else {
      vid.pause();
      ttsAudioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (val: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = val;
    setCurrentTime(val);
    window.requestAnimationFrame(paintAutoBlurFrame);
    if (ttsAudioRef.current && ttsAudioUrl) {
      ttsAudioRef.current.currentTime = val;
    }
  };

  // Dragging logic strictly constrained INSIDE the actual rendered video viewport matching original video resolution
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pending = pendingDragRef.current;
    let activeTarget = draggingTarget;

    if (!activeTarget && pending) {
      const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (dist < 3) return;
      pending.activated = true;
      activeTarget = pending.target;
      setDraggingTarget(pending.target);
      try {
        pending.el.setPointerCapture(pending.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable
      }
    }

    if (!activeTarget || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const targetSelector =
      activeTarget === 'subtitle'
        ? '[data-testid="draggable-caption"]'
        : '[data-testid="draggable-logo"]';
    const targetEl = viewportRef.current.querySelector(targetSelector) as HTMLElement | null;

    const clamped = clampPointerToVideoViewport({
      clientX: e.clientX,
      clientY: e.clientY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      overlayWidthPx: targetEl?.offsetWidth || 80,
      overlayHeightPx: targetEl?.offsetHeight || 36,
      bottomSafetyMarginPct: activeTarget === 'subtitle' ? CAPTION_BOTTOM_SAFETY_MARGIN_PCT : 0,
      topSafetyMarginPct: activeTarget === 'subtitle' ? 4 : 0,
      sideSafetyMarginPct: activeTarget === 'subtitle' ? CAPTION_SIDE_SAFETY_MARGIN_PCT : 0,
    });

    if (activeTarget === 'subtitle') {
      onChangeSubPos(clamped);
    } else {
      onChangeLogoPos(clamped);
    }
  };

  const stopDragging = () => {
    pendingDragRef.current = null;
    setDraggingTarget(null);
  };

  // Auto-split any captions exceeding 2 lines at the current video aspect & font scale
  const readableCaptions = splitLongCaptionsToMaxTwoLines(captions, {
    videoWidth: naturalDims.width,
    videoHeight: naturalDims.height,
    fontSizeScale: deco.fontSizeScale,
  });

  // Active caption at current playback time, or fallback to first caption so user can always preview & drag
  const rawActiveCaption =
    getActiveCaptionAtTime(captions, currentTime) ||
    (captions.length > 0 ? captions[0] : null);
  const splitActiveCaption =
    getActiveCaptionAtTime(readableCaptions, currentTime) ||
    (readableCaptions.length > 0 ? readableCaptions[0] : null);
  const activeCaption =
    editingCaptionId && rawActiveCaption
      ? rawActiveCaption
      : splitActiveCaption || rawActiveCaption;

  // Re-clamp subtitle strictly inside actual video viewport & 9% bottom safety margin
  useEffect(() => {
    const vp = viewportRef.current;
    const capEl = captionBoxRef.current;
    if (!vp || !capEl || !activeCaption) return;
    const vpRect = vp.getBoundingClientRect();
    const capRect = capEl.getBoundingClientRect();
    if (vpRect.width <= 0 || vpRect.height <= 0 || capRect.width <= 0 || capRect.height <= 0) return;

    const centerClientX = vpRect.left + (subPos.x / 100) * vpRect.width;
    const centerClientY = vpRect.top + (subPos.y / 100) * vpRect.height;
    const reclamped = clampPointerToVideoViewport({
      clientX: centerClientX,
      clientY: centerClientY,
      rect: { left: vpRect.left, top: vpRect.top, width: vpRect.width, height: vpRect.height },
      overlayWidthPx: capRect.width,
      overlayHeightPx: capRect.height,
      bottomSafetyMarginPct: CAPTION_BOTTOM_SAFETY_MARGIN_PCT,
      topSafetyMarginPct: 4,
      sideSafetyMarginPct: CAPTION_SIDE_SAFETY_MARGIN_PCT,
    });
    if (Math.abs(reclamped.x - subPos.x) > 0.2 || Math.abs(reclamped.y - subPos.y) > 0.2) {
      onChangeSubPos(reclamped);
    }
  }, [
    deco.fontSizeScale,
    deco.borderEnabled,
    deco.borderThickness,
    deco.blurBgEnabled,
    deco.bgCornerRadius,
    activeCaption?.id,
    activeCaption?.text,
    containedRect.width,
    containedRect.height,
  ]);

  const animClass =
    captionStyle === 'pop'
      ? 'animate-caption-pop'
      : captionStyle === 'glow'
        ? 'animate-caption-glow'
        : 'animate-caption-slide';

  const commitInlineEdit = () => {
    if (editingCaptionId && onUpdateCaption) {
      onUpdateCaption(editingCaptionId, 'text', inlineDraft);
      onNormalizeLongCaptions?.();
    }
    setEditingCaptionId(null);
  };

  const liveFontSizePx = Math.max(11, Math.round(containedRect.height * 0.044 * deco.fontSizeScale));

  // Render content-driven thumbnail onto canvas when enabled
  useEffect(() => {
    if (!showThumbnailCard) return;
    let cancelled = false;
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;

    renderViralThumbnailToCanvas(canvas, {
      thumbnailTitle,
      aspectRatio: '16:9',
      videoUrl,
      analysis: null,
    }).then((blob) => {
      if (cancelled) return;
      onThumbnailCanvasReady(blob);
      if (blob) {
        const url = URL.createObjectURL(blob);
        setThumbPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [showThumbnailCard, thumbnailTitle, videoUrl]);

  const titleCharCount = countCharacters(thumbnailTitle);

  return (
    <div className="space-y-5">
      {/* Live Interactive Video Stage */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 blue-glow-ring">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-100 truncate">
              {videoTitle || 'တိုက်ရိုက် အစမ်းကြည့်ရှုစင်မြင့် (Live Preview Stage)'}
            </h2>
            <p className="text-xs text-slate-400">
              စာတန်းကို ဆွဲရွှေ့၍ နေရာချနိုင်ပြီး နှစ်ချက်နှိပ် (Double-click) ၍ စာသားတိုက်ရိုက်ပြင်နိုင်သည်
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 font-mono-tabular text-xs text-slate-400">
            <span data-testid="video-resolution-badge" className="text-blue-300">
              {naturalDims.width}×{naturalDims.height}
            </span>
            <span aria-hidden="true">·</span>
            <span>စာတန်း: X {subPos.x.toFixed(0)}% · Y {subPos.y.toFixed(0)}%</span>
            {logoEnabled && (
              <>
                <span aria-hidden="true">/</span>
                <span>လိုဂို: X {logoPos.x.toFixed(0)}% · Y {logoPos.y.toFixed(0)}%</span>
              </>
            )}
          </div>
        </div>

        {/* Outer Dark Stage Container preserving original video aspect ratio via contained viewport */}
        <div
          ref={stageRef}
          data-testid="video-preview-stage"
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onPointerLeave={stopDragging}
          className="relative flex h-[320px] sm:h-[420px] w-full items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-[#05070B] select-none touch-none"
        >
          {videoUrl ? (
            <div
              ref={viewportRef}
              data-testid="actual-video-viewport"
              style={{
                width: `${containedRect.width}px`,
                height: `${containedRect.height}px`,
              }}
              className="relative overflow-hidden bg-black"
            >
              <video
                key={`${videoUrl}-${sourceRevision}`}
                ref={videoRef}
                src={videoUrl}
                muted={isMuted || Boolean(ttsAudioUrl)}
                playsInline
                onLoadedMetadata={(e) => {
                  const vw = e.currentTarget.videoWidth;
                  const vh = e.currentTarget.videoHeight;
                  if (vw > 0 && vh > 0) {
                    setNaturalDims({ width: vw, height: vh });
                  }
                  window.requestAnimationFrame(paintAutoBlurFrame);
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onEnded={() => {
                  setIsPlaying(false);
                  ttsAudioRef.current?.pause();
                }}
                className="absolute h-px w-px opacity-0 pointer-events-none"
              />
              <canvas
                ref={autoBlurCanvasRef}
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-contain pointer-events-none"
              />
              {ttsAudioUrl && (
                <audio
                  ref={ttsAudioRef}
                  src={ttsAudioUrl}
                  muted={isMuted}
                  className="hidden"
                />
              )}

              {/* Draggable & Double-Click Editable Myanmar Caption Overlay — bounded strictly inside actual video viewport */}
              {activeCaption && (
                <div
                  ref={captionBoxRef}
                  data-testid="draggable-caption"
                  onPointerDown={(e) => {
                    if (editingCaptionId === activeCaption.id) return;
                    e.stopPropagation();
                    pendingDragRef.current = {
                      target: 'subtitle',
                      startX: e.clientX,
                      startY: e.clientY,
                      pointerId: e.pointerId,
                      el: e.currentTarget,
                      activated: false,
                    };
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    pendingDragRef.current = null;
                    setDraggingTarget(null);
                    const editableTarget =
                      captions.find((c) => c.id === activeCaption.id) ||
                      captions.find((c) => activeCaption.id.startsWith(`${c.id}_p`)) ||
                      activeCaption;
                    setEditingCaptionId(editableTarget.id);
                    setInlineDraft(editableTarget.text);
                  }}
                  style={{
                    left: `${subPos.x}%`,
                    top: `${subPos.y}%`,
                    maxWidth: `${Math.round(containedRect.width * (CAPTION_BOX_MAX_WIDTH_PCT / 100))}px`,
                    width: 'max-content',
                    boxSizing: 'border-box',
                  }}
                  className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 ${
                    editingCaptionId === activeCaption.id
                      ? 'cursor-text'
                      : 'cursor-grab active:cursor-grabbing'
                  }`}
                  title="ဆွဲ၍ နေရာရွှေ့ပါ · နှစ်ချက်နှိပ်၍ စာသားပြင်ပါ"
                >
                  <div
                    key={editingCaptionId === activeCaption.id ? 'editing' : activeCaption.id}
                    data-testid="caption-styled-surface"
                    style={{
                      backgroundColor: deco.blurBgEnabled
                        ? hexToRgba(deco.bgColor, deco.bgOpacity)
                        : 'transparent',
                      backdropFilter:
                        deco.blurBgEnabled && deco.blurIntensity > 0
                          ? `blur(${deco.blurIntensity}px)`
                          : 'none',
                      WebkitBackdropFilter:
                        deco.blurBgEnabled && deco.blurIntensity > 0
                          ? `blur(${deco.blurIntensity}px)`
                          : 'none',
                      borderRadius: deco.blurBgEnabled ? `${deco.bgCornerRadius}px` : '0px',
                      border: deco.blurBgEnabled
                        ? '1px solid rgba(255, 255, 255, 0.16)'
                        : '1px solid transparent',
                      padding: deco.blurBgEnabled ? '6px 12px' : '4px 6px',
                    }}
                    className={`text-center transition-[background-color,border-radius] duration-150 ${
                      editingCaptionId === activeCaption.id ? 'ring-2 ring-blue-400/80' : animClass
                    }`}
                  >
                    {editingCaptionId === activeCaption.id ? (
                      <div
                        className="flex flex-col items-center gap-1"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <textarea
                          data-testid="inline-caption-editor"
                          aria-label="ဗီဒီယိုပေါ်တွင် စာတန်းတိုက်ရိုက်ပြင်ဆင်ရန်"
                          autoFocus
                          rows={2}
                          value={inlineDraft}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setInlineDraft(nextVal);
                            onUpdateCaption?.(activeCaption.id, 'text', nextVal);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              commitInlineEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingCaptionId(null);
                            }
                          }}
                          onBlur={commitInlineEdit}
                          style={{
                            color: deco.textColor,
                            fontSize: `${liveFontSizePx}px`,
                            lineHeight: CAPTION_LINE_HEIGHT,
                            width: `${Math.max(120, Math.round(containedRect.width * 0.66))}px`,
                            maxWidth: '100%',
                          }}
                          className="resize-none rounded-lg border border-blue-400/60 bg-black/55 px-2.5 py-1 text-center font-bold focus:outline-none"
                        />
                        <span className="text-[10px] font-medium text-blue-200">
                          Enter နှိပ်၍ သိမ်းပါ · Esc ပယ်ဖျက်
                        </span>
                      </div>
                    ) : (
                      <div className="group flex items-center justify-center gap-1.5 font-bold">
                        <Move className="h-3.5 w-3.5 text-blue-400/80 shrink-0" aria-hidden="true" />
                        <span
                          data-testid="caption-preview-text"
                          style={{
                            color: deco.textColor,
                            fontSize: `${liveFontSizePx}px`,
                            lineHeight: CAPTION_LINE_HEIGHT,
                            whiteSpace: 'pre-line',
                            WebkitTextStroke: deco.borderEnabled
                              ? `${deco.borderThickness}px ${deco.borderColor}`
                              : '0px transparent',
                            paintOrder: 'stroke fill',
                            textShadow: deco.borderEnabled
                              ? `0 1px 2px ${deco.borderColor}`
                              : deco.blurBgEnabled
                                ? 'none'
                                : '0 2px 6px rgba(0,0,0,0.85)',
                          }}
                          className="min-w-0 break-words text-center"
                        >
                          {activeCaption.text} {activeCaption.emoji}
                        </span>
                        <Pencil
                          className="h-3 w-3 text-slate-300/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Draggable Custom Logo Overlay — bounded strictly inside actual video viewport */}
              {logoEnabled && (
                <div
                  data-testid="draggable-logo"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    pendingDragRef.current = {
                      target: 'logo',
                      startX: e.clientX,
                      startY: e.clientY,
                      pointerId: e.pointerId,
                      el: e.currentTarget,
                      activated: true,
                    };
                    setDraggingTarget('logo');
                    try {
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    } catch {
                      // Ignore
                    }
                  }}
                  style={{
                    left: `${logoPos.x}%`,
                    top: `${logoPos.y}%`,
                    width: `${logoScale}%`,
                  }}
                  className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing rounded-lg border border-dashed border-blue-400/50 bg-black/30 p-1 backdrop-blur-sm"
                  title="လိုဂိုနေရာ ရွှေ့ရန် ဆွဲယူပါ"
                >
                  {logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Custom Channel Logo"
                      className="h-auto w-full rounded object-contain pointer-events-none"
                    />
                  ) : (
                    <div className="flex items-center justify-center gap-1 py-1.5 text-[11px] font-semibold text-blue-300 whitespace-nowrap">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                      <span>LOGO</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="relative flex h-full w-full flex-col items-center justify-center p-6 text-center">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.12),rgba(9,11,16,0.96)_70%)]" />
              <div className="relative z-10 max-w-md space-y-3">
                <Film className="mx-auto h-10 w-10 text-blue-400" />
                <div className="text-base font-semibold text-slate-100">
                  ဗီဒီယို မထည့်သွင်းရသေးပါ
                </div>
                <p className="text-xs leading-relaxed text-slate-300">
                  ဘယ်ဘက်တွင် YouTube / TikTok / Facebook / Instagram လင့်ခ် ထည့်သွင်းပါ (သို့) MP4 ဖိုင်တင်ပါ — သို့မဟုတ် နမူနာရုပ်ရှင်ဖြင့် ချက်ချင်းစမ်းသပ်ကြည့်ပါ။
                </p>
                <button
                  type="button"
                  onClick={onLoadSample}
                  disabled={sampleLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white blue-glow-cta hover:bg-blue-500 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{sampleLoading ? 'နမူနာဖန်တီးနေသည်...' : 'နမူနာရုပ်ရှင် ဖွင့်ကြည့်ရန်'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Playback Transport Controls */}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlayback}
            disabled={!videoUrl}
            aria-label={isPlaying ? 'ခေတ္တရပ်ရန်' : 'ဖွင့်ရန်'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <input
            type="range"
            aria-label="ဗီဒီယို အချိန်ရွှေ့ရန်"
            min={0}
            max={Math.max(1, durationSeconds || 12)}
            step={0.1}
            value={currentTime}
            disabled={!videoUrl}
            onChange={(e) => handleSeek(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-blue-500"
          />

          <span className="font-mono-tabular text-xs text-slate-300 shrink-0">
            {formatTimecode(currentTime)} / {formatTimecode(durationSeconds || 12)}
          </span>

          <button
            type="button"
            onClick={() => setIsMuted((m) => !m)}
            aria-label={isMuted ? 'အသံဖွင့်ရန်' : 'အသံပိတ်ရန်'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Viral Thumbnail Live Preview Card */}
      {showThumbnailCard ? (
        <div className="glass-panel rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Viral Thumbnail အစမ်းပုံစံ (စာလုံး ၂၅ လုံးအောက်)
              </h3>
              <p className="text-xs text-slate-400">
                Telegram နှင့် YouTube/TikTok တင်ရန် အလိုအလျောက် ဖန်တီးထားသည်
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`font-mono-tabular text-xs font-medium ${
                  titleCharCount > 24 ? 'text-red-400' : 'text-blue-400'
                }`}
              >
                {titleCharCount} / 24 လုံး
              </span>
              {thumbPreviewUrl && (
                <a
                  href={thumbPreviewUrl}
                  download="alpharecap_thumbnail.jpg"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Thumbnail ဒေါင်းရန်</span>
                </a>
              )}
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#05070B]">
            <canvas ref={thumbCanvasRef} className="block h-auto w-full aspect-video" />
          </div>
        </div>
      ) : (
        <canvas ref={thumbCanvasRef} className="hidden" aria-hidden="true" />
      )}
    </div>
  );
};
