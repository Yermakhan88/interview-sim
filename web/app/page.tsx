'use client';

import React, { useEffect, useRef, useState } from 'react';

// ==== Types ====

type UiLang = 'kz' | 'ru' | 'en';
type SttLang = 'kk' | 'ru' | 'en';

type Metrics = {
  wpm: number;
  fillerCount: number;
  tips?: string[];
};

type Aspect = { score: number; comment: string };

type SoftSkills = {
  communication: Aspect;
  structure: Aspect;
  confidence: Aspect;
  relevance: Aspect;
  conciseness: Aspect;
};

type AiFeedback = {
  overallScore: number;
  level: string;
  aspects: {
    communication: Aspect;
    structure: Aspect;
    confidence: Aspect;
    relevance: Aspect;
    conciseness: Aspect;
  };
  strengths: string[];
  improvements: string[];
  outline: string;
};

type AnalyzeResponse = {
  text?: string;
  languageCode?: string;
  metrics?: Metrics;
  softSkills?: SoftSkills;
  aiFeedback?: AiFeedback | null;
  took_ms?: number;
};

type HistoryItem = {
  time: string;
  uiLang: UiLang;
  sttLang: SttLang;
  question: string;
  json: AnalyzeResponse;
};

const STORAGE_KEY = 'interview-sim-sessions-v1';

const API_URL =
  (process.env.NEXT_PUBLIC_API_URL as string | undefined) ||
  'http://localhost:3000';

// ==== UI мәтіндері (3 тіл) ====

const UI_TEXT = {
  kz: {
    title: 'Сұхбат симуляторы 🎙️',
    uiLang: 'UI language',
    sttLang: 'Speech STT lang',
    question: 'Сұрақ',
    next: 'Келесі сұрақ',
    start: 'Бастау',
    stop: 'Тоқтату',
    status: 'Қалып-күйі',
    idle: 'бос',
    recording: 'жазылуда…',
    uploading: 'жүктелуде…',
    done: 'дайын',
    error: 'қате',
    transcript: 'Расшифровка',
    metrics: 'Сөйлеу метрикалары',
    wpm: 'Сөз/мин',
    fillers: 'Толтырма сөздер',
    soft: 'Soft skills (эвристика + AI)',
    history: 'Сессия тарихы',
    historyEmpty: 'Әзірге сақталған сессия жоқ.',
    debug: 'Debug JSON',
    clearHistory: 'Тарихты тазалау',
  },
  ru: {
    title: 'Симулятор собеседования 🎙️',
    uiLang: 'UI language',
    sttLang: 'Speech STT lang',
    question: 'Вопрос',
    next: 'Следующий вопрос',
    start: 'Начать',
    stop: 'Остановить',
    status: 'Статус',
    idle: 'готов',
    recording: 'записывается…',
    uploading: 'отправка…',
    done: 'готово',
    error: 'ошибка',
    transcript: 'Расшифровка',
    metrics: 'Метрики речи',
    wpm: 'Слов/мин',
    fillers: 'Слова-паразиты',
    soft: 'Soft skills (эвристика + ИИ)',
    history: 'История сессий',
    historyEmpty: 'Пока нет сессий.',
    debug: 'Debug JSON',
    clearHistory: 'Очистить историю',
  },
  en: {
    title: 'Interview simulator 🎙️',
    uiLang: 'UI language',
    sttLang: 'Speech STT lang',
    question: 'Question',
    next: 'Next question',
    start: 'Start',
    stop: 'Stop',
    status: 'Status',
    idle: 'idle',
    recording: 'recording…',
    uploading: 'uploading…',
    done: 'done',
    error: 'error',
    transcript: 'Transcript',
    metrics: 'Speech metrics',
    wpm: 'Words/min',
    fillers: 'Filler words',
    soft: 'Soft skills (heuristic + AI)',
    history: 'Session history',
    historyEmpty: 'No sessions yet.',
    debug: 'Debug JSON',
    clearHistory: 'Clear history',
  },
} as const;

