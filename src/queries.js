// Data access layer: all database queries via better-sqlite3
const { query, queryOne, queryAll, db } = require('./db');
const { prevMonthKey, monthKey, generateToken, parseDateInput } = require('./utils');

// ---- Users ----
async function getUser(userId) {
  return queryOne('SELECT * FROM users WHERE user_id = ?', [userId]);
}

async function createUser(userId, role, flatId = null) {
  return queryOne(
    `INSERT INTO users (user_id, role, flat_id, is_active)
     VALUES (?, ?, ?, 1) RETURNING *`,
    [userId, role, flatId]
  );
}

async function deactivateUser(userId) {
  await query('UPDATE users SET is_active = 0 WHERE user_id = ?', [userId]);
}

async function deleteUser(userId) {
  await query('DELETE FROM users WHERE user_id = ?', [userId]);
}

async function toggleUserActive(userId) {
  const user = await getUser(userId);
  if (!user) return null;
  const newActive = user.is_active ? 0 : 1;
  await query('UPDATE users SET is_active = ? WHERE user_id = ?', [newActive, userId]);
  return { ...user, is_active: newActive };
}

async function setSelectedFlat(userId, flatId) {
  await query('UPDATE users SET selected_flat_id = ? WHERE user_id = ?', [flatId, userId]);
}

async function listUsersForAdmin(adminUserId) {
  return queryAll(
    `SELECT u.user_id, u.role, u.flat_id, u.is_active
     FROM users u
     JOIN flats f ON u.flat_id = f.id
     WHERE f.admin_user_id = ? AND u.role = 'tenant'
     ORDER BY u.user_id`,
    [adminUserId]
  );
}

async function listAllUsers() {
  return queryAll('SELECT * FROM users ORDER BY created_at DESC');
}

// ---- Bot State ----
async function getBotState() {
  return queryOne('SELECT * FROM bot_state WHERE id = 1');
}

async function initBotState(setupKey) {
  const existing = await getBotState();
  if (existing) return existing;
  return queryOne(
    'INSERT INTO bot_state (id, setup_key, setup_complete) VALUES (1, ?, 0) RETURNING *',
    [setupKey]
  );
}

async function setSuperAdmin(userId) {
  await query(
    'UPDATE bot_state SET super_admin_user_id = ?, setup_complete = 1 WHERE id = 1',
    [userId]
  );
}

// ---- Flats ----
async function getFlat(flatId) {
  return queryOne('SELECT * FROM flats WHERE id = ?', [flatId]);
}

async function listFlatsForAdmin(adminUserId) {
  return queryAll('SELECT * FROM flats WHERE admin_user_id = ? ORDER BY id ASC', [adminUserId]);
}

async function countFlatsForAdmin(adminUserId) {
  const row = await queryOne('SELECT COUNT(*) AS count FROM flats WHERE admin_user_id = ?', [adminUserId]);
  return row ? row.count : 0;
}

async function createFlat(name, adminUserId, initialBalance = 0) {
  return queryOne(
    `INSERT INTO flats (name, admin_user_id, balance) VALUES (?, ?, ?) RETURNING *`,
    [name, adminUserId, initialBalance]
  );
}

async function deleteFlat(flatId) {
  await query('DELETE FROM flats WHERE id = ?', [flatId]);
}

async function setRent(flatId, enabled, amount = 0) {
  await query(
    'UPDATE flats SET rent_enabled = ?, rent_amount = ? WHERE id = ?',
    [enabled ? 1 : 0, amount, flatId]
  );
}

async function updateFlatBalance(flatId, delta) {
  await query('UPDATE flats SET balance = balance + ? WHERE id = ?', [delta, flatId]);
}

async function setFlatBalance(flatId, balance) {
  await query('UPDATE flats SET balance = ? WHERE id = ?', [balance, flatId]);
}

// ---- Tariffs ----
async function getCurrentTariff(flatId, date = new Date()) {
  const isoDate = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  return queryOne(
    `SELECT * FROM tariff_history
     WHERE flat_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [flatId, isoDate]
  );
}

async function getTariffForMonth(flatId, monthKeyStr) {
  const [m, y] = monthKeyStr.split('.').map(Number);
  const monthDate = new Date(y, m - 1, 1);
  const isoDate = monthDate.toISOString().split('T')[0];
  return queryOne(
    `SELECT * FROM tariff_history
     WHERE flat_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [flatId, isoDate]
  );
}

// Check if a tariff change exists within the given month
async function isIntervalMonth(flatId, monthKeyStr) {
  const [m, y] = monthKeyStr.split('.').map(Number);
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDayDate = new Date(y, m, 0);
  const lastDay = `${y}-${String(m).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`;
  const row = await queryOne(
    `SELECT COUNT(*) AS count FROM tariff_history
     WHERE flat_id = ? AND effective_from >= ? AND effective_from <= ?`,
    [flatId, firstDay, lastDay]
  );
  return row ? row.count > 0 : false;
}

