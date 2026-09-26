// Scheduler: cron-based reminders and notifications
const cron = require('node-cron');
const queries = require('./queries');
const { formatMoney, formatMoneyShort, monthKey, prevMonthKey } = require('./utils');
const keyboards = require('./keyboards');
const { calculateFixedOnlyAccrual, buildAccrualDescription } = require('./billing');

function setupScheduler(bot) {
  // 23rd of each month at 10:00 — remind tenants to submit readings
  cron.schedule('0 10 23 * *', async () => {
    await remindTenantsToSubmit(bot);
    await autoAccrualNoReadings(bot);
  }, { timezone: 'Europe/Moscow' });

  // 24th at 10:00 — second reminder
  cron.schedule('0 10 24 * *', async () => {
    await remindTenantsToSubmit(bot);
  }, { timezone: 'Europe/Moscow' });

  // 26th at 10:00 — notify landlords about unsubmitted readings
  cron.schedule('0 10 26 * *', async () => {
    await notifyLandlordsAboutMissingReadings(bot);
  }, { timezone: 'Europe/Moscow' });

  // 8th at 10:00 — payment reminders
  cron.schedule('0 10 8 * *', async () => {
    await remindAboutPayment(bot);
  }, { timezone: 'Europe/Moscow' });

  // Daily check: trial expiry notifications + expired subscriptions cleanup
  cron.schedule('0 9 * * *', async () => {
    await notifyTrialExpiry(bot);
  }, { timezone: 'Europe/Moscow' });

  // Daily check for expired subscriptions data deletion
  cron.schedule('0 3 * * *', async () => {
    await cleanupExpiredSubscriptions(bot);
  }, { timezone: 'Europe/Moscow' });

  console.log('[Scheduler] Cron jobs initialized');
}

async function remindTenantsToSubmit(bot) {
  const mk = monthKey();
  const allTenants = await queries.getAllActiveTenants();
  if (!allTenants) return;

  for (const tenant of allTenants) {
    const readings = await queries.getReadings(tenant.flat_id, mk);
    if (!readings) {
      try {
        await bot.telegram.sendMessage(
          tenant.user_id,
          `📅 Напоминание: пожалуйста, передайте показания счётчиков до 25 числа.\nИспользуйте команду /submit`
        );
      } catch (e) { /* ignore */ }
    }
  }
}

// Auto-accrual for flats with tenants but no readings (23rd, 10:00)
async function autoAccrualNoReadings(bot) {
  const mk = monthKey();
  const flats = await queries.getFlatsWithTenantsNoReadings(mk);
  if (!flats || flats.length === 0) return;

  for (const flat of flats) {
    // Check if accrual already exists
    const existing = await queries.getAccrualForMonth(flat.id, mk);
    if (existing) continue;

    // Get tariff active on 1st of month
    const tariff = await queries.getTariffForMonth(flat.id, mk);
    if (!tariff) continue;

    const { breakdown, total } = calculateFixedOnlyAccrual(tariff, flat);
    if (total === 0) continue;

    const description = buildAccrualDescription(breakdown);
    const tariffsSnapshot = {
      water: tariff.water,
      electricity_tariff1: tariff.electricity_tariff1,
      electricity_tariff2: tariff.electricity_tariff2,
      electricity_tariff3: tariff.electricity_tariff3,
      gas: tariff.gas,
      tko: tariff.tko,
      uk: tariff.uk,
      caprepair: tariff.caprepair,
      rent_enabled: flat.rent_enabled,
      rent_amount: flat.rent_amount,
    };

    await queries.createAccrual(flat.id, mk, total, description, tariffsSnapshot, null);
    console.log(`[Scheduler] Auto-accrual for flat ${flat.id} (${mk}): ${total}`);

    // Notify landlord
    if (flat.admin_user_id) {
      try {
        let msg = `📋 Автоматическое начисление (нет показаний)\n`;
        msg += `Квартира: ${flat.name} (№${flat.id})\n`;
        msg += `Месяц: ${mk}\n\n`;
        msg += `${description}\n\n`;
        msg += `Итого: ${formatMoney(total)}\n`;
        const balance = await queries.getBalance(flat.id);
        msg += `Баланс: ${formatMoney(balance)}`;
        await bot.telegram.sendMessage(flat.admin_user_id, msg);
      } catch (e) { /* ignore */ }
    }
  }
}