// ==== Сұрақтар банкі ====

const QUESTIONS: Record<UiLang, string[]> = {
  kz: [
    'Өзіңіз туралы қысқаша айтып беріңіз.',
    'Неге осы мамандықты таңдадыңыз?',
    'Жақсы мұғалім қандай болуы керек?',
  ],
  ru: [
    'Расскажите кратко о себе.',
    'Почему вы выбрали эту специальность?',
    'Каким должен быть хороший преподаватель?',
  ],
  en: [
    'Tell me briefly about yourself.',
    'Why did you choose this major?',
    'What makes a good teacher?',
  ],
};

export default function Page() {
  const [uiLang, setUiLang] = useState<UiLang>('kz');
  const [sttLang, setSttLang] = useState<SttLang>('kk');
  const [question, setQuestion] = useState<string>(QUESTIONS.kz[0]);

  const [status, setStatus] = useState<
    'idle' | 'recording' | 'uploading' | 'done' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<AnalyzeResponse | null>(null);
  const [sessions, setSessions] = useState<HistoryItem[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const t = UI_TEXT[uiLang];

  // UI тілі өзгергенде – сұрақты ауыстыру
  useEffect(() => {
    const arr = QUESTIONS[uiLang];
    setQuestion(arr[0]);
  }, [uiLang]);

  // localStorage-тен тарихты жүктеу
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSessions(JSON.parse(raw) as HistoryItem[]);
    } catch {
      // ignore
    }
  }, []);

  // history өзгерген сайын сақтау
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      // ignore
    }
  }, [sessions]);

  // === Жазуды бастау ===
  const handleStart = async () => {
    setError(null);
    setOut(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        setStatus('uploading');

        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          chunksRef.current = [];

          const fd = new FormData();
          fd.append('audio', blob, 'clip.webm');
          fd.append('lang', sttLang);
          fd.append('question', question);

          const r = await fetch(`${API_URL}/api/analyze`, {
            method: 'POST',
            body: fd,
          });

          if (!r.ok) {
            let detail = '';
            try {
              const j = await r.json();
              detail = JSON.stringify(j);
            } catch {
              // ignore
            }
            setStatus('error');
            setError(`API ${r.status}: ${detail}`);
            return;
          }

          const j = (await r.json()) as AnalyzeResponse;
          setOut(j);
          setStatus('done');

          const item: HistoryItem = {
            time: new Date().toLocaleString(),
            uiLang,
            sttLang,
            question,
            json: j,
          };

          setSessions((prev) => [item, ...prev]);
        } catch (e: any) {
          setStatus('error');
          setError(e?.message || String(e));
        }
      };

      mediaRef.current = rec;
      rec.start();
      setStatus('recording');
    } catch (e: any) {
      setStatus('error');
      setError(e?.message || String(e));
    }
  };

  // === Жазуды тоқтату ===
  const handleStop = () => {
    const rec = mediaRef.current;
    if (rec && rec.state === 'recording') {
      rec.stop();
      (rec.stream.getTracks() || []).forEach((tr) => tr.stop());
    }
  };

  const statusLabel =
    status === 'idle'
      ? t.idle
      : status === 'recording'
      ? t.recording
      : status === 'uploading'
      ? t.uploading
      : status === 'done'
      ? t.done
      : t.error;

  // ==== РЕНДЕР ====

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#fafafa',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 24,
          }}
        >
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>
            {t.title}
          </h1>

          <div style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <div>UI language</div>
              <select
                value={uiLang}
                onChange={(e) => setUiLang(e.target.value as UiLang)}
              >
                <option value="kz">KZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </div>
            <div>
              <div>Speech STT lang</div>
              <select
                value={sttLang}
                onChange={(e) => setSttLang(e.target.value as SttLang)}
              >
                <option value="kk">kk-KZ</option>
                <option value="ru">ru-RU</option>
                <option value="en">en-US</option>
              </select>
            </div>
          </div>
        </div>

        {/* QUESTION BLOCK – дәл скриндегі сияқты */}
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 10,
            padding: 16,
            background: '#fff',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.question}</div>
          <div style={{ marginBottom: 8 }}>{question}</div>
          <button
            type="button"
            onClick={() => {
              const arr = QUESTIONS[uiLang];
              const next = arr[Math.floor(Math.random() * arr.length)];
              setQuestion(next);
            }}
          >
            {t.next}
          </button>
        </div>

        {/* CONTROLS */}
        <div style={{ marginBottom: 8 }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={status === 'recording' || status === 'uploading'}
            style={{ marginRight: 8 }}
          >
            {t.start}
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={status !== 'recording'}
          >
            {t.stop}
          </button>
        </div>

        <div style={{ marginBottom: 16, fontSize: 14 }}>
          {t.status}: {statusLabel}
        </div>

        {error && (
          <div
            style={{
              color: '#b91c1c',
              fontSize: 12,
              marginBottom: 16,
              whiteSpace: 'pre-wrap',
            }}
          >
            {String(error)}
          </div>
        )}

        {/* OUTPUT: Transcript + metrics + soft skills */}
        {out && (
          <div
            style={{
              border: '1px solid #ddd',
              borderRadius: 10,
              padding: 16,
              background: '#fff',
              marginBottom: 24,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {t.transcript}
            </div>
            <div
              style={{
                border: '1px solid #eee',
                padding: 8,
                borderRadius: 4,
                minHeight: 40,
                fontSize: 14,
                background: '#fafafa',
                marginBottom: 12,
              }}
            >
              {out.text || '—'}
            </div>

            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {t.metrics}
            </div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              {t.wpm}: <b>{out.metrics?.wpm ?? '—'}</b> · {t.fillers}:{' '}
              <b>{out.metrics?.fillerCount ?? '—'}</b>
            </div>

            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t.soft}</div>
            <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {out.softSkills && (
                <div style={{ marginBottom: 8 }}>
                  <b>Heuristic:</b>{' '}
                  {JSON.stringify(out.softSkills, null, 2)}
                </div>
              )}
              {out.aiFeedback && (
                <div>
                  <b>AI:</b> {JSON.stringify(out.aiFeedback, null, 2)}
                </div>
              )}
              {!out.softSkills && !out.aiFeedback && '—'}
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer' }}>
                {t.debug}
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  background: '#f5f5f5',
                  padding: 8,
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  marginTop: 8,
                }}
              >
                {JSON.stringify(out, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* HISTORY */}
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 10,
            padding: 16,
            background: '#fff',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 600 }}>{t.history}</div>
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={() => setSessions([])}
                style={{
                  fontSize: 11,
                  color: '#b91c1c',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                {t.clearHistory}
              </button>
            )}
          </div>

          {sessions.length === 0 && (
            <div style={{ fontSize: 12, color: '#888' }}>
              {t.historyEmpty}
            </div>
          )}

          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              fontSize: 12,
            }}
          >
            {sessions.map((s, idx) => (
              <div
                key={idx}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  background: '#f8fafc',
                  marginBottom: 6,
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.time}</div>
                <div>
                  UI: {s.uiLang} · STT: {s.sttLang}
                </div>
                <div>Q: {s.question}</div>
                {s.json.text && (
                  <div>
                    T:{' '}
                    {s.json.text.length > 80
                      ? s.json.text.slice(0, 80) + '…'
                      : s.json.text}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Debug toggle (жалпы out емес, тек флаг) */}
        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          style={{
            fontSize: 11,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            textDecoration: 'underline',
            color: '#555',
          }}
        >
          {showDebug ? 'Hide debug info' : 'Show debug info'}
        </button>
        {showDebug && (
          <pre
            style={{
              fontSize: 11,
              background: '#f5f5f5',
              padding: 8,
              borderRadius: 4,
              marginTop: 8,
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify({ sessionsCount: sessions.length, last: sessions[0] }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}