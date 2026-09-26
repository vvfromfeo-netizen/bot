// Tenant command handlers
const queries = require('../queries');
const {
  formatMoney,
  formatMoneyShort,
  monthKey,
  isValidPositiveNumber,
  parseNumber,
  normalizeNumber,
  formatDate,
} = require('../utils');
const {
  calculateAccrual,
  calculateIntervalAccrual,
  calculateFixed,
  buildAccrualDescription,
} = require('../billing');
const keyboards = require('../keyboards');
const session = require('../session');

async function tenantStart(ctx, user) {
  const flat = await queries.getFlat(user.flat_id);
  let msg = `Здравствуйте! Вы вошли как арендатор.\n`;
  if (flat) msg += `Квартира: ${flat.name}\n\n`;
  msg += `Доступные команды:\n`;
  msg += `/submit — передать показания счётчиков\n`;
  msg += `/balance — показать баланс и историю\n`;
  msg += `/stats — показать статистику по квартире\n`;
  msg += `/cancel — отменить текущее действие\n`;
  msg += `/help — инструкция`;
  await ctx.reply(msg, keyboards.tenantMainMenu());
}

async function tenantHelp(ctx) {
  const msg = `📋 Инструкция для арендатора

📊 Показания:
• /submit — передать показания счётчиков
• Показания запрашиваются только для услуг с тарифом > 0
• Порядок: электричество → вода → газ
• Показания не могут быть меньше предыдущих
• Можно повторно передать показания до конца месяца

💰 Баланс:
• /balance — показать текущий баланс и историю операций
• Положительный баланс = задолженность
• Отрицательный баланс = переплата (предоплата)

📊 /stats — показать статистику по квартире (тарифы, показания, баланс)

📨 /support — связь с поддержкой (можно прикрепить фото/документ)

🗑 /delete_me — удалить свой аккаунт и покинуть систему

❌ /cancel — отменить любое незавершённое действие

❓ По всем вопросам обращайтесь к арендодателю.`;
  await ctx.reply(msg);
}

async function tenantBalance(ctx, user) {
  const flat = await queries.getFlat(user.flat_id);
  if (!flat) return ctx.reply('Квартира не найдена.');
  const balance = await queries.getBalance(user.flat_id);
  const txns = await queries.getTransactions(user.flat_id, 20);

  let msg = `Квартира: ${flat.name}\n`;
  msg += `Текущий баланс: ${formatMoney(balance)}\n`;
  msg += balance > 0 ? ` (задолженность)\n` : balance < 0 ? ` (переплата)\n` : ` (нет долга)\n\n`;

  if (txns.length) {
    msg += `Последние операции:\n`;
    for (const t of txns.slice(0, 10)) {
      const date = new Date(t.created_at).toLocaleDateString('ru-RU');
      const sign = t.type === 'accrual' || t.type === 'initial' ? '+' : '-';
      const typeLabel = t.type === 'accrual' ? 'Начисление' : t.type === 'initial' ? 'Нач.баланс' : 'Платёж';
      msg += `${date} | ${typeLabel} | ${sign}${formatMoneyShort(Math.abs(t.amount))} | ${t.month}\n`;
    }
  }
  await ctx.reply(msg);
}

// Start meter reading submission flow
async function submitReadings(ctx, user, bot) {
  const isLandlord = user.role === 'admin' || user.role === 'super_admin';
  const flatId = isLandlord ? user.selected_flat_id : user.flat_id;
  if (!flatId) {
    return ctx.reply(isLandlord ? 'Сначала выберите квартиру: /select_flat <номер>' : 'Квартира не найдена.');
  }
  const flat = await queries.getFlat(flatId);
  if (!flat) return ctx.reply('Квартира не найдена.');

  // Block submission if landlord's subscription has expired
  if (flat.admin_user_id) {
    const sub = await queries.getSubscription(flat.admin_user_id);
    if (sub && !queries.isSubscriptionActive(sub)) {
      return ctx.reply('Передача показаний недоступна — подписка арендодателя истекла. Обратитесь к арендодателю.');
    }
  }

  if (isLandlord) {
    const tenants = await queries.getTenantsForFlat(flatId);
    if (tenants.length > 0) {
      return ctx.reply('В этой квартире есть активные арендаторы. Они должны самостоятельно передавать показания.');
    }
  }

  const tariff = await queries.getCurrentTariff(flatId);
  if (!tariff) return ctx.reply('Тарифы не настроены. Обратитесь к арендодателю.');

  const mk = monthKey();
  const existing = await queries.getReadings(flatId, mk);
  if (existing) {
    const now = new Date();
    const [m, y] = mk.split('.').map(Number);
    if (now.getMonth() !== m - 1 || now.getFullYear() !== y) {
      return ctx.reply('Срок сдачи показаний за этот месяц истёк. Обратитесь к арендодателю.');
    }
  }

  // Determine which meters to ask for (tariff > 0)
  const meters = [];
  if ((Number(tariff.electricity_tariff1) || 0) > 0 || (Number(tariff.electricity_tariff2) || 0) > 0 || (Number(tariff.electricity_tariff3) || 0) > 0) {
    meters.push('electricity');
  }
  if ((Number(tariff.water) || 0) > 0) meters.push('water');
  if ((Number(tariff.gas) || 0) > 0) meters.push('gas');

  if (meters.length === 0) {
    return ctx.reply('Все тарифы равны 0. Показания не требуются.');
  }

  const prevReadings = await getPreviousReadings(flatId, mk);

  // Check if this is an interval month
  const isInterval = await queries.isIntervalMonth(flatId, mk);

  session.setSession(user.user_id, {
    flow: 'meter_readings',
    flatId,
    meters,
    currentIndex: 0,
    readings: {},
    prevReadings,
    mk,
    isInterval,
    isLandlord,
  });

  await askForReading(ctx, user, bot);
}

