export function registerAgent(socket, fingerprint) {
  if (socket?.emit) {
    socket.emit('agent:register', { fingerprint });
  }
}