async function notifyLandlordsAboutMissingReadings(bot) {
  const mk = monthKey();
  const flats = await queries.getAllFlats();
  if (!flats) return;

  const byAdmin = {};
  for (const flat of flats) {
    const readings = await queries.getReadings(flat.id, mk);
    if (!readings) {
      if (!byAdmin[flat.admin_user_id]) byAdmin[flat.admin_user_id] = [];
      byAdmin[flat.admin_user_id].push(flat);
    }
  }

  for (const [adminId, flatList] of Object.entries(byAdmin)) {
    const adminIdNum = parseInt(adminId);
    const sub = await queries.getSubscription(adminIdNum);
    if (sub && !queries.isSubscriptionActive(sub)) continue;
    const names = flatList.map(f => `№${f.id} ${f.name}`).join(', ');
    try {
      await bot.telegram.sendMessage(
        adminIdNum,
        `⚠️ Не все арендаторы сдали показания за ${mk}.\nКвартиры: ${names}`
      );
    } catch (e) { /* ignore */ }
  }
}

async function remindAboutPayment(bot) {
  const flats = await queries.getAllFlats();
  if (!flats) return;

  for (const flat of flats) {
    const sub = await queries.getSubscription(flat.admin_user_id);
    if (sub && !queries.isSubscriptionActive(sub)) continue;

    const balance = await queries.getBalance(flat.id);
    let msg;
    if (balance > 0.01) {
      msg = `Напоминание: по квартире №${flat.id} «${flat.name}» задолженность составляет ${formatMoney(balance)}. Пожалуйста, получите оплату от арендатора.`;
    } else {
      msg = `Напоминание: по квартире №${flat.id} «${flat.name}» задолженность отсутствует. Не забудьте своевременно оплатить коммунальные услуги поставщикам, чтобы избежать пеней.`;
    }
    try {
      await bot.telegram.sendMessage(flat.admin_user_id, msg, keyboards.payKeyboard());
    } catch (e) { /* ignore */ }
  }
}

async function notifyTrialExpiry(bot) {
  const subs = await queries.listAllSubscriptions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const sub of subs) {
    if (!queries.isTrialSubscription(sub)) continue;
    const endDate = new Date(sub.end_date);
    endDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((endDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays === 3) {
      try {
        await bot.telegram.sendMessage(
          sub.admin_user_id,
          `⏳ Ваш пробный период заканчивается через 3 дня.\n` +
          `Чтобы продолжить пользоваться ботом, оформите подписку.\n` +
          `Используйте команду /support, чтобы связаться с администратором.`
        );
      } catch (e) { /* ignore */ }
    }

    if (diffDays === 0) {
      try {
        await bot.telegram.sendMessage(
          sub.admin_user_id,
          `⚠️ Ваш пробный период завершён.\n` +
          `Доступны только просмотр статистики и связь с поддержкой (/support).\n` +
          `Для оформления подписки используйте /support.`
        );
      } catch (e) { /* ignore */ }
    }
  }
}

async function cleanupExpiredSubscriptions(bot) {
  const subs = await queries.listAllSubscriptions();
  const today = new Date().toISOString().split('T')[0];
  for (const sub of subs) {
    if (sub.deletion_scheduled_at && sub.deletion_scheduled_at < today) {
      if (!queries.isSubscriptionActive(sub)) {
        await queries.deleteUserAndData(sub.admin_user_id);
        console.log(`[Cleanup] Deleted data for expired admin ${sub.admin_user_id}`);
      }
    }
  }
}

module.exports = { setupScheduler };
