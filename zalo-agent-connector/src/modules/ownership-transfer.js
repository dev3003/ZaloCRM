export function initOwnershipTransfer(socket, fingerprint) {
  if (socket?.emit) {
    socket.emit('agent:init-ownership-transfer', { fingerprint });
  }
}
