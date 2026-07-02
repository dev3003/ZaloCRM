export function initMessageReceive(socket) {
  if (socket?.emit) {
    socket.emit('agent:init-message-receive', { ready: true });
  }
}