async function getPreviousReadings(flatId, currentMonthKey) {
  const [m, y] = currentMonthKey.split('.').map(Number);
  const prevDate = new Date(y, m - 2, 1);
  const prevMk = `${String(prevDate.getMonth() + 1).padStart(2, '0')}.${prevDate.getFullYear()}`;
  const prevReading = await queries.getReadings(flatId, prevMk);
  if (prevReading) {
    return {
      electricity: Number(prevReading.electricity) || 0,
      water: Number(prevReading.water) || 0,
      gas: Number(prevReading.gas) || 0,
    };
  }
  const latest = await queries.getLatestReadings(flatId);
  if (latest) {
    return {
      electricity: Number(latest.electricity) || 0,
      water: Number(latest.water) || 0,
      gas: Number(latest.gas) || 0,
    };
  }
  return { electricity: 0, water: 0, gas: 0 };
}

async function askForReading(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  if (sess.currentIndex >= sess.meters.length) {
    await finalizeReadings(ctx, user, bot);
    return;
  }

  const meter = sess.meters[sess.currentIndex];
  const meterNames = {
    electricity: 'Электричество',
    water: 'Вода',
    gas: 'Газ',
  };
  const units = {
    electricity: 'кВт·ч',
    water: 'м³',
    gas: 'м³',
  };

  const prev = sess.prevReadings[meter] || 0;
  let msg = `📊 Передача показаний (${sess.currentIndex + 1}/${sess.meters.length})\n\n`;
  msg += `${meterNames[meter]} (тариф > 0)\n`;
  msg += `Предыдущее показание: ${prev} ${units[meter]}\n\n`;
  msg += `Введите текущее показание:`;
  await ctx.reply(msg, keyboards.removeKeyboard());
}

// Handle meter reading text input
async function handleReadingInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim().replace(',', '.');

  if (!isValidPositiveNumber(text)) {
    return ctx.reply('Введите положительное число (разделитель — точка или запятая). Попробуйте снова:');
  }

  const value = normalizeNumber(text);
  const meter = sess.meters[sess.currentIndex];
  const prev = sess.prevReadings[meter] || 0;

  if (value < prev) {
    return ctx.reply(
      `❌ Показание (${value}) меньше предыдущего (${prev}). Введите корректное значение:`
    );
  }

  const consumption = value - prev;
  const tariff = await queries.getCurrentTariff(sess.flatId);
  let amount = 0;
  if (meter === 'electricity') {
    const { calculateElectricity } = require('../billing');
    amount = calculateElectricity(consumption, tariff);
  } else {
    const rate = Number(tariff[meter]) || 0;
    amount = Math.round(consumption * rate * 100) / 100;
  }

  const meterNames = { electricity: 'Электричество', water: 'Вода', gas: 'Газ' };
  const units = { electricity: 'кВт·ч', water: 'м³', gas: 'м³' };

  session.updateSession(user.user_id, {
    pendingReading: { meter, value, prev, consumption, amount },
  });

  let msg = `Вы ввели показания: ${value}\n`;
  msg += `Прошлые показания: ${prev}\n`;
  msg += `Расход: ${consumption} ${units[meter]}\n`;
  msg += `Сумма: ${formatMoney(amount)}`;
  await ctx.reply(msg, keyboards.confirmKeyboard());
}

// Confirm reading callback
async function confirmReading(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  if (!sess || !sess.pendingReading) return;

  const { meter, value } = sess.pendingReading;
  sess.readings[meter] = value;
  sess.currentIndex++;
  session.updateSession(user.user_id, {
    readings: sess.readings,
    currentIndex: sess.currentIndex,
    pendingReading: null,
  });
  await ctx.answerCbQuery('✅ Показание сохранено');
  await askForReading(ctx, user, bot);
}

