import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import {
  buildTtsVoicePersonaDirective,
  extractMediaDurationSeconds,
  getVoiceSpeedFactor,
  MAX_UPLOAD_FILE_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  normalizeVoiceSpeed,
  splitLongCaptionsToMaxTwoLines,
  truncateThumbnailTitle,
  validateVideoDuration,
  validateVideoUrl,
  validateVoiceGenderForTool,
  wrapWavHeaderIfNeeded,
  CREDIT_PACKAGES,
} from './src/utils/studioLogic';
import {
  applyMyanmarScriptToTimeline,
  buildFullRecapBeats,
  buildOriginalAudioCaptions,
  buildProportionalCaptionsForDuration,
  buildTimelineFromGroq,
  computeSegmentAwareTimelinePlan,
  computeVideoSpeedSyncPlan,
  getAudioTtsPostFilter,
  normalizeTranscriptSegments,
  parseSilenceDetectOutput,
  scaleWordBudgetForVoiceSpeed,
  splitAudioBoundariesForSegments,
  type GroqSegmentTimestamp,
  type GroqWordTimestamp,
} from './src/utils/audioSync';
import {
  computeCandidateFrameTimestamps,
  getThumbnailDimensions,
  normalizeThumbnailAspectRatio,
  sanitizeThumbnailAnalysisResponse,
  type RawVisionThumbnailResponse,
} from './src/utils/thumbnailLogic';
import {
  extractRetryAfterSeconds,
  isModelNotFoundError,
  isQuotaRateLimitError,
  isTransientNetworkError,
  ModelCooldownTracker,
  withTransientRetry,
} from './src/utils/retry';
import { mergeAutoBlurRegions, sanitizeAutoBlurRegions } from './src/utils/autoBlur';
import type {
  AutoBlurStyle,
  AutoBlurRegion,
  CaptionSegment,
  ExportResolution,
  MusicMood,
  MyanmarVoiceId,
  StudioTool,
  SyncSummary,
  ThumbnailAspectRatio,
  VideoTimelineSegment,
  VoiceGender,
  VoiceSpeed,
} from './src/types/studio';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_ROOT = path.join(os.tmpdir(), 'alpharecap-sessions');
fs.mkdirSync(SESSION_ROOT, { recursive: true });
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'alpharecap-uploads');
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
const UPLOADS_DIR = path.join(APP_ROOT, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o755 });
fs.chmodSync(UPLOADS_DIR, 0o755);
fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);

const SAMPLE_CACHE_DIR = path.join(os.tmpdir(), 'alpharecap-sample');
fs.mkdirSync(SAMPLE_CACHE_DIR, { recursive: true });
const SAMPLE_VIDEO_PATH = path.join(SAMPLE_CACHE_DIR, 'sample_noir.mp4');

// Track session last-accessed timestamps for automatic zero-persistence cleanup
const sessionLastActive = new Map<string, number>();

// Shared cooldown tracker so exhausted Free Tier models (429 / 404) are skipped cleanly
const geminiCooldowns = new ModelCooldownTracker();

function getSessionDir(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid session ID');
  const dir = path.join(SESSION_ROOT, safeId);
  fs.mkdirSync(dir, { recursive: true });
  sessionLastActive.set(safeId, Date.now());
  return dir;
}

function cleanupSessionDir(sessionId: string): void {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return;
  const dir = path.join(SESSION_ROOT, safeId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  sessionLastActive.delete(safeId);
}

// Sweep stale temporary sessions every 5 minutes (15-minute max idle TTL)
setInterval(() => {
  const now = Date.now();
  for (const [id, lastSeen] of sessionLastActive.entries()) {
    if (now - lastSeen > 15 * 60 * 1000) {
      cleanupSessionDir(id);
    }
  }
}, 5 * 60 * 1000).unref();

function createGeminiClient(apiVersion?: 'v1' | 'v1beta'): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      timeout: 60000,
      retryOptions: { attempts: 1 },
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key || key === 'YOUR_GROQ_API_KEY') return null;
  return key;
}

function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN') return null;
  return token;
}

async function checkBinary(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name]);
    return true;
  } catch {
    return false;
  }
}

function moveFileSafely(srcPath: string, destPath: string): void {
  if (srcPath === destPath) return;
  try {
    fs.renameSync(srcPath, destPath);
  } catch {
    fs.copyFileSync(srcPath, destPath);
    fs.rmSync(srcPath, { force: true });
  }
}

function persistUploadedVideo(sourcePath: string, originalFilename: string): void {
  const filename = path.basename(originalFilename.replace(/\\/g, '/'));
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('Uploaded video filename is invalid');
  }

  const destinationPath = path.join(UPLOADS_DIR, filename);
  const temporaryPath = path.join(UPLOADS_DIR, `.${crypto.randomUUID()}.upload`);
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporaryPath, destinationPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

async function probeVideo(filePath: string): Promise<{ duration: number; width: number; height: number; hasAudio: boolean; formatName: string; videoCodec: string }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const info = JSON.parse(stdout || '{}');
  const videoStream = (info.streams || []).find((s: { codec_type?: string }) => s.codec_type === 'video');
  const audioStream = (info.streams || []).find((s: { codec_type?: string }) => s.codec_type === 'audio');
  if (!videoStream) {
    throw new Error('No video stream found in uploaded file');
  }
  let duration = extractMediaDurationSeconds(info);
  if (duration <= 0) {
    // Fallback for malformed container headers missing duration metadata
    try {
      const { stderr } = await execFileAsync('ffmpeg', ['-i', filePath, '-f', 'null', '-']);
      const matches = [...String(stderr || '').matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const last = matches[matches.length - 1];
      if (last) {
        duration = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
      }
    } catch {
      // ignore
    }
  }
  const rawWidth = Number(videoStream?.width || 1280);
  const rawHeight = Number(videoStream?.height || 720);
  const rotateTag = Number(
    videoStream?.tags?.rotate ??
      (Array.isArray(videoStream?.side_data_list)
        ? videoStream.side_data_list.find((d: { rotation?: number }) => typeof d?.rotation === 'number')?.rotation
        : 0) ??
      0
  );
  const isRotatedPortrait = Math.abs(Math.round(rotateTag)) % 180 === 90;
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: isRotatedPortrait ? rawHeight : rawWidth,
    height: isRotatedPortrait ? rawWidth : rawHeight,
    hasAudio: Boolean(audioStream),
    formatName: String(info.format?.format_name || '').toLowerCase(),
    videoCodec: String(videoStream?.codec_name || '').toLowerCase(),
  };
}

async function finalizeUploadedSourceVideo(
  rawPath: string,
  targetMp4Path: string,
  originalFilename: string
): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {
  const ext = path.extname(originalFilename || '').toLowerCase();
  const initialMeta = await probeVideo(rawPath);
  const needsRemuxOrTranscode =
    (ext && ext !== '.mp4' && ext !== '.m4v') ||
    (!initialMeta.formatName.includes('mp4') && !initialMeta.formatName.includes('mov'));

  if (!needsRemuxOrTranscode) {
    moveFileSafely(rawPath, targetMp4Path);
    return initialMeta;
  }

  try {
    // Fast remux to MP4 first
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      rawPath,
      '-c:v',
      initialMeta.videoCodec === 'h264' ? 'copy' : 'libx264',
      ...(initialMeta.videoCodec === 'h264' ? [] : ['-preset', 'veryfast', '-pix_fmt', 'yuv420p']),
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      targetMp4Path,
    ]);
    fs.rmSync(rawPath, { force: true });
    const finalMeta = await probeVideo(targetMp4Path);
    return finalMeta;
  } catch {
    moveFileSafely(rawPath, targetMp4Path);
    return initialMeta;
  }
}

async function probeAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const info = JSON.parse(stdout || '{}');
  const audioStream = (info.streams || []).find((s: { codec_type?: string }) => s.codec_type === 'audio');
  const duration = Number(info.format?.duration || audioStream?.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 1.0;
}

async function detectAudioSilences(audioPath: string): Promise<ReturnType<typeof parseSilenceDetectOutput>> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i',
      audioPath,
      '-af',
      'silencedetect=noise=-32dB:d=0.18',
      '-f',
      'null',
      '-',
    ]);
    return parseSilenceDetectOutput(stderr || '');
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr || '';
    return parseSilenceDetectOutput(stderr);
  }
}

class TtsQuotaError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'TtsQuotaError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function synthesizeGeminiTtsAudio(
  textToSpeak: string,
  speed: VoiceSpeed,
  multiSegment = false,
  voiceStyle: MyanmarVoiceId = 'street_bro',
  voiceGender: VoiceGender = 'male'
): Promise<Uint8Array> {
  const numericSpeed = getVoiceSpeedFactor(speed);
  const speedDirective =
    speed === 'slow' || numericSpeed < 0.95
      ? 'Read very slowly and deliberately at an unhurried ~0.7x calm storytelling pace with gentle pauses between phrases.'
      : numericSpeed >= 1.15
        ? 'Read briskly, clearly, and smoothly with zero extra pauses at a steady conversational pace.'
        : 'Read at a clear, natural ~1.0x conversational pace.';

  const voiceDirective = buildTtsVoicePersonaDirective(voiceGender, voiceStyle);

  const pauseDirective = multiSegment
    ? ' Pause briefly (about half a second) between each separate paragraph line.'
    : '';

  const ttsPrompt = `${voiceDirective} ${speedDirective}${pauseDirective} Read the following Burmese (Myanmar) movie recap narration aloud naturally without reading punctuation or instructions:\n\n${textToSpeak}`;

  // CRITICAL RULE COMPLIANCE: No "speechMetadata" and no "speechConfig" anywhere in the request!
  const candidates: Array<{ apiVersion: 'v1beta' | 'v1'; model: string }> = [
    { apiVersion: 'v1beta', model: 'gemini-3.8-flash-lite-tts' },
    { apiVersion: 'v1beta', model: 'gemini-3.8-flash-tts' },
    { apiVersion: 'v1beta', model: 'gemini-2.5-flash-preview-tts' },
    { apiVersion: 'v1beta', model: 'gemini-2.5-pro-preview-tts' },
    { apiVersion: 'v1', model: 'gemini-3.8-flash-lite-tts' },
  ];

  type TtsResult = Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
  const triedKeys = new Set<string>();
  let ttsResponse: TtsResult | null = null;
  let lastError: unknown = null;
  let sawQuotaLimit = false;
  let shortestRetryAfter = 35;

  const tryCandidate = async (apiVersion: 'v1beta' | 'v1', model: string): Promise<TtsResult | null> => {
    const key = `${apiVersion}:${model}`;
    if (triedKeys.has(key)) return null;
    triedKeys.add(key);

    const quotaKey = `quota:${model}`;
    const notFoundKey = `notfound:${apiVersion}:${model}`;
    if (geminiCooldowns.isCoolingDown(notFoundKey)) return null;
    if (geminiCooldowns.isCoolingDown(quotaKey)) {
      sawQuotaLimit = true;
      const rem = geminiCooldowns.getRemainingSeconds(quotaKey);
      if (rem > 0 && rem < shortestRetryAfter) {
        shortestRetryAfter = rem;
      }
      return null;
    }

    const client = createGeminiClient(apiVersion);
    if (!client) return null;

    try {
      return await withTransientRetry(
        () =>
          client.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: ttsPrompt }] }],
            config: { responseModalities: ['AUDIO'] },
          }),
        2,
        600
      );
    } catch (err) {
      lastError = err;

      if (isQuotaRateLimitError(err)) {
        sawQuotaLimit = true;
        const parsedDelay = extractRetryAfterSeconds(err) || 35;
        geminiCooldowns.markCoolingDown(quotaKey, parsedDelay);
        if (parsedDelay < shortestRetryAfter) {
          shortestRetryAfter = parsedDelay;
        }
        return null; // Fail over immediately to next TTS model bucket
      }

      if (isModelNotFoundError(err)) {
        geminiCooldowns.markCoolingDown(notFoundKey, 6 * 3600);
        return null;
      }

      throw err;
    }
  };

  for (const candidate of candidates) {
    ttsResponse = await tryCandidate(candidate.apiVersion, candidate.model);
    if (ttsResponse) break;
  }

  if (!ttsResponse) {
    const betaClient = createGeminiClient('v1beta');
    if (betaClient) {
      try {
        const pager = await withTransientRetry(() => betaClient.models.list(), 2, 500);
        for await (const m of pager) {
          const modelName = (m.name || '').replace(/^models\//, '');
          const actions = m.supportedActions || [];
          if (
            modelName.toLowerCase().includes('tts') &&
            (actions.length === 0 || actions.includes('generateContent'))
          ) {
            ttsResponse = await tryCandidate('v1beta', modelName);
            if (ttsResponse) break;
          }
        }
      } catch (listErr) {
        lastError = listErr;
      }
    }
  }

  if (!ttsResponse) {
    if (sawQuotaLimit) {
      const trackedRetry = geminiCooldowns.getShortestRemainingSeconds(
        candidates.map((c) => `quota:${c.model}`)
      );
      const retrySec = trackedRetry ?? shortestRetryAfter;
      throw new TtsQuotaError(
        `Gemini TTS rate limit exceeded across available models; retry in ${retrySec}s`,
        retrySec
      );
    }
    throw lastError instanceof Error ? lastError : new Error('No compatible Gemini TTS model found');
  }

  let base64Audio: string | undefined;
  for (const part of ttsResponse.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      base64Audio = part.inlineData.data;
      break;
    }
  }

  if (!base64Audio) {
    throw new Error('Gemini TTS returned empty audio payload');
  }

  const rawBytes = new Uint8Array(Buffer.from(base64Audio, 'base64'));
  return wrapWavHeaderIfNeeded(rawBytes, 24000, 1, 16);
}

