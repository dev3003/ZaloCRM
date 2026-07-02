export function initZaloConnection(socket, fingerprint) {
  if (socket?.emit) {
    socket.emit('agent:init-zalo', { fingerprint });
  }
}