// Retry reading callback
async function retryReading(ctx, user, bot) {
  session.updateSession(user.user_id, { pendingReading: null });
  await ctx.answerCbQuery('Введите заново');
  await askForReading(ctx, user, bot);
}

// Finalize: save readings and create accrual
async function finalizeReadings(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const flat = await queries.getFlat(sess.flatId);

  const readings = {
    electricity: sess.readings.electricity ?? null,
    water: sess.readings.water ?? null,
    gas: sess.readings.gas ?? null,
  };
  const prevReadings = sess.prevReadings;
  const mk = sess.mk;

  // Save readings (interval-aware)
  await queries.upsertReadings(sess.flatId, mk, readings, prevReadings, sess.isInterval);

  // Delete old accrual if exists (recalculation)
  await queries.deleteAccrual(sess.flatId, mk);

  let breakdown, total;

  if (sess.isInterval) {
    // Interval month: use interval calculation
    const allReadings = await queries.getAllReadingsForMonth(sess.flatId, mk);

    const getTariffForDate = (dateStr) => {
      if (!dateStr) {
        // Use tariff for 1st of month
        return queries.getTariffForMonth(sess.flatId, mk);
      }
      const isoDate = typeof dateStr === 'string' && dateStr.includes('T')
        ? dateStr.split('T')[0]
        : dateStr;
      return queries.getCurrentTariff(sess.flatId, isoDate);
    };

    // For interval calc we need synchronous tariff lookups, but our queries are async.
    // Pre-fetch tariffs for all reading dates.
    const tariffCache = {};
    for (const r of allReadings) {
      const isoDate = r.submitted_at ? r.submitted_at.split('T')[0] : null;
      if (isoDate && !tariffCache[isoDate]) {
        tariffCache[isoDate] = await queries.getCurrentTariff(sess.flatId, isoDate);
      }
    }
    // Also cache 1st-of-month tariff
    const firstOfMonthTariff = await queries.getTariffForMonth(sess.flatId, mk);
    tariffCache['__first__'] = firstOfMonthTariff;

    const syncGetTariff = (dateStr) => {
      if (!dateStr) return tariffCache['__first__'];
      const isoDate = dateStr.split('T')[0];
      return tariffCache[isoDate] || firstOfMonthTariff;
    };

    const result = calculateIntervalAccrual(allReadings, prevReadings, syncGetTariff, flat);
    breakdown = result.breakdown;
    total = result.total;
  } else {
    // Normal month: single tariff
    const tariff = await queries.getTariffForMonth(sess.flatId, mk);
    if (!tariff) {
      session.clearSession(user.user_id);
      return ctx.reply('Тариф не найден для текущего месяца. Обратитесь к арендодателю.', keyboards.removeKeyboard());
    }
    const result = calculateAccrual(readings, prevReadings, tariff, flat);
    breakdown = result.breakdown;
    total = result.total;
  }

  const description = buildAccrualDescription(breakdown);

  // Get tariff snapshot for the accrual
  const snapshotTariff = sess.isInterval
    ? await queries.getTariffForMonth(sess.flatId, mk)
    : await queries.getTariffForMonth(sess.flatId, mk);
  const tariffsSnapshot = {
    water: snapshotTariff?.water || 0,
    electricity_threshold1: snapshotTariff?.electricity_threshold1 || 150,
    electricity_tariff1: snapshotTariff?.electricity_tariff1 || 0,
    electricity_threshold2: snapshotTariff?.electricity_threshold2 || 800,
    electricity_tariff2: snapshotTariff?.electricity_tariff2 || 0,
    electricity_tariff3: snapshotTariff?.electricity_tariff3 || 0,
    gas: snapshotTariff?.gas || 0,
    tko: snapshotTariff?.tko || 0,
    uk: snapshotTariff?.uk || 0,
    caprepair: snapshotTariff?.caprepair || 0,
    rent_enabled: flat.rent_enabled,
    rent_amount: flat.rent_amount,
  };

  await queries.createAccrual(sess.flatId, mk, total, description, tariffsSnapshot, user.user_id);
  const balance = await queries.getBalance(sess.flatId);

  // Notify submitter
  let submitterMsg = `✅ Показания сохранены за ${mk}\n\n`;
  submitterMsg += `Детализация начисления:\n${description}\n\n`;
  submitterMsg += `Итого начислено: ${formatMoney(total)}\n`;
  submitterMsg += `Текущий баланс: ${formatMoney(balance)}`;
  const replyKeyboard = sess.isLandlord ? keyboards.adminMainMenu() : keyboards.tenantMainMenu();
  await ctx.reply(submitterMsg, replyKeyboard);

  // Notify landlord (only if submitter is a tenant)
  if (bot && flat.admin_user_id && !sess.isLandlord) {
    try {
      let adminMsg = `📋 Новые показания от арендатора\n`;
      adminMsg += `Квартира: ${flat.name} (№${flat.id})\n`;
      adminMsg += `Месяц: ${mk}\n\n`;
      adminMsg += `Детализация:\n${description}\n\n`;
      adminMsg += `Итого начислено: ${formatMoney(total)}\n`;
      adminMsg += `Текущий баланс: ${formatMoney(balance)}`;
      await bot.telegram.sendMessage(flat.admin_user_id, adminMsg, keyboards.payKeyboard());
    } catch (e) {
      // landlord may not have started bot yet
    }
  }

  session.clearSession(user.user_id);
}

