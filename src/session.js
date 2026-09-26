// Session/conversation state manager for multi-step flows
// Stores per-user conversation state in memory (resets on restart, which is acceptable for MVP)

const sessions = new Map();

function getSession(userId) {
  return sessions.get(userId) || null;
}

function setSession(userId, state) {
  sessions.set(userId, { ...state, startedAt: Date.now() });
}

function clearSession(userId) {
  sessions.delete(userId);
}

function updateSession(userId, partial) {
  const existing = sessions.get(userId) || {};
  sessions.set(userId, { ...existing, ...partial });
}

function isActive(userId) {
  return sessions.has(userId);
}

module.exports = {
  getSession,
  setSession,
  clearSession,
  updateSession,
  isActive,
};
