import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express, { Request, Response } from 'express'; // ← типтер
import cors from 'cors';
import multer from 'multer';
import { transcribe } from './stt.js';
import { analyzeTranscript } from './scoring.js';

const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN?.split(',') ?? ['*']), credentials: true }));
app.use(express.json({ limit: '2mb' }));

if (process.env.STT_PROVIDER === 'google' && process.env.GOOGLE_CLOUD_KEY) {
  // /etc жазуға болмайды → Render-да /tmp рұқсат етілген
  const keyFile = path.join('/tmp', 'key.json');
  fs.writeFileSync(keyFile, Buffer.from(process.env.GOOGLE_CLOUD_KEY, 'base64'));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
}

app.get('/healthz', (_req: Request, res: Response) => res.send('ok'));

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 30 * 1024 * 1024 }
});

app.get('/api/analyze', (_req: Request, res: Response) => {
  res.json({ ok: true, endpoint: 'POST /api/analyze', note: 'GET added for debug' });
});

app.post('/api/analyze', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio missing' });
    const text = await transcribe(req.file.path);
    const metrics = analyzeTranscript(text);
    res.json({ text, metrics });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on :${PORT}`));
