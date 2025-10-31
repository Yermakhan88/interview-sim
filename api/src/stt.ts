export async function transcribe(filePath: string): Promise<string> {
  const p = process.env.STT_PROVIDER || 'google'; // 'google' | 'vosk'
  if (p === 'vosk') return transcribeVosk(filePath);
  return transcribeGoogle(filePath);
}

async function transcribeGoogle(filePath: string) {
  const speech = await import('@google-cloud/speech');
  const client = new speech.v1p1beta1.SpeechClient();
  const fs = await import('fs/promises');
  const audioBytes = await fs.readFile(filePath);

  const [resp] = await client.recognize({
    audio: { content: audioBytes.toString('base64') },
    config: {
      languageCode: 'ru-RU',
      alternativeLanguageCodes: ['kk-KZ','en-US'],
      enableAutomaticPunctuation: true
    }
  });
  return (resp.results ?? []).map(r => r.alternatives?.[0]?.transcript ?? '').join(' ').trim();
}

async function transcribeVosk(filePath: string) {
  const fs = await import('fs');
  const fetch = (await import('node-fetch')).default as any;
  const url = process.env.VOSK_SERVER_URL || 'http://vosk:2700';
  const data = fs.readFileSync(filePath);
  const r = await fetch(`${url}/transcribe`, {
    method: 'POST',
    body: data,
    headers: { 'Content-Type': 'audio/wav' } // қажет болса бекендте webm->wav түрлендіресің
  });
  const j = await r.json();
  return (j.text || '').trim();
}
