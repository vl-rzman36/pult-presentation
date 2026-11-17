export function createMusicController({ bridge, $, setMessage, isVideoPlaying }) {
  const storageKey = 'pult.music.state.v1';
  const player = $('music-player');
  const audioExtensions = new Set(['.mp3', '.m4a', '.wav', '.ogg']);
  let playlists = [];
  let selectedPlaylistId = null;
  let current = null;
  let resumeAfterVideo = false;
  let lastPositionSave = 0;
  let draggedTrackId = null;
  let playMode = 'playlist-loop';
  let loading = false;

  function selectedPlaylist() { return playlists.find(item => item.id === selectedPlaylistId) || null; }
  function currentPlaylist() { return playlists.find(item => item.id === current?.playlistId) || null; }
  function currentTrack() { return currentPlaylist()?.tracks.find(item => item.id === current?.trackId) || null; }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
  function persist() {
    if(loading)return;
    localStorage.setItem(storageKey, JSON.stringify({
      playlists: playlists.map(list => ({ id: list.id, name: list.name, tracks: list.tracks.map(track => ({ id: track.id, path: track.path, name:track.name })) })),
      selectedPlaylistId, current, position: Number.isFinite(player.currentTime) ? player.currentTime : 0, volume: player.volume, playMode,
    }));
    window.dispatchEvent(new Event('pult-music-changed'));
  }
  function updatePlayer() {
    const track = currentTrack();
    $('music-now-title').textContent = track?.name || 'Выберите трек';
    $('quick-music-title').textContent = track?.name || 'Фоновая музыка';
    $('quick-music-state').textContent = resumeAfterVideo ? 'Пауза на время видео' : track ? (player.paused ? 'На паузе' : 'Играет в фоне') : 'Выберите трек во вкладке «Музыка»';
    $('quick-music-play').textContent = player.paused ? '▶' : 'Ⅱ';
    $('quick-music-play').setAttribute('aria-label', player.paused ? 'Воспроизвести музыку' : 'Приостановить музыку');
    $('music-play').textContent = player.paused ? '▶' : 'Ⅱ';
    $('music-play').setAttribute('aria-label', player.paused ? 'Воспроизвести' : 'Пауза');
    $('music-current-time').textContent = formatTime(player.currentTime);
    $('music-duration').textContent = formatTime(player.duration);
    $('music-progress').disabled = !track || !Number.isFinite(player.duration) || player.duration <= 0;
    $('music-progress').max = Number.isFinite(player.duration) ? String(player.duration) : '100';
    $('music-progress').value = String(Math.min(player.currentTime || 0, Number($('music-progress').max)));
    $('music-tab').classList.toggle('music-playing', !player.paused);
    for (const row of $('music-track-list').children) row.classList.toggle('playing', row.dataset.id === current?.trackId && selectedPlaylistId === current?.playlistId);
  }
  function drawPlaylists() {
    const select = $('music-playlist-select');
    select.replaceChildren();
    for (const list of playlists) {
      const option = document.createElement('option');
      option.value = list.id; option.textContent = list.name;
      select.append(option);
    }
    select.value = selectedPlaylistId || '';
    $('music-delete-playlist').disabled = playlists.length <= 1;
  }
  function drawTracks() {
    const container = $('music-track-list');
    container.replaceChildren();
    const list = selectedPlaylist();
    if (!list?.tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'music-track-empty'; empty.textContent = 'Добавьте аудиофайлы в этот плейлист';
      container.append(empty); return;
    }
    list.tracks.forEach((track, index) => {
      const row = document.createElement('div'); row.className = 'music-track-row'; row.dataset.id = track.id;
      const handle = document.createElement('span'); handle.className = 'track-handle'; handle.textContent = '⋮⋮'; handle.title = 'Зажмите и перетащите трек';
      handle.draggable = true; handle.tabIndex = 0; handle.setAttribute('aria-label', `Переместить ${track.name}`);
      handle.addEventListener('dragstart', event => {
        draggedTrackId = track.id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.id);
        row.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => {
        draggedTrackId = null;
        for (const item of container.children) item.classList.remove('dragging', 'drop-before', 'drop-after');
      });
      handle.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); moveTrack(list, index, event.key === 'ArrowUp' ? -1 : 1);
      });
      row.addEventListener('dragover', event => {
        if (!draggedTrackId || draggedTrackId === track.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.toggle('drop-before', event.clientY < row.getBoundingClientRect().top + row.clientHeight / 2);
        row.classList.toggle('drop-after', !row.classList.contains('drop-before'));
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
      row.addEventListener('drop', event => {
        event.preventDefault();
        const source = list.tracks.findIndex(item => item.id === draggedTrackId);
        let target = list.tracks.findIndex(item => item.id === track.id);
        if (source < 0 || target < 0 || source === target) return;
        const after = event.clientY >= row.getBoundingClientRect().top + row.clientHeight / 2;
        const [moved] = list.tracks.splice(source, 1);
        if (source < target) target--;
        list.tracks.splice(target + (after ? 1 : 0), 0, moved);
        draggedTrackId = null;
        persist(); drawTracks();
      });
      const main = document.createElement('button'); main.type = 'button'; main.className = 'control-surface track-main'; main.textContent = `${index + 1}. ${track.name}${track.missing ? ' · не найден' : ''}`;
      main.title = `Воспроизвести ${track.name}`;
      main.addEventListener('click', () => chooseTrack(list.id, track.id, true));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'track-tool btn btn--icon btn--compact btn--ghost btn--danger'; remove.textContent = '×'; remove.title = `Убрать ${track.name} из плейлиста`;
      remove.addEventListener('click', () => removeTrack(list, track));
      row.append(handle, main, remove); container.append(row);
    });
    updatePlayer();
  }
  function draw() { drawPlaylists(); drawTracks(); updatePlayer(); }

  function chooseTrack(playlistId, trackId, play = false, position = 0) {
    const list = playlists.find(item => item.id === playlistId);
    const track = list?.tracks.find(item => item.id === trackId);
    if (!track) return;
    if(track.missing){setMessage('Аудиофайл не найден. Добавьте его заново или удалите из плейлиста.');return;}
    if (current?.playlistId !== playlistId || current?.trackId !== trackId) {
      player.pause();
      current = { playlistId, trackId };
      player.src = track.url;
      player.load();
      if (position > 0) player.addEventListener('loadedmetadata', () => {
        if (current?.trackId === trackId) player.currentTime = Math.min(position, Number.isFinite(player.duration) ? Math.max(0, player.duration - 0.1) : position);
      }, { once: true });
    } else if (position > 0 && Number.isFinite(player.duration)) player.currentTime = position;
    if (play) void player.play().catch(() => setMessage(`Не удалось воспроизвести ${track.name}`));
    persist(); drawTracks(); updatePlayer();
  }
  function stepTrack(direction) {
    const list = currentPlaylist() || selectedPlaylist();
    if (!list?.tracks.length) return;
    const index = list.tracks.findIndex(item => item.id === current?.trackId);
    const next = index < 0 ? 0 : (index + direction + list.tracks.length) % list.tracks.length;
    chooseTrack(list.id, list.tracks[next].id, true);
  }
  function advanceOnEnd() {
    const list = currentPlaylist();
    const index = list?.tracks.findIndex(item => item.id === current?.trackId) ?? -1;
    if (!list || index < 0) return;
    if (playMode === 'track-once' || (playMode === 'playlist-once' && index === list.tracks.length - 1)) {
      updatePlayer(); persist(); return;
    }
    if (playMode === 'track-loop') {
      player.currentTime = 0;
      void player.play().catch(() => {});
      return;
    }
    if (playMode === 'shuffle') {
      if (list.tracks.length === 1) { player.currentTime = 0; void player.play().catch(() => {}); return; }
      const offset = list.tracks.length > 1 ? 1 + Math.floor(Math.random() * (list.tracks.length - 1)) : 0;
      chooseTrack(list.id, list.tracks[(index + offset) % list.tracks.length].id, true);
      return;
    }
    stepTrack(1);
  }
  function moveTrack(list, index, direction) {
    const other = index + direction;
    if (other < 0 || other >= list.tracks.length) return;
    [list.tracks[index], list.tracks[other]] = [list.tracks[other], list.tracks[index]];
    persist(); drawTracks();
  }
  function removeTrack(list, track) {
    if (current?.playlistId === list.id && current?.trackId === track.id) {
      player.pause(); player.removeAttribute('src'); player.load(); current = null;
    }
    list.tracks = list.tracks.filter(item => item.id !== track.id);
    void bridge.releaseMedia(track.url);
    persist(); drawTracks(); updatePlayer();
  }
  async function addPaths(paths, { silent = false } = {}) {
    const list = selectedPlaylist();
    if (!list) return;
    let added = 0;
    for (const filePath of paths) {
      const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
      if (!audioExtensions.has(extension) || list.tracks.some(track => track.path === filePath)) continue;
      try {
        const file = await bridge.readFile(filePath);
        if (!file.mediaUrl) continue;
        list.tracks.push({ id: crypto.randomUUID(), path: filePath, name: file.name, url: file.mediaUrl });
        added++;
      } catch (error) { if (!silent) setMessage(`Не удалось добавить ${filePath}: ${error.message}`); }
    }
    persist(); drawTracks();
    if (added && !silent) setMessage(`Добавлено треков: ${added}`);
  }
  async function restore(state) {
    loading=true;resumeAfterVideo=false;player.pause();player.removeAttribute('src');player.load();current=null;
    for(const list of playlists)for(const track of list.tracks)if(track.url)void bridge.releaseMedia(track.url);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { /* Start with an empty library. */ }
    if(state)saved=state;
    playlists = Array.isArray(saved.playlists) ? saved.playlists.map(item => ({ id: item.id, name: item.name, tracks: [] })) : [];
    if (!playlists.length) playlists = [{ id: crypto.randomUUID(), name: 'Моя музыка', tracks: [] }];
    selectedPlaylistId = playlists.some(item => item.id === saved.selectedPlaylistId) ? saved.selectedPlaylistId : playlists[0].id;
    playMode = ['playlist-loop', 'playlist-once', 'track-once', 'track-loop', 'shuffle'].includes(saved.playMode) ? saved.playMode : 'playlist-loop';
    $('music-play-mode').value = playMode;
    player.volume = Number.isFinite(saved.volume) ? Math.max(0, Math.min(1, saved.volume)) : 0.7;
    $('music-volume').value = String(Math.round(player.volume * 100));
    for (const list of playlists) {
      const oldList = saved.playlists?.find(item => item.id === list.id);
      for (const item of oldList?.tracks || []) {
        try {
          const file = await bridge.readFile(item.path);
          if (file.mediaUrl && audioExtensions.has(file.type)) list.tracks.push({ id: item.id || crypto.randomUUID(), path: item.path, name: item.name || file.name, url: file.mediaUrl });
        } catch { list.tracks.push({id:item.id||crypto.randomUUID(),path:item.path,name:item.name||item.path.split(/[\\/]/).pop(),url:null,missing:true}); }
      }
    }
    if (saved.current && playlists.some(list => list.id === saved.current.playlistId && list.tracks.some(track => track.id === saved.current.trackId))) {
      chooseTrack(saved.current.playlistId, saved.current.trackId, false, Number(saved.position) || 0);
    }
    loading=false; persist(); draw();
  }
  function pauseForVideo() {
    if (!player.paused) { resumeAfterVideo = true; player.pause(); }
  }
  function resumeFromVideo() {
    if (!resumeAfterVideo || isVideoPlaying()) return;
    resumeAfterVideo = false;
    if (currentTrack()) void player.play().catch(() => {});
  }

  $('music-playlist-select').addEventListener('change', event => { selectedPlaylistId = event.target.value; persist(); drawTracks(); });
  $('music-add-tracks').addEventListener('click', async () => addPaths(await bridge.openAudioFiles()));
  $('music-create-playlist').addEventListener('click', () => {
    const name = $('music-playlist-name').value.trim();
    if (!name) { setMessage('Введите название плейлиста'); return; }
    const list = { id: crypto.randomUUID(), name, tracks: [] };
    playlists.push(list); selectedPlaylistId = list.id; $('music-playlist-name').value = '';
    persist(); draw();
  });
  $('music-rename-playlist').addEventListener('click', () => {
    const name = $('music-playlist-name').value.trim();
    if (!name) { setMessage('Введите новое название плейлиста'); return; }
    selectedPlaylist().name = name; $('music-playlist-name').value = '';
    persist(); drawPlaylists();
  });
  $('music-delete-playlist').addEventListener('click', () => {
    if (playlists.length <= 1) return;
    const list = selectedPlaylist();
    if (current?.playlistId === list.id) { player.pause(); player.removeAttribute('src'); player.load(); current = null; }
    for (const track of list.tracks) void bridge.releaseMedia(track.url);
    playlists = playlists.filter(item => item.id !== list.id);
    selectedPlaylistId = playlists[0].id;
    persist(); draw();
  });
  $('quick-music-open').addEventListener('click', () => $('music-tab').click());
  $('quick-music-play').addEventListener('click', () => $('music-play').click());
  $('quick-music-next').addEventListener('click', () => $('music-next').click());
  $('music-play').addEventListener('click', () => {
    if (resumeAfterVideo) { resumeAfterVideo = false; updatePlayer(); return; }
    if (!currentTrack()) { const list = selectedPlaylist(); if (list?.tracks.length) chooseTrack(list.id, list.tracks[0].id, true); return; }
    if (player.paused) void player.play().catch(() => setMessage('Не удалось начать воспроизведение'));
    else player.pause();
  });
  $('music-prev').addEventListener('click', () => { if (player.currentTime > 3) player.currentTime = 0; else stepTrack(-1); });
  $('music-next').addEventListener('click', () => stepTrack(1));
  $('music-progress').addEventListener('input', event => { if (Number.isFinite(player.duration)) player.currentTime = Number(event.target.value); });
  $('music-volume').addEventListener('input', event => { player.volume = Number(event.target.value) / 100; persist(); });
  $('music-play-mode').addEventListener('change', event => { playMode = event.target.value; persist(); });
  player.addEventListener('loadedmetadata', updatePlayer);
  player.addEventListener('play', () => { if (isVideoPlaying()) { resumeAfterVideo = true; player.pause(); return; } updatePlayer(); persist(); });
  player.addEventListener('pause', () => { updatePlayer(); persist(); });
  player.addEventListener('timeupdate', () => { updatePlayer(); if (Date.now() - lastPositionSave > 4000) { lastPositionSave = Date.now(); persist(); } });
  player.addEventListener('durationchange', updatePlayer);
  player.addEventListener('ended', advanceOnEnd);
  player.addEventListener('error', () => { if (currentTrack()) setMessage('Не удалось воспроизвести трек. Попробуйте MP3 или WAV.'); });

  return { restore, addPaths, pauseForVideo, resumeFromVideo, stop(){resumeAfterVideo=false;player.pause();} };
}
