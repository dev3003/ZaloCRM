import dotenv from 'dotenv';
import { io } from 'socket.io-client';

import { getFingerprint } from './src/modules/fingerprint.js';
import { authenticate } from './src/modules/auth.js';
import { registerAgent } from './src/modules/agent-registry.js';
import { startHeartbeat, stopHeartbeat } from './src/modules/heartbeat.js';
import { initZaloConnection } from './src/modules/zalo-connection.js';
import { initMessageSend } from './src/modules/message-send.js';
import { initMessageReceive } from './src/modules/message-receive.js';
import { initOwnershipTransfer } from './src/modules/ownership-transfer.js';
import { initMaintenance } from './src/modules/maintenance.js';
import { startAutoUpdate } from './src/modules/auto-update.js';

dotenv.config();

let heartbeatHandle = null;
let socket = null;
let jwtToken = null;

function logInfo(message) {
  console.info(`[agent] ${message}`);
}

function logWarn(message) {
  console.warn(`[agent] ${message}`);
}

function logError(message) {
  console.error(`[agent] ${message}`);
}

function cleanup() {
  if (heartbeatHandle) {
    stopHeartbeat(heartbeatHandle);
    heartbeatHandle = null;
  }

  if (socket) {
    try {
      socket.disconnect();
    } catch (error) {
      logError(`Failed to disconnect socket: ${error instanceof Error ? error.message : String(error)}`);
    }
    socket = null;
  }
}

async function main() {
  const fingerprint = getFingerprint();
  const fingerprintPrefix = fingerprint.slice(0, 8);

  logInfo(`Agent starting, fingerprint=${fingerprintPrefix}...`);

  try {
    jwtToken = await authenticate(fingerprint);
  } catch (error) {
    const status = error?.status || error?.response?.status;
    if (status === 401 || status === 403) {
      logError(`Authentication failed (${status}): ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }

    logError(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
  const agentKey = process.env.AGENT_KEY || 'demo-agent-key';

  socket = io(`${serverUrl.replace(/\/+$/, '')}/desktop-agent`, {
    auth: {
      agentKey,
      fingerprint,
      jwt: jwtToken,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.on('connect', () => {
    logInfo('Socket connected');
    registerAgent(socket, fingerprint);
    heartbeatHandle = startHeartbeat(socket, fingerprint);
    initZaloConnection(socket, fingerprint);
    initMessageSend(socket);
    initMessageReceive(socket);
    initOwnershipTransfer(socket, fingerprint);
    initMaintenance(socket);
    logInfo('Agent fully connected and ready');
  });

  socket.on('disconnect', () => {
    logWarn('Socket disconnected, reconnecting...');
    if (heartbeatHandle) {
      stopHeartbeat(heartbeatHandle);
      heartbeatHandle = null;
    }
  });

  socket.on('connect_error', (error) => {
    logError(`Socket connection error: ${error?.message || String(error)}`);
  });

  startAutoUpdate(fingerprint);
}

process.on('SIGINT', () => {
  logInfo('Agent shutting down');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logInfo('Agent shutting down');
  cleanup();
  process.exit(0);
});

main().catch((error) => {
  logError(`Startup failed: ${error instanceof Error ? error.message : String(error)}`);
  cleanup();
  process.exit(1);
});
