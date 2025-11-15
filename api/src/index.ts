import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { SpeechClient } from '@google-cloud/speech';

// ----------------------
// Types
// ----------------------
type Metrics = { wpm: number; fillerCount: number; tips?: string[] };

interface SoftAspect {
  score: number;
  comment: string;
}

interface SoftSkills {
  communication: SoftAspect;
  structure: SoftAspect;
  confidence: SoftAspect;
  relevance: SoftAspect;
  conciseness: SoftAspect;
}

// ----------------------
// Language map
// ----------------------
const LANG_MAP: Record<string, string> = {
  kk: 'kk-KZ',
  ru: 'ru-RU',
  en: 'en-US',
};

// ----------------------
// AI-based Soft Skills Analysis (OpenAI)
// ----------------------
async function analyzeWithAI(
  text: string,
  languageCode: string,
  metrics: Metrics,
  question?: string
) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[ai] OPENAI_API_KEY missing, skipping AI analysis');
    return null;
  }

  // Жауап тіліне қарай талдау тілін таңдаймыз
  let lang: 'kk' | 'ru' | 'en' = 'en';
  if (languageCode.startsWith('kk')) lang = 'kk';
  else if (languageCode.startsWith('ru')) lang = 'ru';

  const systemPrompt =
    lang === 'kk'
      ? 'Сен – soft skills (коммуникация, құрылым, сенімділік, релеванттық, қысқалық) бойынша сұхбат жауаптарын бағалайтын ассистентсің. Тек JSON форматында жауап бер.'
      : lang === 'ru'
      ? 'Ты ассистент по оценке soft skills (коммуникация, структура, уверенность, релевантность, лаконичность) в ответах на собеседовании. Отвечай строго в формате JSON.'
      : 'You are an assistant that evaluates soft skills (communication, structure, confidence, relevance, conciseness) in interview answers. Reply strictly in JSON.';

  const userPrompt = `
Question:
${question || '(no explicit question, free-form answer)'}

Answer transcript:
${text || '(empty)'}

Basic metrics (from system):
- Words per minute (WPM): ${metrics.wpm}
- Filler words count: ${metrics.fillerCount}

Task:
1. Give an overall score (0–100) for this answer.
2. Evaluate 5 aspects: communication, structure, confidence, relevance, conciseness.
   For each aspect, give:
   - score: integer 1–5
   - comment: short comment in ${lang === 'kk' ? 'Kazakh' : lang === 'ru' ? 'Russian' : 'English'}.
3. List 3–5 strengths (bulleted style).
4. List 3–5 concrete improvement suggestions.
5. Optionally, propose a short improved version outline (not full text, just structure).

Return ONLY valid JSON with the following shape (no explanations, no markdown):

{
  "overallScore": 0,
  "level": "beginner" | "intermediate" | "advanced",
  "aspects": {
    "communication": { "score": 0, "comment": "..." },
    "structure": { "score": 0, "comment": "..." },
    "confidence": { "score": 0, "comment": "..." },
    "relevance": { "score": 0, "comment": "..." },
    "conciseness": { "score": 0, "comment": "..." }
  },
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "outline": "Short outline text here"
}
`;

  const body = {
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' }
  };

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data: any = await resp.json();

    const raw =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.message?.content?.[0]?.text ||
      '';

    if (!raw) {
      console.warn('[ai] empty AI content', JSON.stringify(data).slice(0, 300));
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      console.warn('[ai] failed to parse AI JSON:', e);
      return { raw }; // ең болмағанда мәтін ретінде қайтару
    }
  } catch (e: any) {
    console.error('[ai] request failed:', e?.message || e);
    return null;
  }
}

// ----------------------
// GOOGLE KEY to /tmp
// ----------------------
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

// ----------------------
// Express app
// ----------------------
const app = express();

// CORS (кең, dev үшін)
app.use(cors({ origin: (_o, cb) => cb(null, true) }));
app.options('*', cors());

