import React, { useEffect, useRef } from 'react';
import { Sparkles, Eye } from 'lucide-react';
import type { ThumbnailAnalysis, ThumbnailAspectRatio } from '../types/studio';
import { renderViralThumbnailToCanvas } from '../utils/thumbnailCanvas';
import { getThumbnailPreset } from '../utils/thumbnailLogic';

interface ContentThumbnailPreviewProps {
  thumbnailTitle: string;
  aspectRatio: ThumbnailAspectRatio;
  videoUrl: string | null;
  analysis: ThumbnailAnalysis | null;
  analyzing?: boolean;
  onBlobReady?: (blob: Blob | null) => void;
}

export const ContentThumbnailPreview: React.FC<ContentThumbnailPreviewProps> = ({
  thumbnailTitle,
  aspectRatio,
  videoUrl,
  analysis,
  analyzing = false,
  onBlobReady,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preset = getThumbnailPreset(aspectRatio);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderViralThumbnailToCanvas(canvas, {
      thumbnailTitle,
      aspectRatio,
      videoUrl,
      analysis,
    }).then((blob) => {
      if (!cancelled && onBlobReady) {
        onBlobReady(blob);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [thumbnailTitle, aspectRatio, videoUrl, analysis, onBlobReady]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-300">
          ဗီဒီယိုအကြောင်းအရာအခြေခံ Thumbnail အစမ်းပုံစံ ({preset.platformMy})
        </span>
        <span className="font-mono-tabular text-[11px] text-blue-300">
          {preset.width} × {preset.height}
        </span>
      </div>

      <div className="flex items-center justify-center rounded-xl border border-white/10 bg-[#05070B] p-3">
        <div
          style={{ aspectRatio: preset.cssAspectRatio }}
          className={`relative overflow-hidden rounded-lg border border-white/10 bg-black shadow-xl ${
            aspectRatio === '9:16'
              ? 'h-[320px] w-auto'
              : aspectRatio === '1:1'
                ? 'h-[260px] w-auto'
                : 'w-full max-w-[460px]'
          }`}
        >
          <canvas
            ref={canvasRef}
            data-testid="content-thumbnail-canvas"
            data-aspect-ratio={aspectRatio}
            className="block h-full w-full object-contain"
          />
          {analyzing && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#090B10]/70 backdrop-blur-xs">
              <span className="text-xs font-semibold text-blue-200">
                ဗီဒီယိုဖရိန်များ စစ်ဆေးနေသည်...
              </span>
            </div>
          )}
        </div>
      </div>

      {analysis && (
        <div
          data-testid="thumbnail-subject-summary"
          className="rounded-xl border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5 text-xs space-y-1"
        >
          <div className="flex flex-wrap items-center gap-2 text-blue-300 font-semibold">
            {analysis.usedVisionModel ? (
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Eye className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>အဓိကအကြောင်းအရာ: {analysis.subjectLabelMy}</span>
            <span className="font-mono-tabular text-[11px] text-slate-400">
              ({analysis.frameTimestamp.toFixed(1)}s ဖရိန်)
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">{analysis.subjectSummaryMy}</p>
        </div>
      )}
    </div>
  );
};
