export function analyzeTranscript(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const fillerList = ['ээ','ну','как бы','типа','uh','um','like','you know','ғой','яғни'];
  const fillerCount = fillerList.reduce((n, f) => n + (text.toLowerCase().includes(f) ? 1 : 0), 0);
  // Демода 1 минут деп аламыз; кейін нақты ұзақтықпен ауыстыр
  const wpm = Math.max(40, Math.min(200, Math.round(words / 1)));
  const tips: string[] = [];
  if (wpm > 170) tips.push('Қарқыныңызды сәл баяулатыңыз (130–150 wpm).');
  if (wpm < 100) tips.push('Қарқыныңызды арттырыңыз (120–150 wpm).');
  if (fillerCount > 3) tips.push('Артық сөздерді азайтыңыз (\"ээ\", \"like\").');
  if (!tips.length) tips.push('Қарқыныңыз бен анықтығыңыз жақсы!');
  return { words, wpm, fillerCount, tips };
}
