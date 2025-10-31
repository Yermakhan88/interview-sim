import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// ---------- GOOGLE KEY (/tmp/key.json) ----------
if (process.env.STT_PROVIDER === 'google' && process.env.GOOGLE_CLOUD_KEY) {
  const keyFile = path.join('/tmp', 'key.json');
  try {
    fs.writeFileSync(keyFile, Buffer.from(process.env.GOOGLE_CLOUD_KEY, 'base64'));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
    console.log('[init] wrote GOOGLE_APPLICATION_CREDENTIALS to /tmp/key.json');
  } catch (e) {
    console.error('[init] failed to write key.json:', e);
  }
}

// ---------- APP ----------
const app = express();

// CORS (уақытша кең)
app.use(cors({
  origin: (_origin, cb) => cb(null, true),
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

// Денсаулық
app.get('/healthz', (_req: Request, res: Response) => res.send('ok'));

// ---------- UPLOAD ----------
const upload = multer({
  dest: path.join('/tmp'), // Render-да жазуға болатын жер
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ---------- WEBM -> WAV (ffmpeg) ----------
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
ffmpeg.setFfmpegPath(ffmpegPath as string);

async function toWav16kIfNeeded(inputPath: string): Promise<string> {
  const lower = inputPath.toLowerCase();
  if (lower.endsWith('.wav')) return inputPath;

  const outPath = inputPath + '.wav';
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('pcm_s16le')        // LINEAR16
      .audioFrequency(16000)          // 16kHz
      .format('wav')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outPath);
  });
  return outPath;
}

// ---------- GOOGLE STT ----------
import speech from '@google-cloud/speech';
const speechClient = new speech.SpeechClient();

async function transcribeGoogle(wavPath: string): Promise<string> {
  const audioBytes = fs.readFileSync(wavPath).toString('base64');
  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'kk-KZ',          // қажет болса 'ru-RU' немесе 'en-US'
      enableAutomaticPunctuation: true,
    },
  };
  const [response] = await speechClient.recognize(request as any);
  const text = (response.results ?? [])
    .map(r => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();
  return text || '';
}

// ---------- SIMPLE METRICS ----------
function analyzeTranscript(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const fillerWords = ['ээ', 'мм', 'как бы', 'типа', 'ну', 'эээ', 'ой', 'uh', 'um', 'like', 'you know'];
  const fillerCount = words.filter(w => fillerWords.includes(w.toLowerCase())).length;
  const wpm = Math.round(words.length / 0.5); // өте шамамен: 30сек сөйлесе, 2ге бөл т.с.с. (демо)
  const tips: string[] = [];
  if (fillerCount > 3) tips.push('Қолдануыш толтырма сөздерді азайтыңыз.');
  if (wpm > 180) tips.push('Тым жылдам сөйлеудесіз — қарқынды баяулатыңыз.');
  if (wpm < 80) tips.push('Сөйлеу қарқынын сәл жылдамдатыңыз.');
  if (!text) tips.push('Микрофон не форматпен мәселе болуы мүмкін.');
  return { wpm, fillerCount, tips };
}

// ---------- MAIN ENDPOINT ----------
app.post('/api/analyze', upload.single('audio'), async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'audio missing' });
    }
    console.log('[analyze] file:', req.file.originalname, req.file.mimetype, req.file.path);

    // webm → wav
    let wavPath: string;
    try {
      wavPath = await toWav16kIfNeeded(req.file.path);
      console.log('[analyze] converted to wav:', wavPath);
    } catch (e:any) {
      console.error('[ffmpeg] convert error:', e?.message || e);
      return res.status(500).json({ error: 'ffmpeg conversion failed', detail: String(e?.message || e) });
    }

    // Google STT
    let text = '';
    try {
      text = await transcribeGoogle(wavPath);
      console.log('[stt] text:', text.slice(0, 120));
    } catch (e:any) {
      console.error('[stt] error:', e?.message || e);
      return res.status(500).json({ error: 'google stt failed', detail: String(e?.message || e) });
    }

    const metrics = analyzeTranscript(text);

    // cleanup
    try { if (wavPath !== req.file.path) fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(req.file.path); } catch {}

    res.json({ text, metrics, took_ms: Date.now() - start });
  } catch (e:any) {
    console.error('[analyze] unexpected:', e?.message || e);
    res.status(500).json({ error: 'unexpected', detail: String(e?.message || e) });
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
