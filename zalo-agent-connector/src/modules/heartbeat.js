export function startHeartbeat(socket, fingerprint) {
  const interval = setInterval(() => {
    if (socket?.connected) {
      socket.emit('agent:heartbeat', { fingerprint, timestamp: new Date().toISOString() });
    }
  }, 30000);

  return { interval, stop() { clearInterval(interval); } };
}

export function stopHeartbeat(handle) {
  if (handle?.stop) {
    handle.stop();
  } else if (handle?.interval) {
    clearInterval(handle.interval);
  }
}