async function createTariffRecord(flatId, tariffData, effectiveFrom) {
  return queryOne(
    `INSERT INTO tariff_history
     (flat_id, water, electricity_threshold1, electricity_tariff1,
      electricity_threshold2, electricity_tariff2, electricity_tariff3,
      gas, tko, uk, caprepair, effective_from)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      flatId,
      tariffData.water || 0,
      tariffData.electricity_threshold1 || 150,
      tariffData.electricity_tariff1 || 0,
      tariffData.electricity_threshold2 || 800,
      tariffData.electricity_tariff2 || 0,
      tariffData.electricity_tariff3 || 0,
      tariffData.gas || 0,
      tariffData.tko || 0,
      tariffData.uk || 0,
      tariffData.caprepair || 0,
      effectiveFrom,
    ]
  );
}

async function createDefaultTariff(flatId) {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstDayStr = firstDay.toISOString().split('T')[0];
  return createTariffRecord(flatId, {}, firstDayStr);
}

// ---- Meter Readings ----
async function getReadings(flatId, mk) {
  return queryOne(
    `SELECT * FROM meter_readings WHERE flat_id = ? AND month = ? ORDER BY submitted_at DESC LIMIT 1`,
    [flatId, mk]
  );
}

async function getLatestReadings(flatId) {
  return queryOne(
    `SELECT * FROM meter_readings WHERE flat_id = ? ORDER BY month DESC, submitted_at DESC LIMIT 1`,
    [flatId]
  );
}

async function getAllReadingsForMonth(flatId, mk) {
  return queryAll(
    `SELECT * FROM meter_readings WHERE flat_id = ? AND month = ? ORDER BY submitted_at ASC`,
    [flatId, mk]
  );
}

async function upsertReadings(flatId, mk, readings, prevReadings, isInterval) {
  const nowIso = new Date().toISOString();
  if (isInterval) {
    // Interval month: always insert a new row
    return queryOne(
      `INSERT INTO meter_readings
       (flat_id, month, electricity, water, gas, previous_electricity, previous_water, previous_gas, submitted_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
      [
        flatId, mk, readings.electricity, readings.water, readings.gas,
        prevReadings.electricity, prevReadings.water, prevReadings.gas,
        nowIso, nowIso,
      ]
    );
  }
  // Normal month: upsert (one row per month)
  const existing = await queryOne(
    'SELECT * FROM meter_readings WHERE flat_id = ? AND month = ? ORDER BY submitted_at DESC LIMIT 1',
    [flatId, mk]
  );
  if (existing) {
    return queryOne(
      `UPDATE meter_readings SET
        electricity = ?, water = ?, gas = ?,
        previous_electricity = ?, previous_water = ?, previous_gas = ?,
        updated_at = ?
       WHERE id = ? RETURNING *`,
      [
        readings.electricity, readings.water, readings.gas,
        prevReadings.electricity, prevReadings.water, prevReadings.gas,
        nowIso, existing.id,
      ]
    );
  }
  return queryOne(
    `INSERT INTO meter_readings
     (flat_id, month, electricity, water, gas, previous_electricity, previous_water, previous_gas, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      flatId, mk, readings.electricity, readings.water, readings.gas,
      prevReadings.electricity, prevReadings.water, prevReadings.gas,
      nowIso, nowIso,
    ]
  );
}

async function setInitialReadings(flatId, electricity, water, gas) {
  const pmk = prevMonthKey();
  const existing = await getReadings(flatId, pmk);
  const nowIso = new Date().toISOString();
  if (existing) {
    return queryOne(
      `UPDATE meter_readings SET
        electricity = ?, water = ?, gas = ?,
        previous_electricity = ?, previous_water = ?, previous_gas = ?,
        updated_at = ?
       WHERE id = ? RETURNING *`,
      [electricity, water, gas, electricity, water, gas, nowIso, existing.id]
    );
  }
  return queryOne(
    `INSERT INTO meter_readings
     (flat_id, month, electricity, water, gas, previous_electricity, previous_water, previous_gas, submitted_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [flatId, pmk, electricity, water, gas, electricity, water, gas, nowIso, nowIso]
  );
}

// ---- Transactions ----
async function getTransactions(flatId, limit = 50) {
  return queryAll(
    'SELECT * FROM transactions WHERE flat_id = ? ORDER BY created_at DESC LIMIT ?',
    [flatId, limit]
  );
}

async function getTransactionsForUser(userId) {
  const user = await queryOne('SELECT flat_id FROM users WHERE user_id = ?', [userId]);
  if (!user || !user.flat_id) return [];
  return getTransactions(user.flat_id);
}

async function getAccrualForMonth(flatId, mk) {
  return queryOne(
    `SELECT * FROM transactions WHERE flat_id = ? AND month = ? AND type = 'accrual'`,
    [flatId, mk]
  );
}

async function createAccrual(flatId, mk, amount, description, tariffsSnapshot, createdBy) {
  const txn = queryOne(
    `INSERT INTO transactions (flat_id, month, amount, type, description, tariffs_snapshot, created_by)
     VALUES (?, ?, ?, 'accrual', ?, ?, ?) RETURNING *`,
    [flatId, mk, amount, description, JSON.stringify(tariffsSnapshot), createdBy]
  );
  await updateFlatBalance(flatId, amount);
  return txn;
}

async function deleteAccrual(flatId, mk) {
  // Get the old amount so we can reverse the balance
  const old = await getAccrualForMonth(flatId, mk);
  if (old) {
    await updateFlatBalance(flatId, -old.amount);
  }
  await query(
    `DELETE FROM transactions WHERE flat_id = ? AND month = ? AND type = 'accrual'`,
    [flatId, mk]
  );
}

async function createPayment(flatId, mk, amount, createdBy) {
  const payAmount = -Math.abs(Number(amount));
  const txn = queryOne(
    `INSERT INTO transactions (flat_id, month, amount, type, description, created_by)
     VALUES (?, ?, ?, 'payment', 'Платёж от арендатора', ?) RETURNING *`,
    [flatId, mk, payAmount, createdBy]
  );
  await updateFlatBalance(flatId, payAmount);
  return txn;
}

async function createInitialBalanceTransaction(flatId, amount, createdBy) {
  const txn = queryOne(
    `INSERT INTO transactions (flat_id, month, amount, type, description, created_by)
     VALUES (?, ?, ?, 'initial', 'Начальный баланс', ?) RETURNING *`,
    [flatId, monthKey(), amount, createdBy]
  );
  await updateFlatBalance(flatId, amount);
  return txn;
}

async function getBalance(flatId) {
  const flat = await queryOne('SELECT balance FROM flats WHERE id = ?', [flatId]);
  return flat ? Math.round(flat.balance * 100) / 100 : 0;
}

// ---- Subscriptions ----
async function getSubscription(adminUserId) {
  return queryOne('SELECT * FROM subscriptions WHERE admin_user_id = ?', [adminUserId]);
}

async function createSubscription(adminUserId, endDate, maxFlats) {
  const deletionDate = new Date(endDate);
  deletionDate.setMonth(deletionDate.getMonth() + 3);
  return queryOne(
    `INSERT INTO subscriptions (admin_user_id, end_date, max_flats, deletion_scheduled_at)
     VALUES (?, ?, ?, ?) RETURNING *`,
    [adminUserId, endDate, maxFlats, deletionDate.toISOString().split('T')[0]]
  );
}

async function updateSubscription(adminUserId, endDate, maxFlats) {
  const deletionDate = new Date(endDate);
  deletionDate.setMonth(deletionDate.getMonth() + 3);
  return queryOne(
    `UPDATE subscriptions SET end_date = ?, max_flats = ?, deletion_scheduled_at = ?
     WHERE admin_user_id = ? RETURNING *`,
    [endDate, maxFlats, deletionDate.toISOString().split('T')[0], adminUserId]
  );
}

async function listAllSubscriptions() {
  return queryAll(
    `SELECT s.*, u.user_id FROM subscriptions s
     JOIN users u ON s.admin_user_id = u.user_id
     ORDER BY s.created_at DESC`
  );
}

function isSubscriptionActive(sub) {
  if (!sub) return false;
  return new Date(sub.end_date) >= new Date();
}

// Detect trial subscription: max_flats = 1 and end_date is ~14 days from created_at
function isTrialSubscription(sub) {
  if (!sub || !sub.created_at || !sub.end_date) return false;
  if (sub.max_flats !== 1) return false;
  const created = new Date(sub.created_at);
  const end = new Date(sub.end_date);
  const diffDays = Math.round((end - created) / (1000 * 60 * 60 * 24));
  return diffDays >= 13 && diffDays <= 15;
}

// Count total active tenants across all flats owned by an admin
async function countTenantsForAdmin(adminUserId) {
  const row = await queryOne(
    `SELECT COUNT(*) AS count FROM users u
     JOIN flats f ON u.flat_id = f.id
     WHERE f.admin_user_id = ? AND u.role = 'tenant' AND u.is_active = 1`,
    [adminUserId]
  );
  return row ? row.count : 0;
}

// Get all active tenants for flats belonging to an admin (with flat info)
async function getActiveTenantsForAdmin(adminUserId) {
  return queryAll(
    `SELECT u.user_id, u.flat_id, f.name AS flat_name
     FROM users u
     JOIN flats f ON u.flat_id = f.id
     WHERE f.admin_user_id = ? AND u.role = 'tenant' AND u.is_active = 1
     ORDER BY u.user_id`,
    [adminUserId]
  );
}

// ---- Invite Tokens ----
async function createInviteToken(role, flatId = null, subEndDate = null, subMaxFlats = null) {
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return queryOne(
    `INSERT INTO invite_tokens (token, role, flat_id, expires_at, sub_end_date, sub_max_flats)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [token, role, flatId, expiresAt.toISOString(), subEndDate, subMaxFlats]
  );
}

async function getInviteToken(token) {
  return queryOne('SELECT * FROM invite_tokens WHERE token = ?', [token]);
}

async function markTokenUsed(tokenId) {
  await query('UPDATE invite_tokens SET used = 1 WHERE id = ?', [tokenId]);
}

// ---- Tenants ----
async function getTenantsForFlat(flatId) {
  return queryAll(
    `SELECT * FROM users WHERE flat_id = ? AND role = 'tenant' AND is_active = 1`,
    [flatId]
  );
}

async function getAllActiveTenants() {
  return queryAll(
    `SELECT user_id, flat_id, is_active, role FROM users
     WHERE role = 'tenant' AND is_active = 1`
  );
}

async function getAllFlats() {
  return queryAll('SELECT * FROM flats');
}

// Get flats that have at least one active tenant but no readings for the current month
async function getFlatsWithTenantsNoReadings(mk) {
  return queryAll(
    `SELECT f.* FROM flats f
     WHERE EXISTS (SELECT 1 FROM users u WHERE u.flat_id = f.id AND u.role = 'tenant' AND u.is_active = 1)
     AND NOT EXISTS (SELECT 1 FROM meter_readings mr WHERE mr.flat_id = f.id AND mr.month = ?)`,
    [mk]
  );
}

// ---- Stats ----
async function getGlobalStats() {
  const adminRow = await queryOne(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`);
  const flatRow = await queryOne(`SELECT COUNT(*) AS count FROM flats`);
  const today = new Date().toISOString().split('T')[0];
  const subRow = await queryOne(
    `SELECT COUNT(*) AS count FROM subscriptions WHERE end_date >= ?`,
    [today]
  );
  const debtRow = await queryOne(
    `SELECT COALESCE(SUM(balance), 0) AS total FROM flats`
  );
  return {
    adminCount: adminRow ? adminRow.count : 0,
    flatCount: flatRow ? flatRow.count : 0,
    activeSubs: subRow ? subRow.count : 0,
    totalDebt: debtRow ? Math.round(debtRow.total * 100) / 100 : 0,
  };
}

// ---- Cleanup ----
async function deleteUserAndData(userId) {
  const flats = await listFlatsForAdmin(userId);
  for (const flat of flats) {
    await deleteFlat(flat.id);
  }
  await query('DELETE FROM subscriptions WHERE admin_user_id = ?', [userId]);
  await query('DELETE FROM users WHERE user_id = ?', [userId]);
}

module.exports = {
  getUser,
  createUser,
  deactivateUser,
  deleteUser,
  toggleUserActive,
  setSelectedFlat,
  listUsersForAdmin,
  listAllUsers,
  getBotState,
  initBotState,
  setSuperAdmin,
  getFlat,
  listFlatsForAdmin,
  countFlatsForAdmin,
  createFlat,
  deleteFlat,
  setRent,
  updateFlatBalance,
  setFlatBalance,
  getCurrentTariff,
  getTariffForMonth,
  isIntervalMonth,
  createTariffRecord,
  createDefaultTariff,
  getReadings,
  getLatestReadings,
  getAllReadingsForMonth,
  upsertReadings,
  setInitialReadings,
  getTransactions,
  getTransactionsForUser,
  getAccrualForMonth,
  createAccrual,
  deleteAccrual,
  createPayment,
  createInitialBalanceTransaction,
  getBalance,
  getSubscription,
  createSubscription,
  updateSubscription,
  listAllSubscriptions,
  isSubscriptionActive,
  isTrialSubscription,
  countTenantsForAdmin,
  getActiveTenantsForAdmin,
  createInviteToken,
  getInviteToken,
  markTokenUsed,
  getTenantsForFlat,
  getAllActiveTenants,
  getAllFlats,
  getFlatsWithTenantsNoReadings,
  getGlobalStats,
  deleteUserAndData,
};
