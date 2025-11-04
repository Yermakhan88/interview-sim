import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// ---- GOOGLE KEY to /tmp ----
if (process.env.STT_PROVIDER === 'google' && process.env.GOOGLE_CLOUD_KEY) {
  const keyFile = path.join('/tmp', 'key.json');
  try {
    fs.writeFileSync(keyFile, Buffer.from(process.env.GOOGLE_CLOUD_KEY, 'base64'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
    console.log('[init] GOOGLE_APPLICATION_CREDENTIALS=/tmp/key.json');
  } catch (e) {
    console.error('[init] key.json write failed:', e);
  }
}

const app = express();

// ---- CORS (wide during dev) ----
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.options('*', cors());

// ---- Health ----
app.get('/healthz', (_req: Request, res: Response) => res.send('ok'));

// ---- Upload to /tmp ----
const upload = multer({
  dest: '/tmp',
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ---- FFmpeg setup ----
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
ffmpeg.setFfmpegPath((ffmpegPath as unknown as string) || 'ffmpeg');

function toWav16kIfNeeded(inputPath: string): Promise<string> {
  const outPath = inputPath.toLowerCase().endsWith('.wav') ? inputPath : inputPath + '.wav';
  return new Promise((resolve, reject) => {
    const chain = inputPath === outPath
      ? ffmpeg(inputPath)
      : ffmpeg(inputPath).audioCodec('pcm_s16le').audioFrequency(16000).format('wav');

    chain.on('end', () => resolve(outPath))
         .on('error', reject)
         .save(outPath);
  });
}

// ---- Google STT (clean import) ----
import { SpeechClient } from '@google-cloud/speech';
const speechClient = new SpeechClient();

async function transcribeGoogle(wavPath: string): Promise<string> {
  const audioBytes = fs.readFileSync(wavPath).toString('base64');
  if (!audioBytes) return '';
  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'kk-KZ',
      enableAutomaticPunctuation: true
    }
  } as any;
  const [resp] = await speechClient.recognize(request);
  return (resp.results ?? [])
    .map(r => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();
}

// ---- Main endpoint ----
app.post('/api/analyze', upload.single('audio'), async (req: Request, res: Response) => {
  const t0 = Date.now();
  try {
    if (!req.file) return res.status(400).json({ error: 'audio missing' });

    let wavPath: string;
    try {
      wavPath = await toWav16kIfNeeded(req.file.path);
      const st = fs.statSync(wavPath);
      if (!st.size) return res.status(400).json({ error: 'empty_audio', detail: 'Converted WAV is empty' });
    } catch (e: any) {
      return res.status(500).json({ error: 'ffmpeg conversion failed', detail: String(e?.message || e) });
    }

    let text = '';
    try {
      text = await transcribeGoogle(wavPath);
    } catch (e: any) {
      return res.status(500).json({ error: 'google stt failed', detail: String(e?.message || e) });
    }

    try { if (wavPath !== req.file.path) fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(req.file.path); } catch {}

    return res.json({ text, metrics: simpleMetrics(text), took_ms: Date.now() - t0 });
  } catch (e: any) {
    return res.status(500).json({ error: 'unexpected', detail: String(e?.message || e) });
  }
});

function simpleMetrics(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const fillers = ['ээ', 'мм', 'ну', 'ой', 'uh', 'um', 'like', 'you know'];
  const fillerCount = words.filter(w => fillers.includes(w.toLowerCase())).length;
  const wpm = Math.round(words.length / 0.5);
  const tips: string[] = [];
  if (!text) tips.push('Микрофон/форматпен мәселе болуы мүмкін.');
  if (fillerCount > 3) tips.push('Толтырма сөздерді азайтыңыз.');
  if (wpm > 180) tips.push('Қарқынды баяулатыңыз.');
  if (wpm < 80) tips.push('Сөйлеуді сәл жылдамдатыңыз.');
  return { wpm, fillerCount, tips };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
