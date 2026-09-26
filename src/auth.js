// Access control and session management
const queries = require('./queries');

async function getUserRole(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return null;
  const user = await queries.getUser(userId);
  return user;
}

function isTenant(user) {
  return user && user.role === 'tenant' && user.is_active;
}

function isAdmin(user) {
  return user && (user.role === 'admin' || user.role === 'super_admin');
}

function isSuperAdmin(user) {
  return user && user.role === 'super_admin';
}

function isTenantAccessValid(user) {
  if (!user) return false;
  if (user.role !== 'tenant') return true;
  return !!user.is_active;
}

async function checkSubscriptionActive(adminUserId) {
  const sub = await queries.getSubscription(adminUserId);
  return queries.isSubscriptionActive(sub);
}

module.exports = {
  getUserRole,
  isTenant,
  isAdmin,
  isSuperAdmin,
  isTenantAccessValid,
  checkSubscriptionActive,
};