async function ensureSampleVideo(): Promise<string> {
  if (fs.existsSync(SAMPLE_VIDEO_PATH) && fs.statSync(SAMPLE_VIDEO_PATH).size > 10_000) {
    return SAMPLE_VIDEO_PATH;
  }

  const assetsDir = path.resolve(process.cwd(), 'src/assets/images');
  let imagePath = '';
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir).filter((f) => f.startsWith('cinema_noir_frame') && /\.(jpg|jpeg|png)$/i.test(f));
    if (files.length > 0) {
      imagePath = path.join(assetsDir, files[0]);
    }
  }

  if (imagePath) {
    await execFileAsync('ffmpeg', [
      '-y',
      '-loop',
      '1',
      '-i',
      imagePath,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:duration=12,volume=0.06',
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z=\'min(zoom+0.0008,1.12)\':d=300:s=1280x720:fps=25',
      '-t',
      '12',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      SAMPLE_VIDEO_PATH,
    ]);
  } else {
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=#0b1220:s=1280x720:d=12:r=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:duration=12,volume=0.06',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      SAMPLE_VIDEO_PATH,
    ]);
  }
  return SAMPLE_VIDEO_PATH;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
      cb(null, UPLOAD_TMP_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `${file.fieldname}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: {
    fileSize: MAX_UPLOAD_FILE_BYTES, // Up to 2GB (and chunked uploads keep each HTTP request <= 4MB)
  },
});

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // 1. Server health & capability check (never exposes secrets)
  app.get('/api/health', async (_req: Request, res: Response) => {
    const [ffmpegAvailable, ytDlpAvailable] = await Promise.all([
      checkBinary('ffmpeg'),
      checkBinary('yt-dlp'),
    ]);
    res.json({
      ok: true,
      ffmpegAvailable,
      ytDlpAvailable,
      geminiConfigured: Boolean(createGeminiClient()),
      groqConfigured: Boolean(getGroqApiKey()),
      telegramConfigured: Boolean(getTelegramBotToken()),
    });
  });

  // 2. Serve ephemeral session media files (auto-deleted on session close)
  app.get('/api/session/:sessionId/file/:filename', (req: Request, res: Response) => {
    try {
      const sessionId = String(req.params.sessionId || '');
      const filename = path.basename(String(req.params.filename || ''));
      const dir = getSessionDir(sessionId);
      const filePath = path.join(dir, filename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ errorMy: 'ဖိုင်မတွေ့ပါ' });
        return;
      }
      res.sendFile(filePath);
    } catch {
      res.status(400).json({ errorMy: 'တောင်းဆိုမှု မမှန်ကန်ပါ' });
    }
  });

  // 3. Load built-in sample movie clip into active ephemeral session
  app.post('/api/load-sample', async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || crypto.randomUUID());
      const dir = getSessionDir(sessionId);
      const sampleSrc = await ensureSampleVideo();
      const targetPath = path.join(dir, 'source.mp4');
      fs.copyFileSync(sampleSrc, targetPath);
      fs.writeFileSync(path.join(dir, 'is_sample.flag'), '1', 'utf8');
      const meta = await probeVideo(targetPath);

      res.json({
        sessionId,
        videoUrl: `/api/session/${sessionId}/file/source.mp4`,
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
        title: 'Midnight Overpass (နမူနာရုပ်ရှင်)',
      });
    } catch (error) {
      console.error('Sample load error:', error);
      res.status(500).json({ errorMy: 'နမူနာဗီဒီယို ဖန်တီးရာတွင် အမှားဖြစ်ပွားပါသည်' });
    }
  });

  // 4. Upload MP4 video file (single request for <= 4MB OR chunked upload for large videos up to 2GB / 120 mins)
  app.post('/api/upload-video', upload.single('video'), async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || req.headers['x-session-id'] || crypto.randomUUID());
      if (!req.file) {
        res.status(400).json({ errorMy: 'MP4 ဗီဒီယိုဖိုင် ရွေးချယ်တင်သွင်းပေးပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      fs.rmSync(path.join(dir, 'is_sample.flag'), { force: true });
      const targetPath = path.join(dir, 'source.mp4');
      const meta = await finalizeUploadedSourceVideo(req.file.path, targetPath, req.file.originalname);

      const durationCheck = validateVideoDuration(meta.duration);
      if (!durationCheck.valid) {
        fs.rmSync(targetPath, { force: true });
        res.status(400).json({
          errorMy: durationCheck.errorMy || `ဗီဒီယိုအရှည်သည် ${MAX_VIDEO_DURATION_SECONDS / 60} မိနစ်ထက် မကျော်ရပါ`,
        });
        return;
      }

      try {
        persistUploadedVideo(targetPath, req.file.originalname);
      } catch (error) {
        console.error('Failed to save uploaded video to uploads directory:', error);
        res.status(500).json({ errorMy: 'တင်သွင်းထားသော ဗီဒီယိုကို uploads ဖိုလ်ဒါတွင် သိမ်းဆည်း၍မရပါ' });
        return;
      }

      res.json({
        sessionId,
        videoUrl: `/api/session/${sessionId}/file/source.mp4`,
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
        title: req.file.originalname,
      });
    } catch (error) {
      if (req.file?.path) {
        fs.rmSync(req.file.path, { force: true });
      }
      console.error('Upload video error:', error);
      res.status(400).json({
        errorMy: 'ဗီဒီယိုဖိုင် ဖတ်ရှု၍မရပါ — ဖိုင်ပျက်နေခြင်း သို့မဟုတ် ဗီဒီယို Format မမှန်ကန်ခြင်း ဖြစ်နိုင်ပါသည်',
      });
    }
  });

  // 4b. Chunked MP4 Upload endpoints (bypasses Cloud Run 32MB request body cap reliably)
  app.post('/api/upload-video/chunk', upload.single('chunk'), (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || req.headers['x-session-id'] || '');
      const uploadId = String(req.body?.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const chunkIndex = Number(req.body?.chunkIndex);
      if (!sessionId || !uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !req.file) {
        if (req.file?.path) fs.rmSync(req.file.path, { force: true });
        res.status(400).json({ errorMy: 'MP4 ဖိုင်အပိုင်း (Chunk) တင်သွင်းမှု မမှန်ကန်ပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      const chunksDir = path.join(dir, `chunks_${uploadId}`);
      fs.mkdirSync(chunksDir, { recursive: true });
      const chunkDest = path.join(chunksDir, `chunk_${String(chunkIndex).padStart(6, '0')}`);
      moveFileSafely(req.file.path, chunkDest);

      res.json({ ok: true, chunkIndex });
    } catch (error) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      console.error('Chunk upload error:', error);
      res.status(500).json({ errorMy: 'ဗီဒီယိုဖိုင်အပိုင်း လက်ခံရာတွင် အမှားဖြစ်ပွားပါသည်' });
    }
  });

  app.post('/api/upload-video/complete', async (req: Request, res: Response) => {
    let rawMergedPath = '';
    let chunksDir = '';
    try {
      const sessionId = String(req.body?.sessionId || req.headers['x-session-id'] || '');
      const uploadId = String(req.body?.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const totalChunks = Number(req.body?.totalChunks || 0);
      const filename = String(req.body?.filename || 'uploaded.mp4');

      if (!sessionId || !uploadId || !Number.isInteger(totalChunks) || totalChunks < 1) {
        res.status(400).json({ errorMy: 'MP4 ဖိုင်ပေါင်းစည်းရန် အချက်အလက် မပြည့်စုံပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      chunksDir = path.join(dir, `chunks_${uploadId}`);
      for (let i = 0; i < totalChunks; i++) {
        const partPath = path.join(chunksDir, `chunk_${String(i).padStart(6, '0')}`);
        if (!fs.existsSync(partPath)) {
          res.status(400).json({ errorMy: `MP4 ဖိုင်အပိုင်း (${i + 1}/${totalChunks}) မပြည့်စုံပါ — ပြန်လည်တင်သွင်းပါ` });
          return;
        }
      }

      const ext = path.extname(filename).toLowerCase() || '.mp4';
      rawMergedPath = path.join(dir, `raw_upload_${uploadId}${ext}`);
      const writeStream = fs.createWriteStream(rawMergedPath);
      for (let i = 0; i < totalChunks; i++) {
        const partPath = path.join(chunksDir, `chunk_${String(i).padStart(6, '0')}`);
        const buf = fs.readFileSync(partPath);
        if (!writeStream.write(buf)) {
          await new Promise<void>((resolve) => writeStream.once('drain', resolve));
        }
      }
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        writeStream.end();
      });
      fs.rmSync(chunksDir, { recursive: true, force: true });

      fs.rmSync(path.join(dir, 'is_sample.flag'), { force: true });
      const targetPath = path.join(dir, 'source.mp4');
      const meta = await finalizeUploadedSourceVideo(rawMergedPath, targetPath, filename);

      const durationCheck = validateVideoDuration(meta.duration);
      if (!durationCheck.valid) {
        fs.rmSync(targetPath, { force: true });
        res.status(400).json({
          errorMy: durationCheck.errorMy || `ဗီဒီယိုအရှည်သည် ${MAX_VIDEO_DURATION_SECONDS / 60} မိနစ်ထက် မကျော်ရပါ`,
        });
        return;
      }

      try {
        persistUploadedVideo(targetPath, filename);
      } catch (error) {
        console.error('Failed to save uploaded video to uploads directory:', error);
        res.status(500).json({ errorMy: 'တင်သွင်းထားသော ဗီဒီယိုကို uploads ဖိုလ်ဒါတွင် သိမ်းဆည်း၍မရပါ' });
        return;
      }

      res.json({
        sessionId,
        videoUrl: `/api/session/${sessionId}/file/source.mp4`,
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
        title: filename,
      });
    } catch (error) {
      if (chunksDir) fs.rmSync(chunksDir, { recursive: true, force: true });
      if (rawMergedPath) fs.rmSync(rawMergedPath, { force: true });
      console.error('Complete chunked upload error:', error);
      res.status(400).json({
        errorMy: 'MP4 ဗီဒီယိုဖိုင် ဖတ်ရှု၍မရပါ — ဖိုင်ပျက်နေခြင်း သို့မဟုတ် ဗီဒီယို Format မမှန်ကန်ခြင်း ဖြစ်နိုင်ပါသည်',
      });
    }
  });

  // 5. Resolve public YouTube, TikTok, Facebook, Instagram link (via yt-dlp if available)
  app.post('/api/resolve-link', async (req: Request, res: Response) => {
    try {
      const url = String(req.body?.url || '').trim();
      const sessionId = String(req.body?.sessionId || crypto.randomUUID());
      const validation = validateVideoUrl(url);
      if (!validation.valid) {
        res.status(400).json({ errorMy: validation.errorMy });
        return;
      }

      const hasYtDlp = await checkBinary('yt-dlp');
      if (!hasYtDlp) {
        res.status(422).json({
          errorMy: `${validation.platform} လင့်ခ်ကို မှန်ကန်ကြောင်း စစ်ဆေးပြီးပါပြီ။ သို့သော် ဤ Server တွင် yt-dlp မပါဝင်သေးသဖြင့် MP4 ဖိုင်ကို တိုက်ရိုက်တင်သွင်းခြင်း သို့မဟုတ် Render Dockerfile ဖြင့် Deploy လုပ်၍ အသုံးပြုပါ။`,
          platform: validation.platform,
        });
        return;
      }

      const dir = getSessionDir(sessionId);
      fs.rmSync(path.join(dir, 'is_sample.flag'), { force: true });
      const targetPath = path.join(dir, 'source.mp4');

      // Check duration before downloading
      const { stdout: durOut } = await execFileAsync('yt-dlp', [
        '--no-playlist',
        '--print',
        'duration',
        '--print',
        'title',
        url,
      ]);
      const lines = durOut.trim().split('\n');
      const durationSeconds = Number(lines[0] || 0);
      const videoTitle = lines[1] || `${validation.platform} Video`;
      if (durationSeconds > 0) {
        const check = validateVideoDuration(durationSeconds);
        if (!check.valid) {
          res.status(400).json({ errorMy: check.errorMy });
          return;
        }
      }

      await execFileAsync('yt-dlp', [
        '--no-playlist',
        '-f',
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '-o',
        targetPath,
        url,
      ]);

      const meta = await probeVideo(targetPath);
      const durCheck = validateVideoDuration(meta.duration);
      if (!durCheck.valid) {
        fs.rmSync(targetPath, { force: true });
        res.status(400).json({ errorMy: durCheck.errorMy });
        return;
      }

      res.json({
        sessionId,
        videoUrl: `/api/session/${sessionId}/file/source.mp4`,
        durationSeconds: meta.duration,
        width: meta.width,
        height: meta.height,
        title: videoTitle,
        platform: validation.platform,
      });
    } catch (error) {
      console.error('Resolve link error:', error);
      res.status(500).json({ errorMy: 'အများသုံးဗီဒီယိုလင့်ခ်မှ ဗီဒီယိုရယူရာတွင် မအောင်မြင်ပါ — MP4 ဖိုင်တင်သွင်းစမ်းကြည့်ပါ' });
    }
  });

  // 6. Step 2: Groq Whisper API transcript extraction -> speaking & silence timeline segments
  app.post('/api/transcribe', async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || '');
      if (!sessionId) {
        res.status(400).json({ errorMy: 'Session မတွေ့ပါ — ဗီဒီယိုကို ပြန်လည်ထည့်သွင်းပါ' });
        return;
      }

      const groqKey = getGroqApiKey();
      if (!groqKey) {
        res.status(400).json({
          missingKey: 'GROQ_API_KEY',
          errorMy: 'GROQ_API_KEY မသတ်မှတ်ရသေးပါ — Server Environment Variable တွင် GROQ_API_KEY ထည့်သွင်းပါ',
        });
        return;
      }

      const dir = getSessionDir(sessionId);
      const sourcePath = path.join(dir, 'source.mp4');
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ errorMy: 'အရင်းအမြစ် ဗီဒီယိုဖိုင် မတွေ့ပါ' });
        return;
      }

      const meta = await probeVideo(sourcePath);
      const isSampleSession = fs.existsSync(path.join(dir, 'is_sample.flag'));

      if (!meta.hasAudio) {
        const timelineSegments = isSampleSession
          ? buildTimelineFromGroq(
              [
                { start: 0.8, end: 3.6, text: 'Detective waits alone on the dark rainy bridge.' },
                { start: 5.2, end: 8.2, text: 'Someone silently watches from the shadows.' },
                { start: 9.4, end: 11.4, text: 'The hidden truth flips the entire case.' },
              ],
              [],
              meta.duration
            )
          : buildTimelineFromGroq([], [], meta.duration);

        const speakingSegments = timelineSegments.filter((s) => s.kind === 'speaking');
        fs.writeFileSync(path.join(dir, 'timeline_groq.json'), JSON.stringify(timelineSegments), 'utf8');
        res.json({
          transcript: speakingSegments.map((s) => s.text).join(' ') || '',
          segments: speakingSegments,
          timelineSegments,
          durationSeconds: meta.duration,
        });
        return;
      }

      const audioExtractPath = path.join(dir, 'extracted_audio.mp3');
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        sourcePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        audioExtractPath,
      ]);

      const audioBuffer = fs.readFileSync(audioExtractPath);
      const groqRes = await withTransientRetry(() => {
        const formData = new FormData();
        formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'verbose_json');
        formData.append('timestamp_granularities[]', 'segment');
        formData.append('timestamp_granularities[]', 'word');
        return fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
          },
          body: formData,
        });
      });

      if (!groqRes.ok) {
        const errBody = await groqRes.text();
        console.error('Groq API error:', groqRes.status, errBody);
        res.status(groqRes.status).json({
          errorMy: `Groq API မှ အသံစာသားထုတ်ယူရာတွင် အမှားဖြစ်ပွားပါသည် (${groqRes.status})`,
        });
        return;
      }

      const data = (await groqRes.json()) as {
        text?: string;
        segments?: GroqSegmentTimestamp[];
        words?: GroqWordTimestamp[];
      };

      let timelineSegments = buildTimelineFromGroq(
        data.segments || [],
        data.words || [],
        meta.duration
      );

      // Only if this is the synthetic sine-tone sample clip and Groq hears zero/negligible words (<1.5s), provide alternating demo speaking + silence slices
      const detectedSpeechDur = timelineSegments
        .filter((s) => s.kind === 'speaking')
        .reduce((acc, s) => acc + s.duration, 0);
      if (isSampleSession && detectedSpeechDur < 1.5) {
        const dur = Math.max(4, meta.duration);
        timelineSegments = buildTimelineFromGroq(
          [
            { start: Math.min(0.8, dur * 0.08), end: Math.min(3.6, dur * 0.31), text: 'Detective waits alone on the dark rainy bridge.' },
            { start: Math.min(5.2, dur * 0.43), end: Math.min(8.2, dur * 0.68), text: 'Someone silently watches from the shadows.' },
            { start: Math.min(9.4, dur * 0.78), end: Math.min(11.4, dur * 0.94), text: 'The hidden truth flips the entire case.' },
          ],
          [],
          dur
        );
      }

      const speakingSegments = timelineSegments.filter((s) => s.kind === 'speaking');
      fs.writeFileSync(path.join(dir, 'timeline_groq.json'), JSON.stringify(timelineSegments), 'utf8');

      res.json({
        transcript: data.text || speakingSegments.map((s) => s.text).join(' '),
        segments: speakingSegments,
        timelineSegments,
        durationSeconds: meta.duration,
      });
    } catch (error) {
      console.error('Transcribe error:', error);
      res.status(500).json({ errorMy: 'အသံဖိုင်မှ စာသားထုတ်ယူခြင်း မအောင်မြင်ပါ' });
    }
  });

  // 7. Step 3, 5, 8: Gemini API Myanmar script ONLY for speaking segments (silence segments remain empty)
  app.post('/api/generate-script', async (req: Request, res: Response) => {
    try {
      const ai = createGeminiClient();
      if (!ai) {
        res.status(400).json({
          missingKey: 'GEMINI_API_KEY',
          errorMy: 'GEMINI_API_KEY မသတ်မှတ်ရသေးပါ — Server Environment Variable တွင် GEMINI_API_KEY ထည့်သွင်းပါ',
        });
        return;
      }

      const transcript = String(req.body?.transcript || '').trim();
      const tool = (req.body?.tool || 'recap') as StudioTool;
      const rawSpeedInput = req.body?.voiceSpeed ?? req.body?.speed;
      const voiceSpeed: VoiceSpeed =
        rawSpeedInput === 'slow' ? 'slow' : normalizeVoiceSpeed(rawSpeedInput ?? 1.0);
      const durationSeconds = Math.max(1, Number(req.body?.durationSeconds || 12));
      const videoWidth = Math.max(160, Number(req.body?.videoWidth || 1280));
      const videoHeight = Math.max(160, Number(req.body?.videoHeight || 720));
      const incomingTimeline = Array.isArray(req.body?.timelineSegments)
        ? (req.body.timelineSegments as VideoTimelineSegment[])
        : null;
      const rawSegments = Array.isArray(req.body?.segments)
        ? (req.body.segments as Array<{ start: number; end: number; text: string }>)
        : [{ start: 0, end: durationSeconds, text: transcript }];

      const baseTimeline: VideoTimelineSegment[] =
        incomingTimeline && incomingTimeline.length > 0
          ? incomingTimeline
          : buildTimelineFromGroq(rawSegments, [], durationSeconds);

      const speakingSegments = baseTimeline.filter(
        (s) => s.kind === 'speaking' && String(s.text || '').trim().length > 0
      );

      // Prepare separate prompt & target items depending on which of the 3 tools is active
      let targetItems: Array<{ id: string; start: number; end: number; maxWords: number; text: string }> = [];
      let systemInstruction = '';
      let prompt = '';

      if (tool === 'recap') {
        // TOOL 1: MOVIE RECAP — Full continuous Myanmar movie recap across the ENTIRE video (not silence-split)
        const beats = buildFullRecapBeats(rawSegments, durationSeconds, voiceSpeed);
        targetItems = beats.map((b) => ({
          id: b.id,
          start: b.start,
          end: b.end,
          maxWords: b.maxMyanmarWords,
          text: b.contextText,
        }));

        const numericRecapSpeed = getVoiceSpeedFactor(voiceSpeed);
        const recapSpeedNote =
          voiceSpeed === 'slow' || numericRecapSpeed < 0.95
            ? 'USER SELECTED SLOW VOICE SPEED: Write vivid, atmospheric, unhurried storytelling lines around MAX_WORDS per beat.'
            : numericRecapSpeed >= 1.15
              ? `USER SELECTED ${numericRecapSpeed.toFixed(1)}X VOICE SPEED: Write clean, direct, punchy storytelling sentences around MAX_WORDS per beat with zero filler or long pauses so ${numericRecapSpeed.toFixed(1)}x speed stays crisp and synced.`
              : 'Write engaging, natural-paced Myanmar movie recap narration around MAX_WORDS per beat.';

        const beatListText = targetItems
          .map(
            (b) =>
              `- Beat id="${b.id}" [${b.start.toFixed(2)}s -> ${b.end.toFixed(2)}s, MAX_WORDS=${b.maxWords}]: "${b.text}"`
          )
          .join('\n');

        systemInstruction =
          'You are an expert Myanmar YouTube/TikTok Movie Recap narrator. Write a complete, cohesive, thrilling full-video Myanmar street-slang storytelling recap across all story beats. Never exceed 24 characters for thumbnailTitleMy.';

        prompt = `Write a NEW FULL Myanmar street-slang movie recap script covering the entire ${durationSeconds.toFixed(2)}s video smoothly from start to twist/climax.
${transcript ? `\nFull Video Context / Transcript:\n"${transcript}"\n` : ''}
${recapSpeedNote}

Story Beats Covering Full Video:
${beatListText}

Requirements:
1. "segments": Array with EXACTLY ${targetItems.length} items matching each input beat id in order. Each item MUST have: id (string matching input id), myanmarText (engaging continuous Myanmar street-slang recap narration), emoji (1 matching emoji like 🔥, 😱, 🎬, 💥).
2. "thumbnailTitleMy": A viral Myanmar thumbnail title STRICTLY under 25 characters (maximum 24 characters).`;
      } else if (tool === 'captions') {
        // TOOL 3: CAPTIONS ONLY — Keep original audio; translate/adapt ONLY speaking segments at original timestamps
        if (speakingSegments.length === 0) {
          res.json({
            scriptMy: '',
            thumbnailTitleMy: 'မူရင်းအသံ စာတန်းထိုး',
            captions: [],
            timelineSegments: [],
          });
          return;
        }
        const normalized = normalizeTranscriptSegments(
          speakingSegments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
          durationSeconds
        );
        targetItems = speakingSegments.map((s, idx) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          maxWords: normalized[idx]?.maxMyanmarWords ?? Math.max(3, Math.round(s.duration * 2.4)),
          text: s.text,
        }));

        const capSpecText = targetItems
          .map(
            (s) =>
              `- Caption id="${s.id}" [${s.start.toFixed(2)}s -> ${s.end.toFixed(2)}s, MAX_WORDS=${s.maxWords}]: "${s.text}"`
          )
          .join('\n');

        systemInstruction =
          'You are a Myanmar dynamic subtitle translator for social video. Keep meaning faithful to the original spoken audio and keep subtitles crisp, punchy, and readable within original timestamps. Never exceed 24 characters for thumbnailTitleMy.';

        prompt = `Translate/adapt ONLY these original spoken lines into concise, punchy Myanmar dynamic subtitles (NO extra narration, keep original video audio pacing).

Spoken Segments:
${capSpecText}

Requirements:
1. "segments": Array with EXACTLY ${targetItems.length} items matching each input id in order. Each item MUST have: id (string matching input id), myanmarText (concise Myanmar subtitle), emoji (1 matching emoji like 💬, 🎬, ⚡).
2. "thumbnailTitleMy": A viral Myanmar thumbnail title STRICTLY under 25 characters (maximum 24 characters).`;
      } else {
        // TOOL 2: MYANMAR DUBBING — Apply ALL advanced silence & per-speaking-segment speed rules HERE ONLY
        if (speakingSegments.length === 0) {
          const silentOnly = applyMyanmarScriptToTimeline(baseTimeline, []);
          res.json({
            scriptMy: '',
            thumbnailTitleMy: 'အသံတိတ်မြင်ကွင်း',
            captions: [],
            timelineSegments: silentOnly,
          });
          return;
        }

        const normalizedSpeaking = normalizeTranscriptSegments(
          speakingSegments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
          durationSeconds
        );

        const numericDubSpeed = getVoiceSpeedFactor(voiceSpeed);
        const speedRuleNote =
          voiceSpeed === 'slow' || numericDubSpeed < 0.95
            ? 'USER SELECTED SLOW VOICE SPEED: Write vivid, expressive, unhurried Myanmar dubbing lines around MAX_WORDS so slow AI narration lengthens speaking parts naturally!'
            : numericDubSpeed >= 1.15
              ? `USER SELECTED ${numericDubSpeed.toFixed(1)}X VOICE SPEED: Write clean, crisp Myanmar dubbing lines around MAX_WORDS so ${numericDubSpeed.toFixed(1)}x AI voice speed matches ${numericDubSpeed.toFixed(1)}x speaking video pace while silent parts remain 1.0x!`
              : 'Keep each spoken dubbing line natural and expressive around MAX_WORDS so AI voice cleanly drives speaking segment timing.';

        targetItems = speakingSegments.map((s, idx) => {
          const baseWords = normalizedSpeaking[idx]?.maxMyanmarWords ?? Math.max(3, Math.round(s.duration * 2.4));
          return {
            id: s.id,
            start: s.start,
            end: s.end,
            maxWords: scaleWordBudgetForVoiceSpeed(baseWords, voiceSpeed),
            text: s.text,
          };
        });

        const segmentSpecText = targetItems
          .map(
            (s) =>
              `- Segment id="${s.id}" [${s.start.toFixed(2)}s -> ${s.end.toFixed(2)}s, window=${(s.end - s.start).toFixed(2)}s, MAX_WORDS=${s.maxWords}]: "${s.text}"`
          )
          .join('\n');

        systemInstruction =
          'You are an expert Myanmar movie dubbing scriptwriter. Generate dubbing lines ONLY for the given speaking segments and never add lines for silence intervals. Never exceed 24 characters for thumbnailTitleMy.';

        prompt = `Rewrite ONLY these speaking segments into natural Myanmar street-slang dubbing dialogue matching each scene.

SILENCE PRESERVATION & SPEED RULE:
Silence intervals have ALREADY been excluded from the list below. Generate Myanmar dubbing lines ONLY for the listed speaking segments so silent scenes stay quiet at 1.0x speed.
${speedRuleNote}

Speaking Segments ONLY:
${segmentSpecText}

Total original video duration: ${durationSeconds.toFixed(2)} seconds.

Requirements:
1. "segments": Array with EXACTLY ${targetItems.length} items matching each input speaking segment id in order. Each item MUST have: id (string matching input id), myanmarText (concise Myanmar dubbing line), emoji (1 matching emoji like 🔥, 😱, 🎬, 💥).
2. "thumbnailTitleMy": A viral Myanmar thumbnail title STRICTLY under 25 characters (maximum 24 characters).`;
      }

      const aiBeta = createGeminiClient('v1beta') || ai;
      const scriptCandidates: Array<{ client: GoogleGenAI; apiVersion: 'v1' | 'v1beta'; model: string }> = [
        { client: ai, apiVersion: 'v1', model: 'gemini-4-hydrogen' },
        { client: aiBeta, apiVersion: 'v1beta', model: 'gemini-4-hydrogen' },
        { client: aiBeta, apiVersion: 'v1beta', model: 'gemini-3.1-flash-lite' },
        { client: ai, apiVersion: 'v1', model: 'gemini-3.1-flash-lite' },
      ];

      const scriptConfig = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            thumbnailTitleMy: { type: Type.STRING },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  myanmarText: { type: Type.STRING },
                  emoji: { type: Type.STRING },
                },
                required: ['id', 'myanmarText', 'emoji'],
              },
            },
          },
          required: ['thumbnailTitleMy', 'segments'],
        },
      };

      let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | null = null;
      let lastScriptErr: unknown = null;
      let sawScriptQuota = false;

      for (const sc of scriptCandidates) {
        const quotaKey = `quota:${sc.model}`;
        const notFoundKey = `notfound:${sc.apiVersion}:${sc.model}`;
        if (geminiCooldowns.isCoolingDown(notFoundKey)) continue;
        if (geminiCooldowns.isCoolingDown(quotaKey)) {
          sawScriptQuota = true;
          continue;
        }

        try {
          response = await withTransientRetry(
            () =>
              sc.client.models.generateContent({
                model: sc.model,
                contents: prompt,
                config: scriptConfig,
              }),
            2,
            600
          );
          if (response?.text) break;
        } catch (err) {
          lastScriptErr = err;
          if (isQuotaRateLimitError(err)) {
            sawScriptQuota = true;
            const retrySec = extractRetryAfterSeconds(err) || 35;
            geminiCooldowns.markCoolingDown(quotaKey, retrySec);
            continue;
          }
          if (isModelNotFoundError(err)) {
            geminiCooldowns.markCoolingDown(notFoundKey, 6 * 3600);
            continue;
          }
          throw err;
        }
      }

      if (!response) {
        if (sawScriptQuota) {
          const retrySec =
            geminiCooldowns.getShortestRemainingSeconds([
              'quota:gemini-4-hydrogen',
              'quota:gemini-3.1-flash-lite',
            ]) || 35;
          res.status(429).json({
            retryAfterSeconds: retrySec,
            errorMy: `Gemini AI အသုံးပြုမှု ခေတ္တပြည့်သွားပါသည် — ${retrySec} စက္ကန့်ခန့်စောင့်ပြီး ထပ်မံနှိပ်ပေးပါ`,
          });
          return;
        }
        throw lastScriptErr instanceof Error ? lastScriptErr : new Error('No script model available');
      }

      const parsed = JSON.parse((response.text || '{}').trim()) as {
        thumbnailTitleMy?: string;
        segments?: Array<{ id?: string; myanmarText: string; emoji: string }>;
      };

      if (tool === 'dubbing') {
        const scriptedTimeline = applyMyanmarScriptToTimeline(
          baseTimeline,
          speakingSegments.map((orig, idx) => ({
            id: parsed.segments?.[idx]?.id || orig.id,
            myanmarText: String(parsed.segments?.[idx]?.myanmarText || orig.text).trim(),
            emoji: String(parsed.segments?.[idx]?.emoji || '🎬').trim(),
          }))
        );

        const rawLockedCaptions: CaptionSegment[] = scriptedTimeline
          .filter((s) => s.kind === 'speaking' && s.myanmarText.trim().length > 0)
          .map((s) => ({
            id: `cap_${s.id}`,
            start: s.start,
            end: s.end,
            text: s.myanmarText,
            emoji: s.emoji || '🎬',
          }));
        const lockedCaptions = splitLongCaptionsToMaxTwoLines(rawLockedCaptions, {
          videoWidth,
          videoHeight,
        });

        res.json({
          scriptMy: lockedCaptions.map((c) => c.text.replace(/\n+/g, ' ')).join(' '),
          thumbnailTitleMy: truncateThumbnailTitle(String(parsed.thumbnailTitleMy || 'မထင်မှတ်ထားတဲ့အလှည့်')),
          captions: lockedCaptions,
          timelineSegments: scriptedTimeline,
        });
        return;
      }

      // Tool 1 ('recap') or Tool 3 ('captions'): build direct captions (no silence/speaking timeline segmentation)
      const rawDirectCaptions: CaptionSegment[] = buildOriginalAudioCaptions(
        targetItems.map((orig, idx) => ({
          id: `cap_${idx + 1}`,
          start: orig.start,
          end: orig.end,
          text: String(parsed.segments?.[idx]?.myanmarText || orig.text).trim(),
          emoji: String(parsed.segments?.[idx]?.emoji || (tool === 'captions' ? '💬' : '🎬')).trim(),
        }))
      );
      const directCaptions = splitLongCaptionsToMaxTwoLines(rawDirectCaptions, {
        videoWidth,
        videoHeight,
      });

      res.json({
        scriptMy: directCaptions.map((c) => c.text.replace(/\n+/g, ' ')).join(' '),
        thumbnailTitleMy: truncateThumbnailTitle(
          String(parsed.thumbnailTitleMy || (tool === 'captions' ? 'မူရင်းအသံ စာတန်းထိုး' : 'မထင်မှတ်ထားတဲ့အလှည့်'))
        ),
        captions: directCaptions,
        timelineSegments: [],
      });
    } catch (error) {
      if (isQuotaRateLimitError(error)) {
        const retrySec = extractRetryAfterSeconds(error) || 35;
        res.status(429).json({
          retryAfterSeconds: retrySec,
          errorMy: `Gemini AI အသုံးပြုမှု ခေတ္တပြည့်သွားပါသည် — ${retrySec} စက္ကန့်ခန့်စောင့်ပြီး ထပ်မံနှိပ်ပေးပါ`,
        });
        return;
      }
      console.error('Gemini script error:', error instanceof Error ? error.message : error);
      const isNetwork = isTransientNetworkError(error);
      res.status(isNetwork ? 503 : 500).json({
        errorMy: isNetwork
          ? 'Gemini AI ဆာဗာနှင့် ချိတ်ဆက်မှု ယာယီပြတ်တောက်သွားပါသည် — ခေတ္တစောင့်ပြီး ထပ်မံနှိပ်ပေးပါ'
          : 'Gemini AI ဖြင့် မြန်မာဇာတ်ညွှန်း ဖန်တီးရာတွင် အမှားဖြစ်ပွားပါသည်',
      });
    }
  });

  // 8. Step 4: Per-Speaking-Segment Gemini TTS + Silence-Preserving Video Speed Plan
  app.post('/api/generate-tts', async (req: Request, res: Response) => {
    try {
      const ai = createGeminiClient();
      if (!ai) {
        res.status(400).json({
          missingKey: 'GEMINI_API_KEY',
          errorMy: 'GEMINI_API_KEY မသတ်မှတ်ရသေးပါ — Server Environment Variable တွင် GEMINI_API_KEY ထည့်သွင်းပါ',
        });
        return;
      }

      const sessionId = String(req.body?.sessionId || '');
      const tool = (req.body?.tool || 'dubbing') as StudioTool;
      const scriptMy = String(req.body?.scriptMy || '').trim();
      const rawSpeed = req.body?.speed ?? req.body?.voiceSpeed;
      const speed: VoiceSpeed = rawSpeed === 'slow' ? 'slow' : normalizeVoiceSpeed(rawSpeed ?? 1.0);
      const voiceStyle = (req.body?.voiceStyle || 'street_bro') as MyanmarVoiceId;
      const incomingCaptions = Array.isArray(req.body?.captions)
        ? (req.body.captions as CaptionSegment[])
        : [];
      const incomingTimeline = Array.isArray(req.body?.timelineSegments)
        ? (req.body.timelineSegments as VideoTimelineSegment[])
        : null;
      const requestedDuration = Number(req.body?.durationSeconds || 12);

      if (!sessionId) {
        res.status(400).json({ errorMy: 'Session ID မတွေ့ပါ — ဗီဒီယိုကို ပြန်လည်ထည့်သွင်းပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      const sourcePath = path.join(dir, 'source.mp4');
      const videoMeta = fs.existsSync(sourcePath) ? await probeVideo(sourcePath) : null;
      const videoDuration = Math.max(0.5, videoMeta?.duration || requestedDuration || 12);
      const finalWavPath = path.join(dir, 'tts_final.wav');

      // TOOL 3: CAPTIONS ONLY — Keep original audio; never generate AI voice or apply voice speed selection
      if (tool === 'captions') {
        res.json({
          audioUrl: null,
          syncedCaptions: incomingCaptions,
          timelineSegments: [],
          syncSummary: {
            tool: 'captions',
            segmentCount: incomingCaptions.length,
            originalVideoDuration: Number(videoDuration.toFixed(3)),
            aiVoiceDuration: 0,
            finalVideoDuration: Number(videoDuration.toFixed(3)),
            videoPlaybackRate: 1.0,
            voiceSpeed: 1.0,
          } satisfies SyncSummary,
        });
        return;
      }

      const genderValidation = validateVoiceGenderForTool(
        tool,
        req.body?.voiceGender ?? req.body?.gender
      );
      if (!genderValidation.valid) {
        res.status(400).json({ errorMy: genderValidation.errorMy });
        return;
      }
      const selectedVoiceGender = genderValidation.gender ?? 'male';

      const ttsPostFilter = getAudioTtsPostFilter(speed);

      // TOOL 1: MOVIE RECAP — Generate ONE continuous full Myanmar recap TTS voice and adjust WHOLE video up to 2x+ to match it
      if (tool === 'recap') {
        try {
          if (fs.existsSync(path.join(dir, 'timeline_plan.json'))) {
            fs.unlinkSync(path.join(dir, 'timeline_plan.json'));
          }
        } catch {
          // ignore cleanup failure
        }

        const captionItems =
          incomingCaptions.length > 0
            ? incomingCaptions.map((c) => ({ id: c.id, text: c.text, emoji: c.emoji }))
            : [{ id: 'cap_1', text: scriptMy || 'ဒီဇာတ်ကားထဲက အဓိကအဖြစ်အပျက်ကို ကြည့်လိုက်ရအောင်။', emoji: '🎬' }];

        const continuousRecapText = captionItems
          .map((c) => `${c.text.trim().replace(/[။.!?]+$/, '')}။`)
          .join(' ');

        const rawBytes = await synthesizeGeminiTtsAudio(
          continuousRecapText,
          speed,
          false,
          voiceStyle,
          selectedVoiceGender
        );
        const rawRecapPath = path.join(dir, 'tts_recap_raw.wav');
        fs.writeFileSync(rawRecapPath, Buffer.from(rawBytes));
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          rawRecapPath,
          ...(ttsPostFilter ? ['-af', ttsPostFilter] : []),
          '-ac',
          '1',
          '-ar',
          '48000',
          finalWavPath,
        ]);

        const aiVoiceDuration = await probeAudioDuration(finalWavPath);
        const wholePlan = computeVideoSpeedSyncPlan(videoDuration, aiVoiceDuration);
        const rawRecapCaptions = buildProportionalCaptionsForDuration(captionItems, wholePlan.aiVoiceDuration);
        const syncedCaptions = splitLongCaptionsToMaxTwoLines(rawRecapCaptions, {
          videoWidth: videoMeta?.width || 1280,
          videoHeight: videoMeta?.height || 720,
        });

        const recapSyncSummary: SyncSummary = {
          tool: 'recap',
          segmentCount: syncedCaptions.length,
          originalVideoDuration: wholePlan.originalVideoDuration,
          aiVoiceDuration: wholePlan.aiVoiceDuration,
          finalVideoDuration: wholePlan.aiVoiceDuration,
          videoPlaybackRate: wholePlan.videoPlaybackRate,
          voiceSpeed: speed,
          voiceGender: selectedVoiceGender,
        };

        res.json({
          audioUrl: `/api/session/${sessionId}/file/tts_final.wav`,
          syncedCaptions,
          timelineSegments: [],
          syncSummary: recapSyncSummary,
        });
        return;
      }

      // TOOL 2: MYANMAR DUBBING — Per-speaking-segment Gemini TTS + silence preserved strictly at 1.0x
      // Reconstruct or load timeline segments and overlay any user caption edits onto speaking segments
      let workingTimeline: VideoTimelineSegment[] = [];
      if (incomingTimeline && incomingTimeline.length > 0) {
        workingTimeline = incomingTimeline;
      } else if (fs.existsSync(path.join(dir, 'timeline_groq.json'))) {
        try {
          workingTimeline = JSON.parse(fs.readFileSync(path.join(dir, 'timeline_groq.json'), 'utf8')) as VideoTimelineSegment[];
        } catch {
          workingTimeline = [];
        }
      }
      if (workingTimeline.length === 0) {
        workingTimeline =
          incomingCaptions.length > 0
            ? buildTimelineFromGroq(
                incomingCaptions.map((c) => ({ start: c.start, end: c.end, text: c.text })),
                [],
                videoDuration
              )
            : scriptMy
              ? buildTimelineFromGroq([{ start: 0, end: videoDuration, text: scriptMy }], [], videoDuration)
              : buildTimelineFromGroq([], [], videoDuration);
      }

      const editedByCapId = new Map<string, CaptionSegment>();
      for (const c of incomingCaptions) {
        editedByCapId.set(c.id, c);
      }
      workingTimeline = workingTimeline.map((seg) => {
        if (seg.kind === 'silence') {
          return { ...seg, myanmarText: '', emoji: '', aiVoiceDuration: 0, setptsFactor: 1.0, videoPlaybackRate: 1.0 };
        }
        const edit = editedByCapId.get(`cap_${seg.id}`) || editedByCapId.get(seg.id);
        const text = (edit?.text || seg.myanmarText || seg.text || '').trim();
        const emoji = (edit?.emoji || seg.emoji || '🎬').trim();
        return { ...seg, myanmarText: text, emoji };
      });

      const speakingSegments = workingTimeline.filter(
        (s) => s.kind === 'speaking' && (s.myanmarText || s.text).trim().length > 0
      );

      if (speakingSegments.length === 0) {
        await execFileAsync('ffmpeg', [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `anullsrc=r=48000:cl=mono:d=${videoDuration.toFixed(3)}`,
          finalWavPath,
        ]);
        const silentPlan = computeSegmentAwareTimelinePlan(workingTimeline, {});
        fs.writeFileSync(path.join(dir, 'timeline_plan.json'), JSON.stringify(silentPlan.segments), 'utf8');
        res.json({
          audioUrl: `/api/session/${sessionId}/file/tts_final.wav`,
          syncedCaptions: [],
          timelineSegments: silentPlan.segments,
          syncSummary: {
            tool: 'dubbing',
            segmentCount: silentPlan.segments.length,
            speakingSegmentCount: 0,
            silenceSegmentCount: silentPlan.silenceSegmentCount,
            preservedSilenceDuration: silentPlan.totalPreservedSilenceDuration,
            originalVideoDuration: silentPlan.totalOriginalDuration,
            aiVoiceDuration: 0,
            finalVideoDuration: silentPlan.totalFinalDuration,
            videoPlaybackRate: 1.0,
            voiceSpeed: speed,
            voiceGender: selectedVoiceGender,
          } satisfies SyncSummary,
        });
        return;
      }

      // Generate Gemini TTS WAV (48kHz mono, plus WSOLA 2x filter ONLY when user picks 2x) FOR EACH speaking segment
      const voiceDurationsById: Record<string, number> = {};
      const synthesizeSingleSegment = async (seg: VideoTimelineSegment): Promise<boolean> => {
        const lineText = `${(seg.myanmarText || seg.text).trim().replace(/[။.!?]+$/, '')}။`;
        const wavBytes = await synthesizeGeminiTtsAudio(
          lineText,
          speed,
          false,
          voiceStyle,
          selectedVoiceGender
        );
        const rawSegPath = path.join(dir, `tts_${seg.id}_raw.wav`);
        const segWavPath = path.join(dir, `tts_${seg.id}.wav`);
        fs.writeFileSync(rawSegPath, Buffer.from(wavBytes));
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          rawSegPath,
          ...(ttsPostFilter ? ['-af', ttsPostFilter] : []),
          '-ac',
          '1',
          '-ar',
          '48000',
          segWavPath,
        ]);
        voiceDurationsById[seg.id] = await probeAudioDuration(segWavPath);
        return true;
      };

      const synthesizeBatchSegments = async (segs: VideoTimelineSegment[], batchIdx: number) => {
        const joinedText = segs
          .map((s) => `${(s.myanmarText || s.text).trim().replace(/[။.!?]+$/, '')}။`)
          .join('\n\n');
        const wavBytes = await synthesizeGeminiTtsAudio(
          joinedText,
          speed,
          segs.length > 1,
          voiceStyle,
          selectedVoiceGender
        );
        const rawBatchPath = path.join(dir, `tts_batch_${batchIdx}_raw.wav`);
        const batchWavPath = path.join(dir, `tts_batch_${batchIdx}.wav`);
        fs.writeFileSync(rawBatchPath, Buffer.from(wavBytes));
        await execFileAsync('ffmpeg', [
          '-y',
          '-i',
          rawBatchPath,
          ...(ttsPostFilter ? ['-af', ttsPostFilter] : []),
          '-ac',
          '1',
          '-ar',
          '48000',
          batchWavPath,
        ]);
        const batchDur = await probeAudioDuration(batchWavPath);
        const silences = await detectAudioSilences(batchWavPath);
        const slices = splitAudioBoundariesForSegments(
          segs.map((s) => ({ text: s.myanmarText || s.text })),
          batchDur,
          silences
        );
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          const sl = slices[i];
          const segWavPath = path.join(dir, `tts_${seg.id}.wav`);
          await execFileAsync('ffmpeg', [
            '-y',
            '-i',
            batchWavPath,
            '-ss',
            sl.audioStart.toFixed(3),
            '-to',
            sl.audioEnd.toFixed(3),
            '-ac',
            '1',
            '-ar',
            '48000',
            segWavPath,
          ]);
          voiceDurationsById[seg.id] = await probeAudioDuration(segWavPath);
        }
      };

      let nextSegIdx = 0;
      if (speakingSegments.length <= 4) {
        while (nextSegIdx < speakingSegments.length) {
          try {
            await synthesizeSingleSegment(speakingSegments[nextSegIdx]);
            nextSegIdx += 1;
          } catch (segErr) {
            if (segErr instanceof TtsQuotaError && speakingSegments.length - nextSegIdx > 1) {
              // Fall back to batched TTS for remaining segments only if RPM limit hit
              break;
            }
            throw segErr;
          }
        }
      }

      if (nextSegIdx < speakingSegments.length) {
        const remaining = speakingSegments.slice(nextSegIdx);
        let batchIdx = 0;
        for (let i = 0; i < remaining.length; i += 4) {
          const chunk = remaining.slice(i, i + 4);
          await synthesizeBatchSegments(chunk, batchIdx++);
        }
      }

      // Compute final segment-aware sync plan: ONLY speaking segments follow AI voice speed; silence stays 1.0x!
      const plan = computeSegmentAwareTimelinePlan(workingTimeline, voiceDurationsById, speed);
      fs.writeFileSync(path.join(dir, 'timeline_plan.json'), JSON.stringify(plan.segments), 'utf8');

      // Assemble preview audio timeline matching final speaking + silent gap durations
      const previewInputs: string[] = ['-y'];
      const previewFilterParts: string[] = [];
      let pInputIdx = 0;
      const concatAudioLabels: string[] = [];

      for (let i = 0; i < plan.segments.length; i++) {
        const seg = plan.segments[i];
        const segWav = path.join(dir, `tts_${seg.id}.wav`);
        if (seg.kind === 'speaking' && fs.existsSync(segWav) && seg.aiVoiceDuration > 0) {
          previewInputs.push('-i', segWav);
          previewFilterParts.push(
            `[${pInputIdx}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,apad=whole_dur=${seg.aiVoiceDuration.toFixed(3)},atrim=0:${seg.aiVoiceDuration.toFixed(3)}[pa_${i}]`
          );
          pInputIdx += 1;
        } else {
          previewFilterParts.push(`anullsrc=r=48000:cl=mono:d=${seg.duration.toFixed(3)}[pa_${i}]`);
        }
        concatAudioLabels.push(`[pa_${i}]`);
      }

      if (concatAudioLabels.length === 1) {
        previewFilterParts.push(`${concatAudioLabels[0]}acopy[p_out]`);
      } else {
        previewFilterParts.push(`${concatAudioLabels.join('')}concat=n=${concatAudioLabels.length}:v=0:a=1[p_out]`);
      }

      await execFileAsync('ffmpeg', [
        ...previewInputs,
        '-filter_complex',
        previewFilterParts.join(';'),
        '-map',
        '[p_out]',
        finalWavPath,
      ]);

      const syncSummary: SyncSummary = {
        tool: 'dubbing',
        segmentCount: plan.segments.length,
        speakingSegmentCount: plan.speakingSegmentCount,
        silenceSegmentCount: plan.silenceSegmentCount,
        preservedSilenceDuration: plan.totalPreservedSilenceDuration,
        originalVideoDuration: plan.totalOriginalDuration,
        aiVoiceDuration: plan.totalAiVoiceDuration,
        finalVideoDuration: plan.totalFinalDuration,
        videoPlaybackRate: plan.avgSpeakingPlaybackRate,
        voiceSpeed: speed,
      };

      const syncedSplitCaptions = splitLongCaptionsToMaxTwoLines(plan.syncedCaptions, {
        videoWidth: videoMeta?.width || 1280,
        videoHeight: videoMeta?.height || 720,
      });

      res.json({
        audioUrl: `/api/session/${sessionId}/file/tts_final.wav`,
        syncedCaptions: syncedSplitCaptions,
        timelineSegments: plan.segments,
        syncSummary,
      });
    } catch (error) {
      if (error instanceof TtsQuotaError || isQuotaRateLimitError(error)) {
        const retrySec =
          error instanceof TtsQuotaError ? error.retryAfterSeconds : extractRetryAfterSeconds(error) || 35;
        res.status(429).json({
          retryAfterSeconds: retrySec,
          errorMy: `Gemini TTS အခမဲ့အသုံးပြုမှု အကြိမ်ရေ ပြည့်သွားပါသည် — ကျေးဇူးပြု၍ ${retrySec} စက္ကန့်ခန့် စောင့်ပြီးမှ ထပ်မံကြိုးစားပါ`,
        });
        return;
      }
      console.error('Gemini TTS error:', error instanceof Error ? error.message : error);
      const isNetwork = isTransientNetworkError(error);
      res.status(isNetwork ? 503 : 500).json({
        errorMy: isNetwork
          ? 'Gemini TTS ဆာဗာနှင့် ချိတ်ဆက်မှု ယာယီပြတ်တောက်သွားပါသည် — ခေတ္တစောင့်ပြီး ထပ်မံကြိုးစားပါ'
          : 'Gemini TTS မြန်မာအသံ ထုတ်လုပ်ရာတွင် အမှားဖြစ်ပွားပါသည်',
      });
    }
  });

  // 8b. Automatic video text and graphic overlay detection
  app.post('/api/analyze-auto-blur', async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || '');
      if (!sessionId) {
        res.status(400).json({ errorMy: 'Session ID မတွေ့ပါ — ဗီဒီယိုကို ဦးစွာထည့်သွင်းပါ' });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({ errorMy: 'အလိုအလျောက် စာသားရှာဖွေရန် GEMINI_API_KEY ကို သတ်မှတ်ပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      const sourcePath = path.join(dir, 'source.mp4');
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ errorMy: 'စစ်ဆေးရန် ဗီဒီယိုဖိုင် မတွေ့ပါ — အဆင့် ၁ တွင် ဗီဒီယိုထည့်သွင်းပါ' });
        return;
      }

      const meta = await probeVideo(sourcePath);
      const timestamps = computeCandidateFrameTimestamps(meta.duration, 8);
      const frames: Buffer[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const framePath = path.join(dir, `auto_blur_frame_${i}.jpg`);
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss',
          timestamps[i].toFixed(2),
          '-i',
          sourcePath,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:-2',
          '-q:v',
          '4',
          framePath,
        ]);
        if (fs.existsSync(framePath)) frames.push(fs.readFileSync(framePath));
      }

      if (frames.length === 0) {
        res.status(500).json({ errorMy: 'ဗီဒီယိုမှ ရုပ်ပုံဖရိန်များ ထုတ်ယူ၍မရပါ' });
        return;
      }

      const parts = frames.flatMap((bytes, index) => [
        { text: `Video frame ${index + 1} of ${frames.length}:` },
        { inlineData: { mimeType: 'image/jpeg', data: bytes.toString('base64') } },
      ]);
      parts.push({
        text: `Detect visible subtitles, captions, logos, watermarks, and fixed graphic overlays in these video frames. Prioritize subtitle-like dialogue text near the bottom of the frame while also detecting other clear on-screen overlays. Do not select scene objects, signs, or decorative background writing. Return tight rectangles for detected overlays, using integer coordinates from 0 to 1000 relative to each full frame. Combine repeated detections of the same overlay into one rectangle. If no overlays are visible, return an empty array.`,
      });

      const visionCandidates: Array<{ client: GoogleGenAI; apiVersion: 'v1beta' | 'v1'; model: string }> = [
        { client: createGeminiClient('v1beta') || ai, apiVersion: 'v1beta', model: 'gemini-3.1-flash-lite' },
        { client: createGeminiClient('v1beta') || ai, apiVersion: 'v1beta', model: 'gemini-4-hydrogen' },
      ];
      let rawRegions: unknown;
      let lastError: unknown;
      for (const candidate of visionCandidates) {
        const quotaKey = `quota:${candidate.model}`;
        const notFoundKey = `notfound:${candidate.apiVersion}:${candidate.model}`;
        if (geminiCooldowns.isCoolingDown(quotaKey) || geminiCooldowns.isCoolingDown(notFoundKey)) continue;
        try {
          const response = await candidate.client.models.generateContent({
            model: candidate.model,
            contents: { parts },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  regions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        x: { type: Type.NUMBER },
                        y: { type: Type.NUMBER },
                        width: { type: Type.NUMBER },
                        height: { type: Type.NUMBER },
                      },
                      required: ['x', 'y', 'width', 'height'],
                    },
                  },
                },
                required: ['regions'],
              },
            },
          });
          if (!response.text) throw new Error('Auto blur analysis returned an empty response');
          const parsed = JSON.parse(response.text) as { regions?: unknown };
          rawRegions = parsed.regions;
          break;
        } catch (error) {
          lastError = error;
          if (isQuotaRateLimitError(error)) {
            geminiCooldowns.markCoolingDown(quotaKey, extractRetryAfterSeconds(error) || 60);
          } else if (isModelNotFoundError(error)) {
            geminiCooldowns.markCoolingDown(notFoundKey, 6 * 3600);
          } else if (!isTransientNetworkError(error)) {
            break;
          }
        }
      }

      if (rawRegions === undefined) {
        throw lastError instanceof Error ? lastError : new Error('No compatible vision model was available');
      }

      const regionList = Array.isArray(rawRegions) ? rawRegions : null;
      const sanitizedRegions = sanitizeAutoBlurRegions(rawRegions);
      if (!regionList || sanitizedRegions.length !== regionList.length) {
        throw new Error('Auto blur analysis returned invalid region coordinates');
      }
      const regions = mergeAutoBlurRegions(sanitizedRegions);
      res.json({ regions });
    } catch (error) {
      console.error('Auto blur analysis error:', error);
      res.status(500).json({ errorMy: 'ဗီဒီယိုအတွင်းရှိ စာသားနှင့် လိုဂိုများကို အလိုအလျောက်စစ်ဆေး၍မရပါ' });
    }
  });

  // 8c. Video Content-Driven Thumbnail Analysis (extracts real candidate frames & identifies subject/headline)
  app.post('/api/analyze-thumbnail', async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || '');
      if (!sessionId) {
        res.status(400).json({ errorMy: 'Session ID မတွေ့ပါ — ဗီဒီယိုကို ဦးစွာထည့်သွင်းပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      const sourcePath = path.join(dir, 'source.mp4');
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({ errorMy: 'စစ်ဆေးရန် ဗီဒီယိုဖိုင် မတွေ့ပါ — အဆင့် ၁ တွင် ဗီဒီယိုထည့်သွင်းပါ' });
        return;
      }

      const aspectRatio: ThumbnailAspectRatio = normalizeThumbnailAspectRatio(
        typeof req.body?.aspectRatio === 'string' ? req.body.aspectRatio : '16:9'
      );
      const transcript = String(req.body?.transcript || '').trim();
      const scriptMy = String(req.body?.scriptMy || '').trim();
      const videoTitle = String(req.body?.videoTitle || '').trim();

      const meta = await probeVideo(sourcePath);
      const candidateTimestamps = computeCandidateFrameTimestamps(meta.duration, 4);

      // Extract real JPEG frames from the source video at candidate timestamps
      const frameUrls: string[] = [];
      const frameBuffers: Array<{ index: number; timestamp: number; bytes: Buffer; url: string }> = [];

      for (let i = 0; i < candidateTimestamps.length; i++) {
        const ts = candidateTimestamps[i];
        const frameName = `thumb_cand_${i}.jpg`;
        const framePath = path.join(dir, frameName);
        await execFileAsync('ffmpeg', [
          '-y',
          '-ss',
          ts.toFixed(2),
          '-i',
          sourcePath,
          '-vframes',
          '1',
          '-vf',
          'scale=480:-2',
          '-q:v',
          '3',
          framePath,
        ]);
        if (fs.existsSync(framePath)) {
          const bytes = fs.readFileSync(framePath);
          const url = `/api/session/${sessionId}/file/${frameName}?v=${Date.now()}`;
          frameUrls.push(url);
          frameBuffers.push({ index: frameBuffers.length, timestamp: ts, bytes, url });
        }
      }

      if (frameBuffers.length === 0) {
        res.status(500).json({ errorMy: 'ဗီဒီယိုမှ ရုပ်ပုံဖရိန်များ ထုတ်ယူ၍မရပါ' });
        return;
      }

      const usedTimestamps = frameBuffers.map((f) => f.timestamp);
      const usedUrls = frameBuffers.map((f) => f.url);

      // Default heuristic fallback picks the frame with richest visual entropy (largest JPEG payload)
      let sharpestIdx = 0;
      let maxBytes = -1;
      frameBuffers.forEach((f, idx) => {
        if (f.bytes.length > maxBytes) {
          maxBytes = f.bytes.length;
          sharpestIdx = idx;
        }
      });

      const cleanTitleFallback =
        videoTitle.replace(/\s*\([^)]*\)/g, '').trim() || 'အထူးရုပ်ရှင်အနှစ်ချုပ်';

      const ai = createGeminiClient();
      if (!ai) {
        const heuristic = sanitizeThumbnailAnalysisResponse(
          {
            bestFrameIndex: sharpestIdx,
            subjectCategory: 'surprising_scene',
            subjectSummaryMy: 'ဗီဒီယိုအတွင်းမှ အထင်ရှားဆုံး မြင်ကွင်းဖရိန်',
            headlineMy: cleanTitleFallback,
            focusX: 50,
            focusY: 45,
            accentTheme: 'gold',
          },
          usedTimestamps,
          usedUrls,
          aspectRatio,
          cleanTitleFallback,
          false
        );
        res.json(heuristic);
        return;
      }

      const contextLines = [
        videoTitle ? `Video Title / Filename: ${videoTitle}` : '',
        transcript ? `Transcript excerpt: ${transcript.slice(0, 600)}` : '',
        scriptMy ? `Myanmar Recap Script excerpt: ${scriptMy.slice(0, 500)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const analysisPrompt = `Analyze ONLY the attached candidate video frames (${frameBuffers.length} real frames extracted at timestamps ${usedTimestamps.map((t, i) => `#${i}=${t}s`).join(', ')}).
${contextLines ? `\nVideo Context:\n${contextLines}\n` : ''}
Target Platform Aspect Ratio: ${aspectRatio}.

STRICT CONTENT-DRIVEN THUMBNAIL RULES:
1. Identify the main subject ACTUALLY visible in the video:
   - Must be exactly one of: "person", "product", "food", "travel_scene", "tech_device", "action_moment", "surprising_scene".
2. Pick "bestFrameIndex" (0 to ${frameBuffers.length - 1}): the single sharpest, most attractive, expressive, scroll-stopping frame directly from these attached video images.
3. Describe what is ACTUALLY shown in that chosen frame in "subjectSummaryMy" (1 concise Myanmar sentence). Do NOT invent people, products, faces, or objects that are not visible in the video frames.
4. Write "headlineMy": a short, bold, clickable Myanmar headline (STRICTLY <= 24 characters total) that directly matches what this specific video is about. Avoid generic clickbait phrases unrelated to the frames.
5. Set "focusX" (15..85) and "focusY" (15..85) as percentage coordinates of the main subject's center in the chosen frame so ${aspectRatio} cropping centers tightly on the real subject.
6. Set "textPosition" to "top" or "bottom" on whichever edge leaves the main subject unobstructed.
7. Pick "accentTheme" ("gold" | "crimson" | "electric_blue" | "emerald") for maximum high-contrast legibility against the frame's colors.`;

      const visionParts = frameBuffers.flatMap((fb, idx) => [
        { text: `Candidate Frame #${idx} (at ${fb.timestamp}s):` },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: fb.bytes.toString('base64'),
          },
        },
      ]);
      visionParts.push({ text: analysisPrompt });

      const aiBeta = createGeminiClient('v1beta') || ai;
      const visionConfig = {
        systemInstruction:
          'You are a visual video thumbnail director. Analyze only the provided video frames cleanly. Never hallucinate faces, items, or products absent from the frames. Return valid JSON matching the schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bestFrameIndex: { type: Type.INTEGER },
            subjectCategory: { type: Type.STRING },
            subjectSummaryMy: { type: Type.STRING },
            headlineMy: { type: Type.STRING },
            focusX: { type: Type.NUMBER },
            focusY: { type: Type.NUMBER },
            textPosition: { type: Type.STRING },
            accentTheme: { type: Type.STRING },
          },
          required: [
            'bestFrameIndex',
            'subjectCategory',
            'subjectSummaryMy',
            'headlineMy',
            'focusX',
            'focusY',
            'textPosition',
            'accentTheme',
          ],
        },
      };

      const visionCandidates: Array<{ client: GoogleGenAI; apiVersion: 'v1beta' | 'v1'; model: string }> = [
        { client: aiBeta, apiVersion: 'v1beta', model: 'gemini-3.1-flash-lite' },
        { client: aiBeta, apiVersion: 'v1beta', model: 'gemini-4-hydrogen' },
      ];

      let visionResponse: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | null = null;
      let usedVision = false;
      for (const vc of visionCandidates) {
        const quotaKey = `quota:${vc.model}`;
        const notFoundKey = `notfound:${vc.apiVersion}:${vc.model}`;
        if (geminiCooldowns.isCoolingDown(quotaKey) || geminiCooldowns.isCoolingDown(notFoundKey)) {
          continue;
        }

        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Vision analysis timeout')), 12000)
          );
          visionResponse = await Promise.race([
            vc.client.models.generateContent({
              model: vc.model,
              contents: { parts: visionParts },
              config: visionConfig,
            }),
            timeoutPromise,
          ]);
          if (visionResponse?.text) {
            usedVision = true;
            break;
          }
        } catch (vcErr) {
          if (isQuotaRateLimitError(vcErr)) {
            const retrySec = extractRetryAfterSeconds(vcErr) || 60;
            geminiCooldowns.markCoolingDown(quotaKey, retrySec);
          } else if (isModelNotFoundError(vcErr)) {
            geminiCooldowns.markCoolingDown(notFoundKey, 6 * 3600);
          }
          // Quietly fall through to next available vision model or local sharpest-frame selection
        }
      }

      let rawJson: RawVisionThumbnailResponse = {
        bestFrameIndex: sharpestIdx,
        subjectCategory: 'surprising_scene',
        subjectSummaryMy: 'ဗီဒီယိုအတွင်းမှ အထင်ရှားဆုံး မြင်ကွင်းဖရိန်',
        headlineMy: cleanTitleFallback,
        focusX: 50,
        focusY: 45,
        accentTheme: 'gold',
      };

      if (usedVision && visionResponse?.text) {
        try {
          const cleanedJson = visionResponse.text
            .trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          rawJson = JSON.parse(cleanedJson) as RawVisionThumbnailResponse;
        } catch {
          usedVision = false;
        }
      }

      const sanitized = sanitizeThumbnailAnalysisResponse(
        rawJson,
        usedTimestamps,
        usedUrls,
        aspectRatio,
        cleanTitleFallback,
        usedVision
      );

      res.json(sanitized);
    } catch (error) {
      console.error('Analyze thumbnail error:', error);
      res.status(500).json({ errorMy: 'ဗီဒီယိုအကြောင်းအရာ စစ်ဆေးပြီး Thumbnail ဖန်တီးရာတွင် အမှားဖြစ်ပွားပါသည်' });
    }
  });

  // 9. Step 6, 7, 8, 9: Final Video Render (Audio Crossfade + Logo Overlay + 4K Export + Thumbnail)
  app.post(
    '/api/render-video',
    upload.fields([
      { name: 'logo', maxCount: 1 },
      { name: 'thumbnail', maxCount: 1 },
    ]),
    async (req: Request, res: Response) => {
      try {
        const sessionId = String(req.body?.sessionId || '');
        if (!sessionId) {
          res.status(400).json({ errorMy: 'Session ID မတွေ့ပါ' });
          return;
        }

        const dir = getSessionDir(sessionId);
        const sourcePath = path.join(dir, 'source.mp4');
        if (!fs.existsSync(sourcePath)) {
          res.status(404).json({ errorMy: 'အရင်းအမြစ် ဗီဒီယိုဖိုင် မတွေ့ပါ' });
          return;
        }

        const tool = (req.body?.tool || 'recap') as StudioTool;
        const resolution = (req.body?.resolution || '1080p') as ExportResolution;
        const musicMood = (req.body?.musicMood || 'thriller') as MusicMood;
        const crossfadeSec = Math.min(4, Math.max(0.5, Number(req.body?.crossfadeSeconds || 2)));
        const sfxEnabled = String(req.body?.sfxEnabled || 'true') === 'true';
        const logoEnabled = String(req.body?.logoEnabled || 'false') === 'true';
        const logoScale = Math.min(35, Math.max(6, Number(req.body?.logoScale || 14)));
        const autoBlurEnabled = String(req.body?.autoBlurEnabled || 'false') === 'true';
        const autoBlurStyleValue = String(req.body?.autoBlurStyle || 'blur');
        if (!['blur', 'pixelate', 'solid'].includes(autoBlurStyleValue)) {
          res.status(400).json({ errorMy: 'အလိုအလျောက် ဖုံးကွယ်မှုပုံစံ မမှန်ကန်ပါ' });
          return;
        }
        const autoBlurStyle = autoBlurStyleValue as AutoBlurStyle;
        const autoBlurStrengthValue = Number(req.body?.autoBlurStrength || 12);
        if (!Number.isFinite(autoBlurStrengthValue)) {
          res.status(400).json({ errorMy: 'အလိုအလျောက် ဖုံးကွယ်မှုပြင်းအား မမှန်ကန်ပါ' });
          return;
        }
        const autoBlurStrength = Math.min(40, Math.max(1, autoBlurStrengthValue));
        let autoBlurRegions: AutoBlurRegion[] = [];
        if (autoBlurEnabled) {
          let parsedRegions: unknown;
          try {
            parsedRegions = JSON.parse(String(req.body?.autoBlurRegions || '[]'));
          } catch {
            res.status(400).json({ errorMy: 'အလိုအလျောက် ဖုံးကွယ်မည့်နေရာများ မမှန်ကန်ပါ' });
            return;
          }
          autoBlurRegions = sanitizeAutoBlurRegions(parsedRegions);
          if (!Array.isArray(parsedRegions) || autoBlurRegions.length !== parsedRegions.length) {
            res.status(400).json({ errorMy: 'အလိုအလျောက် ဖုံးကွယ်မည့်နေရာများ မမှန်ကန်ပါ' });
            return;
          }
        }
        const logoPos = JSON.parse(String(req.body?.logoPos || '{"x":86,"y":12}')) as { x: number; y: number };
        const thumbnailTitle = truncateThumbnailTitle(String(req.body?.thumbnailTitle || 'အံ့ဩစရာဇာတ်သိမ်း'));
        const thumbnailAspectRatio = normalizeThumbnailAspectRatio(
          typeof req.body?.thumbnailAspectRatio === 'string' ? req.body.thumbnailAspectRatio : '16:9'
        );
        const thumbDims = getThumbnailDimensions(thumbnailAspectRatio);

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const logoFile = files?.logo?.[0];
        const uploadedThumb = files?.thumbnail?.[0];

        const meta = await probeVideo(sourcePath);
        const isPortrait = meta.height > meta.width;
        const outWidth = resolution === '4k' ? (isPortrait ? 2160 : 3840) : isPortrait ? 1080 : 1920;
        const outHeight = resolution === '4k' ? (isPortrait ? 3840 : 2160) : isPortrait ? 1920 : 1080;

        // Build silence-preserving FFmpeg render graph
        const inputs: string[] = ['-y', '-i', sourcePath];
        let nextInputIdx = 1;

        let logoIdx = -1;
        if (logoEnabled && logoFile && fs.existsSync(logoFile.path)) {
          inputs.push('-i', logoFile.path);
          logoIdx = nextInputIdx++;
        }

        const timelinePlanPath = path.join(dir, 'timeline_plan.json');
        let timelineSegments: VideoTimelineSegment[] = [];
        if (typeof req.body?.timelineSegments === 'string' && req.body.timelineSegments.trim()) {
          try {
            timelineSegments = JSON.parse(req.body.timelineSegments) as VideoTimelineSegment[];
          } catch {
            timelineSegments = [];
          }
        } else if (fs.existsSync(timelinePlanPath)) {
          try {
            timelineSegments = JSON.parse(fs.readFileSync(timelinePlanPath, 'utf8')) as VideoTimelineSegment[];
          } catch {
            timelineSegments = [];
          }
        }

        const ttsPath = path.join(dir, 'tts_final.wav');
        const hasTts = fs.existsSync(ttsPath) && (tool === 'recap' || tool === 'dubbing');
        // ONLY Tool 2 ('dubbing') uses silence-preserving segmented speed rendering!
        // Tool 1 ('recap') adjusts the WHOLE video for its continuous full-recap AI voice; Tool 3 ('captions') keeps original video+audio at 1.0x.
        const useSegmentedRender =
          tool === 'dubbing' &&
          hasTts &&
          timelineSegments.length > 0 &&
          timelineSegments.some(
            (s) => s.kind === 'speaking' && fs.existsSync(path.join(dir, `tts_${s.id}.wav`))
          );

        const filterParts: string[] = [];

        let dur = Math.max(0.5, meta.duration);
        let joinedAudioLabel = '';
        let singleTtsIdx = -1;

        if (useSegmentedRender) {
          // Segmented render: speed-adjust ONLY speaking segments to match per-segment AI voice; KEEP silence segments at 1.0x!
          const segCount = timelineSegments.length;
          let computedTotalDur = 0;

          if (segCount === 1) {
            filterParts.push(`[0:v]fps=25,format=yuv420p,setsar=1[vin_0]`);
          } else {
            const splitLabels = timelineSegments.map((_, i) => `[vin_${i}]`).join('');
            filterParts.push(`[0:v]fps=25,format=yuv420p,setsar=1,split=${segCount}${splitLabels}`);
          }

          const concatPairs: string[] = [];
          for (let i = 0; i < segCount; i++) {
            const seg = timelineSegments[i];
            const segStart = Math.max(0, Math.min(meta.duration - 0.1, Number(seg.start || 0)));
            const segEnd = Math.min(meta.duration, Math.max(segStart + 0.15, Number(seg.end || meta.duration)));
            const origSegDur = Math.max(0.15, segEnd - segStart);
            const segWav = path.join(dir, `tts_${seg.id}.wav`);

            if (seg.kind === 'speaking' && fs.existsSync(segWav)) {
              const voiceDur = await probeAudioDuration(segWav);
              const setpts = Math.min(10.0, Math.max(0.1, voiceDur / origSegDur));
              const segInputIdx = nextInputIdx++;
              inputs.push('-i', segWav);

              filterParts.push(
                `[vin_${i}]trim=start=${segStart.toFixed(3)}:end=${segEnd.toFixed(3)},setpts=${setpts.toFixed(6)}*(PTS-STARTPTS),fps=25[sv_${i}]`
              );
              filterParts.push(
                `[${segInputIdx}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,apad=whole_dur=${voiceDur.toFixed(3)},atrim=0:${voiceDur.toFixed(3)}[sa_${i}]`
              );
              computedTotalDur += voiceDur;
            } else {
              // SILENCE SEGMENT: 1.0x original playback speed + completely empty AI voice!
              filterParts.push(
                `[vin_${i}]trim=start=${segStart.toFixed(3)}:end=${segEnd.toFixed(3)},setpts=PTS-STARTPTS,fps=25[sv_${i}]`
              );
              filterParts.push(
                `anullsrc=r=48000:cl=mono:d=${origSegDur.toFixed(3)}[sa_${i}]`
              );
              computedTotalDur += origSegDur;
            }
            concatPairs.push(`[sv_${i}][sa_${i}]`);
          }

          dur = Math.max(0.5, computedTotalDur);

          if (segCount === 1) {
            filterParts.push(
              `[sv_0]scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2:color=#090b10,setsar=1[v_base]`
            );
            filterParts.push(`[sa_0]acopy[a_tts]`);
          } else {
            filterParts.push(
              `${concatPairs.join('')}concat=n=${segCount}:v=1:a=1[v_joined][a_tts]`
            );
            filterParts.push(
              `[v_joined]scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2:color=#090b10,setsar=1[v_base]`
            );
          }
          joinedAudioLabel = '[a_tts]';
        } else {
          // Legacy / Caption-only single-stream path
          let aiVoiceDuration = 0;
          if (hasTts) {
            inputs.push('-i', ttsPath);
            singleTtsIdx = nextInputIdx++;
            aiVoiceDuration = await probeAudioDuration(ttsPath);
          }
          const videoSyncPlan = hasTts
            ? computeVideoSpeedSyncPlan(meta.duration, aiVoiceDuration)
            : null;
          dur = videoSyncPlan ? videoSyncPlan.aiVoiceDuration : Math.max(0.5, meta.duration);
          const videoSetptsFilter = videoSyncPlan
            ? `setpts=${videoSyncPlan.setptsFactor.toFixed(6)}*PTS,fps=25,`
            : '';

          filterParts.push(
            `[0:v]${videoSetptsFilter}scale=${outWidth}:${outHeight}:force_original_aspect_ratio=decrease,pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2:color=#090b10,setsar=1[v_base]`
          );
        }

        // Synthesize smooth ambient BGM bed matching final combined duration
        let bgmIdx = -1;
        const safeCrossfade = Math.min(crossfadeSec, Math.max(0.2, dur * 0.4));
        if (musicMood !== 'none' && tool !== 'captions') {
          const bgmPath = path.join(dir, 'bgm_bed.wav');
          const baseFreq = musicMood === 'thriller' ? 98 : musicMood === 'action' ? 130.8 : 110;
          const harmFreq = musicMood === 'thriller' ? 146.8 : musicMood === 'action' ? 196 : 164.8;
          await execFileAsync('ffmpeg', [
            '-y',
            '-f',
            'lavfi',
            '-i',
            `sine=frequency=${baseFreq}:duration=${dur.toFixed(3)}`,
            '-f',
            'lavfi',
            '-i',
            `sine=frequency=${harmFreq}:duration=${dur.toFixed(3)}`,
            '-filter_complex',
            `[0:a]volume=0.14[a0];[1:a]volume=0.09[a1];[a0][a1]amix=inputs=2:duration=first,lowpass=f=650,afade=t=in:st=0:d=${safeCrossfade.toFixed(2)},afade=t=out:st=${Math.max(0.1, dur - safeCrossfade).toFixed(2)}:d=${safeCrossfade.toFixed(2)}[out]`,
            '-map',
            '[out]',
            bgmPath,
          ]);
          inputs.push('-i', bgmPath);
          bgmIdx = nextInputIdx++;
        }

        // Optional subtle transition SFX chime/whoosh at midpoint
        let sfxIdx = -1;
        if (sfxEnabled && tool === 'recap' && dur >= 2) {
          const sfxPath = path.join(dir, 'sfx_bed.wav');
          const mid = Math.max(0.6, Math.min(dur - 0.95, dur / 2));
          await execFileAsync('ffmpeg', [
            '-y',
            '-f',
            'lavfi',
            '-i',
            `anoisesrc=color=pink:duration=0.9`,
            '-filter_complex',
            `[0:a]bandpass=f=480:width_type=h:w=320,afade=t=in:st=0:d=0.35,afade=t=out:st=0.45:d=0.45,volume=0.18,adelay=${Math.round(mid * 1000)}|${Math.round(mid * 1000)},apad=whole_dur=${dur.toFixed(3)},atrim=0:${dur.toFixed(3)}[out]`,
            '-map',
            '[out]',
            sfxPath,
          ]);
          inputs.push('-i', sfxPath);
          sfxIdx = nextInputIdx++;
        }

        let autoBlurVideoLabel = 'v_base';
        if (autoBlurEnabled && autoBlurRegions.length > 0) {
          const fittedScale = Math.min(outWidth / meta.width, outHeight / meta.height);
          const fittedWidth = Math.max(2, Math.round((meta.width * fittedScale) / 2) * 2);
          const fittedHeight = Math.max(2, Math.round((meta.height * fittedScale) / 2) * 2);
          const offsetX = Math.floor((outWidth - fittedWidth) / 2);
          const offsetY = Math.floor((outHeight - fittedHeight) / 2);
          const contentLeft = Math.ceil(offsetX / 2) * 2;
          const contentTop = Math.ceil(offsetY / 2) * 2;
          const contentRight = Math.floor((offsetX + fittedWidth) / 2) * 2;
          const contentBottom = Math.floor((offsetY + fittedHeight) / 2) * 2;
          const regions = autoBlurRegions.map((region) => {
            const paddingX = Math.max(2, Math.round((region.width / 1000) * fittedWidth * 0.06));
            const paddingY = Math.max(2, Math.round((region.height / 1000) * fittedHeight * 0.12));
            const x = Math.max(
              contentLeft,
              Math.floor((offsetX + (region.x / 1000) * fittedWidth - paddingX) / 2) * 2
            );
            const y = Math.max(
              contentTop,
              Math.floor((offsetY + (region.y / 1000) * fittedHeight - paddingY) / 2) * 2
            );
            const right = Math.min(
              contentRight,
              Math.ceil((offsetX + ((region.x + region.width) / 1000) * fittedWidth + paddingX) / 2) * 2
            );
            const bottom = Math.min(
              contentBottom,
              Math.ceil((offsetY + ((region.y + region.height) / 1000) * fittedHeight + paddingY) / 2) * 2
            );
            return {
              x,
              y,
              width: Math.max(2, right - x),
              height: Math.max(2, bottom - y),
            };
          });

          if (autoBlurStyle === 'solid') {
            let currentLabel = 'v_base';
            regions.forEach((region, index) => {
              const nextLabel = `auto_solid_${index}`;
              filterParts.push(
                `[${currentLabel}]drawbox=x=${region.x}:y=${region.y}:w=${region.width}:h=${region.height}:color=black:t=fill[${nextLabel}]`
              );
              currentLabel = nextLabel;
            });
            autoBlurVideoLabel = currentLabel;
          } else {
            const splitLabels = regions.map((_, index) => `[auto_mask_src_${index}]`).join('');
            filterParts.push(`[v_base]split=${regions.length + 1}[auto_mask_base]${splitLabels}`);
            let currentLabel = 'auto_mask_base';
            regions.forEach((region, index) => {
              const patchLabel = `auto_mask_patch_${index}`;
              const nextLabel = `auto_mask_out_${index}`;
              const cropped = `[auto_mask_src_${index}]crop=${region.width}:${region.height}:${region.x}:${region.y}`;
              if (autoBlurStyle === 'blur') {
                filterParts.push(`${cropped},gblur=sigma=${(autoBlurStrength * fittedScale).toFixed(2)}[${patchLabel}]`);
              } else {
                const blockSize = Math.max(2, Math.round(autoBlurStrength * fittedScale));
                const smallWidth = Math.max(1, Math.round(region.width / blockSize));
                const smallHeight = Math.max(1, Math.round(region.height / blockSize));
                filterParts.push(
                  `${cropped},scale=${smallWidth}:${smallHeight}:flags=neighbor,scale=${region.width}:${region.height}:flags=neighbor[${patchLabel}]`
                );
              }
              filterParts.push(
                `[${currentLabel}][${patchLabel}]overlay=x=${region.x}:y=${region.y}:shortest=1[${nextLabel}]`
              );
              currentLabel = nextLabel;
            });
            autoBlurVideoLabel = currentLabel;
          }
        }

        let finalVideoLabel = autoBlurVideoLabel;
        if (logoIdx >= 0) {
          const logoWidthPx = Math.round((logoScale / 100) * outWidth);
          const lx = `max(12\\,min(W-w-12\\,${Math.round((logoPos.x / 100) * outWidth)}-w/2))`;
          const ly = `max(12\\,min(H-h-12\\,${Math.round((logoPos.y / 100) * outHeight)}-h/2))`;
          filterParts.push(`[${logoIdx}:v]scale=${logoWidthPx}:-1[logo_scaled]`);
          filterParts.push(`[${autoBlurVideoLabel}][logo_scaled]overlay=x=${lx}:y=${ly}[v_out]`);
          finalVideoLabel = 'v_out';
        }

        // Smooth Audio Crossfade & Ducking Pipeline synced to final combined timeline
        let finalAudioLabel = '';
        if (tool === 'captions') {
          if (meta.hasAudio) {
            filterParts.push(`[0:a]afade=t=in:st=0:d=0.25,afade=t=out:st=${Math.max(0.1, dur - 0.35).toFixed(2)}:d=0.35,atrim=0:${dur.toFixed(3)}[a_out]`);
            finalAudioLabel = 'a_out';
          }
        } else {
          const audioMixInputs: string[] = [];
          if (joinedAudioLabel) {
            audioMixInputs.push(joinedAudioLabel);
          } else if (hasTts && singleTtsIdx >= 0) {
            filterParts.push(`[${singleTtsIdx}:a]aresample=48000,afade=t=in:st=0:d=0.03,apad=whole_dur=${dur.toFixed(3)},atrim=0:${dur.toFixed(3)}[a_tts]`);
            audioMixInputs.push('[a_tts]');
          }
          if (bgmIdx >= 0) {
            const bgmGain = hasTts ? 0.28 : 0.75;
            filterParts.push(`[${bgmIdx}:a]aresample=48000,volume=${bgmGain},atrim=0:${dur.toFixed(3)}[a_bgm]`);
            audioMixInputs.push('[a_bgm]');
          }
          if (sfxIdx >= 0) {
            filterParts.push(`[${sfxIdx}:a]aresample=48000,atrim=0:${dur.toFixed(3)}[a_sfx]`);
            audioMixInputs.push('[a_sfx]');
          }
          if (audioMixInputs.length === 0 && meta.hasAudio) {
            filterParts.push(`[0:a]aresample=48000,afade=t=in:st=0:d=0.25,atrim=0:${dur.toFixed(3)}[a_out]`);
            finalAudioLabel = 'a_out';
          } else if (audioMixInputs.length === 1) {
            filterParts.push(`${audioMixInputs[0]}acopy[a_out]`);
            finalAudioLabel = 'a_out';
          } else if (audioMixInputs.length > 1) {
            filterParts.push(
              `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=${safeCrossfade.toFixed(2)},dynaudnorm=f=150:g=15,atrim=0:${dur.toFixed(3)}[a_out]`
            );
            finalAudioLabel = 'a_out';
          }
        }

        const outputPath = path.join(dir, `final_${resolution}.mp4`);
        const ffmpegArgs = [
          ...inputs,
          '-filter_complex',
          filterParts.join(';'),
          '-map',
          `[${finalVideoLabel}]`,
          ...(finalAudioLabel ? ['-map', `[${finalAudioLabel}]`, '-c:a', 'aac', '-b:a', '192k'] : ['-an']),
          '-c:v',
          'libx264',
          '-preset',
          resolution === '4k' ? 'ultrafast' : 'veryfast',
          '-crf',
          resolution === '4k' ? '20' : '21',
          '-pix_fmt',
          'yuv420p',
          '-t',
          dur.toFixed(3),
          '-movflags',
          '+faststart',
          outputPath,
        ];

        await execFileAsync('ffmpeg', ffmpegArgs);

        // Save or generate content-driven thumbnail preserving exact chosen platform aspect ratio
        const thumbPath = path.join(dir, 'thumbnail.jpg');
        const thumbScaleCrop = `scale=${thumbDims.width}:${thumbDims.height}:force_original_aspect_ratio=increase,crop=${thumbDims.width}:${thumbDims.height}`;
        if (uploadedThumb && fs.existsSync(uploadedThumb.path)) {
          await execFileAsync('ffmpeg', [
            '-y',
            '-i',
            uploadedThumb.path,
            '-vf',
            thumbScaleCrop,
            '-q:v',
            '2',
            thumbPath,
          ]);
        } else {
          await execFileAsync('ffmpeg', [
            '-y',
            '-ss',
            String(Math.min(2, dur * 0.25)),
            '-i',
            outputPath,
            '-vframes',
            '1',
            '-vf',
            thumbScaleCrop,
            '-q:v',
            '2',
            thumbPath,
          ]);
        }

        res.json({
          outputVideoUrl: `/api/session/${sessionId}/file/final_${resolution}.mp4`,
          thumbnailUrl: `/api/session/${sessionId}/file/thumbnail.jpg?v=${Date.now()}`,
          thumbnailTitle,
          thumbnailAspectRatio,
          resolution,
        });
      } catch (error) {
        console.error('Render error:', error);
        res.status(500).json({ errorMy: 'ဗီဒီယို အပြီးသတ်ထုတ်လုပ်ရာတွင် အမှားဖြစ်ပွားပါသည်' });
      }
    }
  );

  // 9b. Fast Thumbnail Update Endpoint (updates saved thumbnail.jpg when user switches aspect ratio in Step 6)
  app.post('/api/render-thumbnail', upload.single('thumbnail'), async (req: Request, res: Response) => {
    try {
      const sessionId = String(req.body?.sessionId || '');
      if (!sessionId || !req.file) {
        res.status(400).json({ errorMy: 'Thumbnail ဖိုင် သို့မဟုတ် Session ID မတွေ့ပါ' });
        return;
      }
      const dir = getSessionDir(sessionId);
      const thumbnailAspectRatio = normalizeThumbnailAspectRatio(
        typeof req.body?.thumbnailAspectRatio === 'string' ? req.body.thumbnailAspectRatio : '16:9'
      );
      const thumbDims = getThumbnailDimensions(thumbnailAspectRatio);
      const thumbPath = path.join(dir, 'thumbnail.jpg');

      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        req.file.path,
        '-vf',
        `scale=${thumbDims.width}:${thumbDims.height}:force_original_aspect_ratio=increase,crop=${thumbDims.width}:${thumbDims.height}`,
        '-q:v',
        '2',
        thumbPath,
      ]);

      res.json({
        thumbnailUrl: `/api/session/${sessionId}/file/thumbnail.jpg?v=${Date.now()}`,
        thumbnailAspectRatio,
      });
    } catch (error) {
      console.error('Render thumbnail error:', error);
      res.status(500).json({ errorMy: 'Thumbnail ပုံ အသစ်ပြောင်းလဲရာတွင် အမှားဖြစ်ပွားပါသည်' });
    }
  });

  // 10. Step 10: Send finished video + viral thumbnail directly to user's Telegram bot
  app.post('/api/telegram/send', async (req: Request, res: Response) => {
    try {
      const botToken = getTelegramBotToken();
      if (!botToken) {
        res.status(400).json({
          missingKey: 'TELEGRAM_BOT_TOKEN',
          errorMy: 'TELEGRAM_BOT_TOKEN မသတ်မှတ်ရသေးပါ — Server Environment Variable တွင် ထည့်သွင်းပါ',
        });
        return;
      }

      const sessionId = String(req.body?.sessionId || '');
      const chatId = String(req.body?.chatId || '').trim();
      const resolution = (req.body?.resolution || '1080p') as ExportResolution;
      const thumbnailTitle = truncateThumbnailTitle(String(req.body?.thumbnailTitle || 'AlphaRecap Studio'));

      if (!sessionId || !chatId) {
        res.status(400).json({ errorMy: 'Telegram Chat ID ထည့်သွင်းပေးပါ' });
        return;
      }

      const dir = getSessionDir(sessionId);
      const videoPath = path.join(dir, `final_${resolution}.mp4`);
      const thumbPath = path.join(dir, 'thumbnail.jpg');

      if (!fs.existsSync(videoPath)) {
        res.status(404).json({ errorMy: 'ပေးပို့ရန် အပြီးသတ် ဗီဒီယိုဖိုင် မတွေ့သေးပါ — ဦးစွာ ဗီဒီယိုထုတ်လုပ်ပါ' });
        return;
      }

      // Send thumbnail photo first if available
      if (fs.existsSync(thumbPath)) {
        const thumbBytes = fs.readFileSync(thumbPath);
        const photoRes = await withTransientRetry(() => {
          const photoForm = new FormData();
          photoForm.append('chat_id', chatId);
          photoForm.append('caption', `🎬 ${thumbnailTitle}\n✨ AlphaRecap Studio မှ ဖန်တီးထားသော Viral Thumbnail`);
          photoForm.append('photo', new Blob([thumbBytes], { type: 'image/jpeg' }), 'thumbnail.jpg');
          return fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: photoForm,
          });
        });
        if (!photoRes.ok) {
          const errText = await photoRes.text();
          console.error('Telegram sendPhoto failed:', errText);
          res.status(400).json({ errorMy: 'Telegram သို့ Thumbnail ပို့ရာတွင် မအောင်မြင်ပါ — Chat ID နှင့် Bot /start လုပ်ထားမှု စစ်ဆေးပါ' });
          return;
        }
      }

      // Send finished MP4 video
      const videoBytes = fs.readFileSync(videoPath);
      const videoRes = await withTransientRetry(() => {
        const videoForm = new FormData();
        videoForm.append('chat_id', chatId);
        videoForm.append('caption', `🔥 ${thumbnailTitle} (${resolution.toUpperCase()})`);
        videoForm.append('supports_streaming', 'true');
        videoForm.append('video', new Blob([videoBytes], { type: 'video/mp4' }), `alpharecap_${resolution}.mp4`);
        return fetch(`https://api.telegram.org/bot${botToken}/sendVideo`, {
          method: 'POST',
          body: videoForm,
        });
      });

      if (!videoRes.ok) {
        const errText = await videoRes.text();
        console.error('Telegram sendVideo failed:', errText);
        res.status(400).json({ errorMy: 'Telegram သို့ ဗီဒီယိုပေးပို့ရာတွင် မအောင်မြင်ပါ — Chat ID မှန်ကန်ကြောင်း စစ်ဆေးပါ' });
        return;
      }

      res.json({
        ok: true,
        messageMy: 'ဗီဒီယိုနှင့် Viral Thumbnail ကို Telegram Bot သို့ အောင်မြင်စွာ ပေးပို့ပြီးပါပြီ!',
      });
    } catch (error) {
      console.error('Telegram send error:', error);
      res.status(500).json({ errorMy: 'Telegram ချိတ်ဆက်ပေးပို့ရာတွင် အမှားဖြစ်ပွားပါသည်' });
    }
  });

  // 11. Credit purchase confirmation (KBZPay MMK & PromptPay THB — one-time, never expires)
  app.post('/api/credits/purchase', (req: Request, res: Response) => {
    const packageId = String(req.body?.packageId || '');
    const paymentMethod = String(req.body?.paymentMethod || '');
    const referenceNo = String(req.body?.referenceNo || '').trim();

    const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      res.status(400).json({ errorMy: 'Credit Package ရွေးချယ်မှု မမှန်ကန်ပါ' });
      return;
    }
    if (paymentMethod !== 'kbzpay' && paymentMethod !== 'promptpay') {
      res.status(400).json({ errorMy: 'KBZPay သို့မဟုတ် PromptPay ငွေပေးချေမှုနည်းလမ်း ရွေးချယ်ပါ' });
      return;
    }
    if (referenceNo.length < 6) {
      res.status(400).json({ errorMy: 'ငွေလွှဲပြေစာ နံပါတ် (Transaction ID) အနည်းဆုံး ၆ လုံး ထည့်သွင်းပါ' });
      return;
    }

    res.json({
      ok: true,
      addedCredits: pkg.credits,
      packageName: pkg.nameMy,
      messageMy: `${pkg.credits} Credits ကို ဝယ်ယူဖြည့်သွင်းပြီးပါပြီ (သက်တမ်းကုန်ဆုံးခြင်း မရှိပါ)`,
    });
  });

  // 12. Immediate ephemeral cleanup when user closes or navigates away
  app.post('/api/session/cleanup', (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || req.query?.sessionId || '');
    cleanupSessionDir(sessionId);
    res.json({ ok: true });
  });

  // Structured JSON error middleware for /api/* (e.g. Multer errors never leak HTML 500 pages)
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ errorMy: 'ဗီဒီယိုဖိုင် အရွယ်အစား 2GB ထက် ကျော်လွန်နေပါသည်' });
        return;
      }
      res.status(400).json({ errorMy: `ဖိုင်တင်သွင်းမှု အမှား (${err.code}) — ထပ်မံကြိုးစားပါ` });
      return;
    }
    console.error('Unhandled /api error:', err);
    res.status(500).json({ errorMy: 'ဆာဗာ လုပ်ဆောင်ချက်အတွင်း အမှားဖြစ်ပွားပါသည်' });
  });

  // Serve Vite in dev or dist/ in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`AlphaRecap Studio server listening on http://localhost:${PORT}`);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 120000;
}

startServer().catch((err) => {
  console.error('Failed to start AlphaRecap Studio server:', err);
  process.exit(1);
});
