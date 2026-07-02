export function initMaintenance(socket) {
  if (socket?.emit) {
    socket.emit('agent:init-maintenance', { ready: true });
  }
}
