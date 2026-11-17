const token = new URL(location.href).searchParams.get('token');
const status = document.getElementById('status');
let socket;
function connect() {
  socket = new WebSocket(`ws://${location.host}/control?token=${encodeURIComponent(token || '')}`);
  socket.onopen = () => { status.textContent = 'Подключено'; status.style.color = '#8acdbf'; };
  socket.onclose = () => { status.textContent = 'Нет связи'; status.style.color = '#edb6a8'; setTimeout(connect, 2000); };
}
connect();
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ action: button.dataset.action }));
}));
