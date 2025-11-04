'use client';
import React, { useEffect, useRef, useState } from 'react';

const TITLE = 'Interview Simulator 🎙️';

export default function Page() {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [out, setOut] = useState<any>(null);
  const [status, setStatus] = useState<'idle'|'recording'|'uploading'|'done'>('idle');

  useEffect(() => {
    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recRef.current = mr;
    })().catch(e => alert('Microphone permission needed: ' + e));
  }, []);

  const start = () => {
    const rec = recRef.current;
    if (!rec) return;

    chunksRef.current = [];                // жаңа жазбаға буферді тазалау
    setOut(null);
    setStatus('recording');

    // timeslice: әр 1000 мс сайын dataavailable келеді (Windows-та ең тұрақтысы)
    rec.start(1000);
  };

  const stop = () => {
    const rec = recRef.current;
    if (!rec || rec.state !== 'recording') return;

    // stop оқиғасын ӘУЕЛДЕН ұстаймыз
    rec.addEventListener('stop', async onStopOnce, { once: true });

    // соңғы буферді міндетті түрде шығартамыз да, аздап күтеміз
    try { (rec as any).requestData?.(); } catch {}
    setTimeout(() => rec.stop(), 300);
  };

  async function onStopOnce() {
    try {
      setStatus('uploading');

      if (!chunksRef.current.length) {
        setStatus('idle');
        alert('Дерек бос. 3–4 сек сөйлеп, қайта көріңіз (микрофон рұқсатын тексеріңіз).');
        return;
      }

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const fd = new FormData();
      fd.append('audio', blob, 'clip.webm');

      const r = await fetch('/api/analyze', { method: 'POST', body: fd });
      const txt = await r.text();
      let j:any; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }

      if (!r.ok) {
        alert(`Қате: ${r.status}\n${(typeof j==='string'?j:JSON.stringify(j)).slice(0,500)}`);
        setStatus('idle');
        return;
      }
      setOut(j);
      setStatus('done');
    } catch (e:any) {
      alert('Жіберу қатесі: ' + (e?.message || e));
      setStatus('idle');
    }
  }

  return (
    <main style={{ padding:24, maxWidth:900, margin:'0 auto', fontFamily:'system-ui' }}>
      <h1 suppressHydrationWarning>{TITLE}</h1>

      <div style={{ display:'flex', gap:8, margin:'12px 0' }}>
        <button onClick={start} disabled={status==='recording'}>Start</button>
        <button onClick={stop} disabled={status!=='recording'}>Stop</button>
      </div>

      <p>Status: {status}</p>

      {out && (
        <section style={{ marginTop:16 }}>
          <p><b>Transcript:</b> {out.text ?? out.raw}</p>
          {out.metrics && (
            <>
              <p>WPM: {out.metrics.wpm} | Fillers: {out.metrics.fillerCount}</p>
              <ul>{out.metrics.tips.map((t:string,i:number)=><li key={i}>{t}</li>)}</ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