// Healthcheck
app.get('/healthz', (_req: Request, res: Response) => res.send('ok'));

// Upload to /tmp
const upload = multer({
  dest: '/tmp',
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ----------------------
// FFmpeg setup
// ----------------------
ffmpeg.setFfmpegPath((ffmpegPath as unknown as string) || 'ffmpeg');

function toWav16kIfNeeded(inputPath: string): Promise<string> {
  const outPath = inputPath.toLowerCase().endsWith('.wav') ? inputPath : inputPath + '.wav';
  return new Promise((resolve, reject) => {
    const chain =
      inputPath === outPath
        ? ffmpeg(inputPath)
        : ffmpeg(inputPath).audioCodec('pcm_s16le').audioFrequency(16000).format('wav');

    chain
      .on('end', () => resolve(outPath))
      .on('error', reject)
      .save(outPath);
  });
}

// ----------------------
// Google Speech-to-Text
// ----------------------
const speechClient = new SpeechClient();

async function transcribeGoogle(wavPath: string, languageCode: string): Promise<string> {
  const audioBytes = fs.readFileSync(wavPath).toString('base64');
  if (!audioBytes) return '';

  const request = {
    audio: { content: audioBytes },
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode,
      enableAutomaticPunctuation: true,
    },
  } as any;

  const [response] = await speechClient.recognize(request);
  const text = (response.results ?? [])
    .map(r => r.alternatives?.[0]?.transcript ?? '')
    .join(' ')
    .trim();
  return text || '';
}

// ----------------------
// Simple metrics & эвристика
// ----------------------
function simpleMetrics(text: string): Metrics {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const fillers = ['ээ', 'мм', 'ну', 'ой', 'uh', 'um', 'like', 'you know'];
  const fillerCount = words.filter(w => fillers.includes(w.toLowerCase())).length;

  // Қазірше жауапты шамамен 0.5 минут деп аламыз → жуық wpm
  const wpm = Math.round(words.length / 0.5);

  const tips: string[] = [];
  if (!text) tips.push('Микрофон/форматпен мәселе болуы мүмкін.');
  if (fillerCount > 3) tips.push('Толтырма сөздерді азайтыңыз.');
  if (wpm > 180) tips.push('Қарқынды баяулатыңыз.');
  if (wpm < 80 && words.length > 0) tips.push('Сөйлеуді сәл жылдамдатыңыз.');

  return { wpm, fillerCount, tips };
}

function analyzeSoftSkills(text: string, metrics: Metrics): SoftSkills {
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const soft: SoftSkills = {
    communication: { score: 0, comment: '' },
    structure: { score: 0, comment: '' },
    confidence: { score: 0, comment: '' },
    relevance: { score: 0, comment: '' },
    conciseness: { score: 0, comment: '' },
  };

  // Communication clarity
  if (!text) {
    soft.communication = { score: 1, comment: 'Жауап анық емес немесе жоқ.' };
  } else if (wordCount < 5) {
    soft.communication = { score: 2, comment: 'Жауап тым қысқа, ой толық ашылмаған.' };
  } else if (wordCount < 40) {
    soft.communication = { score: 4, comment: 'Жауап қысқа, бірақ салыстырмалы түрде түсінікті.' };
  } else {
    soft.communication = { score: 5, comment: 'Жауап жеткілікті толық және түсінікті.' };
  }

  // Structure
  const hasConnectors = /сондықтан|сонымен қатар|во-первых|во-вторых|итог/i.test(text);
  if (!text) {
    soft.structure = { score: 1, comment: 'Құрылым байқалмайды.' };
  } else if (hasConnectors) {
    soft.structure = { score: 4, comment: 'Жауапта логикалық жалғаушы сөздер бар.' };
  } else {
    soft.structure = { score: 3, comment: 'Жауап бар, бірақ құрылымы айқын емес.' };
  }

  // Confidence
  if (metrics.wpm < 70) {
    soft.confidence = { score: 2, comment: 'Сөйлеу қарқыны баяу, сенімсіздік болуы мүмкін.' };
  } else if (metrics.wpm > 190 || metrics.fillerCount > 7) {
    soft.confidence = { score: 3, comment: 'Толтырма сөздер көп немесе жылдамдық тым жоғары.' };
  } else {
    soft.confidence = { score: 4, comment: 'Сөйлеу қарқыны жеткілікті, сенімділік жақсы.' };
  }

  // Relevance
  const relevanceHints = /(университет|факультет|жұмыс|команда|студент|teacher|оқу)/i.test(text);
  if (!text) {
    soft.relevance = { score: 1, comment: 'Сұраққа жауап жоқ.' };
  } else if (relevanceHints) {
    soft.relevance = { score: 4, comment: 'Жауап тақырыпқа жақсы сәйкес келеді.' };
  } else {
    soft.relevance = { score: 3, comment: 'Жауап бар, бірақ сұрақпен байланысы әлсіз.' };
  }

  // Conciseness
  if (wordCount < 5) {
    soft.conciseness = { score: 2, comment: 'Жауап тым қысқа.' };
  } else if (wordCount > 160) {
    soft.conciseness = { score: 3, comment: 'Жауап тым ұзын, негізгі ойды қысқартуға болады.' };
  } else {
    soft.conciseness = { score: 4, comment: 'Жауап көлемі тиімді.' };
  }

  return soft;
}

// ----------------------
// Main endpoint
// ----------------------
app.post('/api/analyze', upload.single('audio'), async (req: any, res: any) => {
  const start = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'audio_missing' });
    }

    const langKey = (req.body?.lang || 'kk').toLowerCase();
    const languageCode = LANG_MAP[langKey] || 'kk-KZ';

    // 1) WAV 16kHz-ке конвертация
    let wavPath: string;
    try {
      wavPath = await toWav16kIfNeeded(req.file.path);
      const st = fs.statSync(wavPath);
      if (!st.size) {
        return res.status(400).json({ error: 'empty_audio' });
      }
    } catch (e: any) {
      console.error('[ffmpeg] error:', e);
      return res.status(500).json({ error: 'ffmpeg_failed', detail: e.message });
    }

    // 2) Google STT
    let text = '';
    try {
      text = await transcribeGoogle(wavPath, languageCode);
    } catch (e: any) {
      console.error('[stt] error:', e);
      return res.status(500).json({ error: 'stt_failed', detail: e.message });
    }

    // 3) Метрикалар
    const metrics = simpleMetrics(text);

    // 4) Эвристикалық Soft Skills
    const softSkills = analyzeSoftSkills(text, metrics);

    // 5) Frontend-тен келген сұрақ
    const question: string | undefined = req.body?.question;

    // 6) ЖИ арқылы терең Soft Skills бағалау
    let aiFeedback: any = null;
    try {
      aiFeedback = await analyzeWithAI(text, languageCode, metrics, question);
    } catch (e: any) {
      console.error('[ai] analyzeWithAI failed:', e?.message || e);
      aiFeedback = { error: 'ai_failed', detail: e?.message || String(e) };
    }

    // 7) Уақытша файлдарды тазалау
    try {
      if (wavPath !== req.file.path) fs.unlinkSync(wavPath);
    } catch {}
    try {
      fs.unlinkSync(req.file.path);
    } catch {}

    // 8) Финалдық JSON (frontend дәл осыны күтеді)
    return res.json({
      text,
      languageCode,
      metrics,     // { wpm, fillerCount, tips }
      softSkills,  // эвристика
      aiFeedback,  // OpenAI анализі
      took_ms: Date.now() - start
    });
  } catch (e: any) {
    console.error('analyze_error:', e);
    return res.status(500).json({
      error: 'unexpected',
      detail: String(e?.message || e),
    });
  }
});

// ----------------------
// Start server
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
