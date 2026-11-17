const el = id => document.getElementById(id);
let stageSequence = 0;
let currentMediaUrl = null;
let latestMediaStage = null;
function showOnly(id) {
  for (const name of ['slide', 'idle', 'hold', 'qr-screen', 'media-screen']) el(name).hidden = name !== id;
}
function syncVideo() {
  const stage = latestMediaStage;
  const video = el('audience-video');
  if (!stage || stage.kind !== 'video' || video.readyState < 1) return;
  if (Math.abs(video.currentTime - stage.time) > 0.7) video.currentTime = stage.time;
  if (stage.playing && video.paused) void video.play().catch(() => {});
  if (!stage.playing && !video.paused) video.pause();
}
el('audience-video').addEventListener('loadedmetadata', syncVideo);
window.presentation.onStage(stage => {
  const seq = ++stageSequence;
  if (stage.mode === 'media' && stage.url) {
    latestMediaStage = stage;
    const video = el('audience-video');
    if (currentMediaUrl !== stage.url) {
      video.pause();
      currentMediaUrl = stage.url;
      video.src = stage.url;
      video.load();
    }
    syncVideo();
    showOnly('media-screen');
    return;
  }
  latestMediaStage = null;
  el('audience-video').pause();
  if (stage.mode === 'slide' && stage.image) {
    const image = new Image();
    image.onload = () => {
      if (seq !== stageSequence) return;
      el('slide').src = image.src;
      showOnly('slide');
    };
    image.onerror = () => { if (seq === stageSequence) showOnly('idle'); };
    image.src = stage.image;
  } else if (stage.mode === 'placeholder') {
    el('hold').style.backgroundColor = stage.color || '#334b73';
    el('hold').style.backgroundImage = stage.backdrop ? `url("${stage.backdrop}")` : 'none';
    el('hold-text').textContent = stage.text || '';
    showOnly('hold');
  } else if (stage.mode === 'qr' && stage.qr) {
    el('qr-image').src = stage.qr;
    el('qr-label').textContent = stage.label || 'Материалы выступления';
    showOnly('qr-screen');
  } else showOnly('idle');
});