async function tenantStats(ctx, user) {
  const flatId = user.flat_id;
  if (!flatId) return ctx.reply('Квартира не найдена. Обратитесь к арендодателю.');
  const flat = await queries.getFlat(flatId);
  if (!flat) return ctx.reply('Квартира не найдена. Обратитесь к арендодателю.');

  const tariff = await queries.getCurrentTariff(flatId);
  const readings = await queries.getLatestReadings(flatId);
  const balance = await queries.getBalance(flatId);

  let msg = `Квартира: ${flat.id}. ${flat.name}\n\n`;
  msg += `Текущие тарифы:\n`;
  msg += `  Вода: ${tariff?.water || 0} руб./м³\n`;
  msg += `  Электричество: т1=${tariff?.electricity_threshold1 || 150} т2=${tariff?.electricity_threshold2 || 800}\n`;
  msg += `    тариф1=${tariff?.electricity_tariff1 || 0} тариф2=${tariff?.electricity_tariff2 || 0} тариф3=${tariff?.electricity_tariff3 || 0}\n`;
  msg += `  Газ: ${tariff?.gas || 0} руб./м³\n`;
  msg += `  ТКО: ${tariff?.tko || 0} руб.\n`;
  msg += `  УК: ${tariff?.uk || 0} руб.\n`;
  msg += `  Капремонт: ${tariff?.caprepair || 0} руб.\n`;
  msg += `  Аренда: ${flat.rent_enabled ? formatMoneyShort(flat.rent_amount) : 'выключена'}\n`;
  if (tariff) {
    msg += `  Действуют с: ${formatDate(tariff.effective_from)}\n`;
  }
  msg += `\n`;
  if (readings) {
    msg += `Последние показания (${readings.month}):\n`;
    msg += `  Электричество: ${readings.electricity || '—'}\n`;
    msg += `  Вода: ${readings.water || '—'}\n`;
    msg += `  Газ: ${readings.gas || '—'}\n\n`;
  }
  msg += `Текущий баланс: ${formatMoney(balance)}`;
  await ctx.reply(msg);
}

// /delete_me — tenant self-deletion with confirmation
async function deleteMe(ctx, user, bot) {
  const flat = await queries.getFlat(user.flat_id);
  session.setSession(user.user_id, { flow: 'delete_me', flatId: user.flat_id, flatAdminId: flat?.admin_user_id });
  await ctx.reply(
    '⚠️ Вы уверены, что хотите удалить свой аккаунт?\n\n' +
    'Ваши данные (показания, транзакции) будут сохранены для истории у арендодателя.\n' +
    'После удаления вы сможете заново зарегистрироваться в боте по новой пригласительной ссылке ' +
    '(например, как арендодатель или арендатор другой квартиры).',
    keyboards.deleteMeConfirmKeyboard()
  );
}

async function confirmDeleteMe(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  if (!sess || sess.flow !== 'delete_me') return;

  const flatAdminId = sess.flatAdminId;
  const flatId = sess.flatId;

  await queries.deleteUser(user.user_id);

  session.clearSession(user.user_id);
  await ctx.answerCbQuery('Аккаунт удалён');
  await ctx.editMessageText(
    '✅ Ваш аккаунт удалён. ' +
    'Если захотите зарегистрироваться заново (например, как арендодатель), ' +
    'используйте соответствующую пригласительную ссылку или команду /start.'
  );

  if (bot && flatAdminId) {
    try {
      await bot.telegram.sendMessage(
        flatAdminId,
        `👤 Арендатор ${user.user_id} покинул систему и удалён из базы данных.`
      );
    } catch (e) { /* landlord may have blocked bot */ }
  }
}

async function cancelDeleteMe(ctx, user) {
  session.clearSession(user.user_id);
  await ctx.answerCbQuery('Удаление отменено');
  await ctx.editMessageText('❌ Удаление аккаунта отменено. Вы остаётесь в системе.');
}

module.exports = {
  tenantStart,
  tenantHelp,
  tenantBalance,
  tenantStats,
  submitReadings,
  handleReadingInput,
  confirmReading,
  retryReading,
  finalizeReadings,
  deleteMe,
  confirmDeleteMe,
  cancelDeleteMe,
};
