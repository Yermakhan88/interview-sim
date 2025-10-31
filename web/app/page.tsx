'use client';
import React, { useEffect, useState } from 'react';

export default function Page() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [out, setOut] = useState<any>(null);
  const [status, setStatus] = useState<'idle'|'recording'|'uploading'|'done'>('idle');

  useEffect(() => {
    (async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(s);
      mr.ondataavailable = (e) => setChunks((x) => [...x, e.data]);
      setRec(mr);
    })().catch((e) => alert('Microphone permission needed: ' + e));
  }, []);

  const start = () => { setChunks([]); rec?.start(); setStatus('recording'); };

  const stop = () => {
    if (!rec) return;
    rec.onstop = async () => {
      try {
        setStatus('uploading');
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', blob, 'clip.webm');

        // Прокси роутқа жібереміз — CORS жоқ
        const r = await fetch('/api/analyze', { method: 'POST', body: fd });
        const txt = await r.text();
        let j:any; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }

        if (!r.ok) { alert(`Қате: ${r.status}\n${(typeof j==='string'?j:JSON.stringify(j)).slice(0,500)}`); setStatus('idle'); return; }
        setOut(j); setStatus('done');
      } catch (e:any) { alert('Жіберу қатесі: '+(e?.message||e)); setStatus('idle'); }
    };
    rec.stop();
  };

  return (
    <main style={{ padding:24, maxWidth:900, margin:'0 auto', fontFamily:'system-ui' }}>
      <h1>Interview Simulator 🎙️</h1>
      <div style={{ display:'flex', gap:8, margin:'12px 0' }}>
        <button onClick={start} disabled={!rec || status==='recording'}>Start</button>
        <button onClick={stop} disabled={!rec || status!=='recording'}>Stop</button>
      </div>
      <p>Status: {status}</p>
      {out && (
        <section style={{ marginTop:16 }}>
          <p><b>Transcript:</b> {out.text ?? out.raw}</p>
          {out.metrics && (<>
            <p>WPM: {out.metrics.wpm} | Fillers: {out.metrics.fillerCount}</p>
            <ul>{out.metrics.tips.map((t:string,i:number)=><li key={i}>{t}</li>)}</ul>
          </>)}
        </section>
      )}
    </main>
  );
}
