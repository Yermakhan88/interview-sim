// app.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const {SpeechClient} = require('@google-cloud/speech');
const fetch = (...args) => import('node-fetch').then(({default:fetch})=>fetch(...args));
const cors = require('cors');

const app = express();
app.use(cors());

// serve static frontend
app.use(express.static('public'));

// --- Google service account from base64 env (if provided) ---
if(process.env.GOOGLE_SERVICE_ACCOUNT_B64){
  const buff = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64');
  fs.writeFileSync(path.resolve('./gcs-key.json'), buff);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve('./gcs-key.json');
}

// init Google Speech client
const speechClient = new SpeechClient();

const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({ error: 'No audio uploaded' });

    // convert buffer to base64
    const audioBytes = req.file.buffer.toString('base64');

    // request config — WEBM_OPUS is common from MediaRecorder
    const sttRequest = {
      audio: { content: audioBytes },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: process.env.LANGUAGE_CODE || 'kk-KZ'
      }
    };

    const [sttResponse] = await speechClient.recognize(sttRequest);
    const transcript = (sttResponse.results || [])
      .map(r => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '')
      .join(' ')
      .trim();

    // Call OpenAI Chat API for feedback
    const openaiKey = process.env.OPENAI_API_KEY;
    if(!openaiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set on server' });

    const userPrompt = `Студенттің транскрипті: "${transcript}"
Өтініш: қысқаша және нақты кері байланыс беріңіз, келесі критерий бойынша: 
1) Коммуникация (ойды жеткізу айқын ба), 
2) Логика/құрылым, 
3) Сенімділік, 
4) Аргументтердің сапасы, 
5) Қысқалығы/нәтижелілігі. 
Әр критерийге 1-5 шкала бойынша қысқа балл қойып, JSON форматында ғана қайтарыңыз. Мысалы:
{"transcript":"...","feedback":{"communication":"...","scores":{"communication":4,"logic":3,"confidence":4,"arguments":3,"conciseness":5}}}
`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Сіз интервью жауаптарын бағалайтын ассистентсіз. Қысқа және конструктивті болыңыз.' },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 400,
        temperature: 0.2
      })
    });

    const data = await resp.json();
    const feedback = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || JSON.stringify(data);

    res.json({ transcript, feedback });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
