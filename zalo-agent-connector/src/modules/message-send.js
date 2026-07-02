export function initMessageSend(socket) {
  if (socket?.emit) {
    socket.emit('agent:init-message-send', { ready: true });
  }
}
