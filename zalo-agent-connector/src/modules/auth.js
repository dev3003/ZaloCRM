export async function authenticate(fingerprint) {
  const serverUrl = process.env.SERVER_URL || '';

  if (serverUrl.includes('localhost')) {
    return 'mock-jwt-token';
  }

  const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/agents/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentKey: process.env.AGENT_KEY || 'demo-agent-key',
      fingerprint,
    }),
  });

  if (!response.ok) {
    const error = new Error(`Authentication failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return data.jwt || data.token || 'mock-jwt-token';
}
