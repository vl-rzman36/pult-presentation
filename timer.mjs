export function createTimer($) {
  let runningAt = null;
  let accumulated = 0;
  let limit = Math.max(0, Math.min(999, Number(localStorage.getItem('pult.timer.limit')) || 0));
  const elapsed = () => accumulated + (runningAt === null ? 0 : performance.now() - runningAt);
  const format = ms => { const seconds = Math.floor(Math.abs(ms) / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; };
  function draw() {
    const time = elapsed();
    const remaining = limit * 60000 - time;
    $('elapsed').textContent = limit ? `${remaining < 0 ? '+' : ''}${format(remaining)}` : format(time);
    $('timer-caption').textContent = limit ? remaining < 0 ? 'Лимит превышен' : 'Осталось' : runningAt === null ? 'Таймер · пауза' : 'Время выступления';
    $('timer-open').classList.toggle('overtime', limit > 0 && remaining < 0);
    $('timer-pause').textContent = runningAt === null ? 'Запустить' : 'Приостановить';
  }
  function start() { if (runningAt === null) runningAt = performance.now(); draw(); }
  function pause() { accumulated = elapsed(); runningAt = null; draw(); }
  $('timer-limit').value = limit;
  $('timer-open').addEventListener('click', () => $('timer-dialog').showModal());
  $('timer-limit').addEventListener('change', () => { limit = Math.max(0, Math.min(999, Number($('timer-limit').value) || 0)); $('timer-limit').value = limit; localStorage.setItem('pult.timer.limit', limit); draw(); });
  $('timer-pause').addEventListener('click', () => runningAt === null ? start() : pause());
  $('timer-reset').addEventListener('click', () => { accumulated = 0; runningAt = null; draw(); });
  setInterval(draw, 250); draw();
  return { start, pause, load(value){accumulated=0;runningAt=null;limit=Math.max(0,Math.min(999,Number(value)||0));$('timer-limit').value=limit;localStorage.setItem('pult.timer.limit',limit);draw();} };
}
