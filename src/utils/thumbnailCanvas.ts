import type { ThumbnailAnalysis, ThumbnailAspectRatio } from '../types/studio';
import {
  computeFocalCoverCrop,
  getAccentPalette,
  getThumbnailDimensions,
  wrapHeadlineLines,
} from './thumbnailLogic';

export interface RenderThumbnailOptions {
  thumbnailTitle: string;
  aspectRatio: ThumbnailAspectRatio;
  videoUrl: string | null;
  analysis: ThumbnailAnalysis | null;
}

async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 3500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

async function loadVideoFrameElement(
  videoUrl: string,
  seekSeconds: number
): Promise<HTMLVideoElement | null> {
  return await new Promise<HTMLVideoElement | null>((resolve) => {
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.playsInline = true;

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok && vid.videoWidth > 0 ? vid : null);
    };

    const timer = setTimeout(() => finish(vid.readyState >= 2 && vid.videoWidth > 0), 3000);

    vid.onseeked = () => finish(true);
    vid.onloadeddata = () => {
      const targetTime = Math.min(Math.max(0.2, seekSeconds), Math.max(0.2, (vid.duration || 4) - 0.1));
      if (Math.abs(vid.currentTime - targetTime) < 0.15) {
        finish(true);
      } else {
        try {
          vid.currentTime = targetTime;
        } catch {
          finish(true);
        }
      }
    };
    vid.onerror = () => finish(false);
    vid.src = videoUrl;
  });
}

/**
 * Draws a scroll-stopping, high-contrast thumbnail using ONLY the actual video content,
 * focal-cropped to the chosen platform aspect ratio (16:9, 9:16, 1.91:1, or 1:1)
 * with bold readable Myanmar typography placed clear of the main visual subject.
 */
export async function renderViralThumbnailToCanvas(
  canvas: HTMLCanvasElement,
  options: RenderThumbnailOptions
): Promise<Blob | null> {
  const { thumbnailTitle, aspectRatio, videoUrl, analysis } = options;
  const { width, height } = getThumbnailDimensions(aspectRatio);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Resolve real visual frame from video (analyzed keyframe image first, fallback to seeking video directly)
  let bgSource: HTMLImageElement | HTMLVideoElement | null = null;
  if (analysis?.frameUrl) {
    bgSource = await loadImageElement(analysis.frameUrl);
  }
  if (!bgSource && videoUrl) {
    bgSource = await loadVideoFrameElement(videoUrl, analysis?.frameTimestamp ?? 1.8);
  }

  ctx.fillStyle = '#090B10';
  ctx.fillRect(0, 0, width, height);

  if (bgSource) {
    const srcW =
      bgSource instanceof HTMLVideoElement
        ? bgSource.videoWidth || 1280
        : bgSource.naturalWidth || 1280;
    const srcH =
      bgSource instanceof HTMLVideoElement
        ? bgSource.videoHeight || 720
        : bgSource.naturalHeight || 720;

    // Smart focal crop centered on actual detected subject (never stretches or distorts)
    const crop = computeFocalCoverCrop(
      srcW,
      srcH,
      width,
      height,
      analysis?.focusX ?? 50,
      analysis?.focusY ?? 45
    );

    ctx.save();
    // Subtle crisp punchy contrast boost strictly on real video pixels (no fake elements added)
    ctx.filter = 'contrast(1.08) saturate(1.12)';
    ctx.drawImage(bgSource, crop.sx, crop.sy, crop.sWidth, crop.sHeight, 0, 0, width, height);
    ctx.restore();
  }

  const textPos = analysis?.textPosition ?? 'bottom';
  const palette = getAccentPalette(analysis?.accentTheme ?? 'gold');

  // High-contrast scrim gradient positioned ONLY behind headline band so main subject stays vibrant
  if (textPos === 'top') {
    const topGrad = ctx.createLinearGradient(0, 0, 0, height * 0.56);
    topGrad.addColorStop(0, 'rgba(7, 9, 14, 0.92)');
    topGrad.addColorStop(0.55, 'rgba(7, 9, 14, 0.52)');
    topGrad.addColorStop(1, 'rgba(7, 9, 14, 0.0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, height);
  } else {
    const botGrad = ctx.createLinearGradient(0, height * 0.42, 0, height);
    botGrad.addColorStop(0, 'rgba(7, 9, 14, 0.0)');
    botGrad.addColorStop(0.45, 'rgba(7, 9, 14, 0.55)');
    botGrad.addColorStop(1, 'rgba(7, 9, 14, 0.94)');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // Subtle clean high-contrast framing edge
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // Typography metrics tuned cleanly for 16:9, 9:16, 1.91:1, and 1:1
  const headline =
    thumbnailTitle.trim() || analysis?.headlineMy?.trim() || 'ဗီဒီယိုအနှစ်ချုပ်';

  const isPortrait = aspectRatio === '9:16';
  const isUltraWide = aspectRatio === '1.91:1';
  const maxCharsPerLine = isPortrait ? 13 : aspectRatio === '1:1' ? 15 : 24;
  const lines = wrapHeadlineLines(headline, maxCharsPerLine);

  const baseFontPx = isPortrait
    ? Math.round(width * 0.078)
    : isUltraWide
      ? Math.round(height * 0.115)
      : aspectRatio === '1:1'
        ? Math.round(width * 0.072)
        : Math.round(height * 0.098);

  const fontSize = lines.length > 1 ? Math.round(baseFontPx * 0.9) : baseFontPx;
  const lineGap = Math.round(fontSize * 1.18);
  const maxTextWidth = width - Math.round(width * 0.12);

  ctx.font = `800 ${fontSize}px "Noto Sans Myanmar", "Outfit", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const totalTextHeight = lines.length * lineGap;
  const marginEdge = isPortrait ? Math.round(height * 0.095) : Math.round(height * 0.11);
  const blockCenterY =
    textPos === 'top'
      ? marginEdge + totalTextHeight / 2
      : height - marginEdge - totalTextHeight / 2;

  // High-contrast accent bar anchoring the headline block cleanly
  const barWidth = Math.min(Math.round(width * 0.24), 260);
  const barHeight = Math.max(6, Math.round(fontSize * 0.11));
  const barY =
    textPos === 'top'
      ? blockCenterY - totalTextHeight / 2 - barHeight * 2.2
      : blockCenterY + totalTextHeight / 2 + barHeight * 1.4;

  ctx.fillStyle = palette.barColor;
  ctx.fillRect(width / 2 - barWidth / 2, barY, barWidth, barHeight);

  // Render bold legible headline lines with heavy dark stroke + crisp shadow
  lines.forEach((line, idx) => {
    const y = blockCenterY + (idx - (lines.length - 1) / 2) * lineGap;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = Math.round(fontSize * 0.34);
    ctx.shadowOffsetY = Math.round(fontSize * 0.06);
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(8, Math.round(fontSize * 0.18));
    ctx.strokeStyle = '#07090E';
    ctx.strokeText(line, width / 2, y, maxTextWidth);

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = idx === 0 ? '#FFFFFF' : palette.highlightColor;
    ctx.fillText(line, width / 2, y, maxTextWidth);
    ctx.restore();
  });

  return await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.93)
  );
}

export async function renderViralThumbnailBlob(
  thumbnailTitle: string,
  videoUrl: string | null,
  aspectRatio: ThumbnailAspectRatio = '16:9',
  analysis: ThumbnailAnalysis | null = null
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  return await renderViralThumbnailToCanvas(canvas, {
    thumbnailTitle,
    aspectRatio,
    videoUrl,
    analysis,
  });
}
