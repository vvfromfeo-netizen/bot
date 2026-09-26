// Admin (landlord) command handlers
const queries = require('../queries');
const {
  formatMoney,
  formatMoneyShort,
  monthKey,
  parseDateInput,
  isValidDateStr,
  isCurrentOrFutureMonth,
  parseNumber,
  normalizeNumber,
  round2,
  formatDate,
  toFirstDayOfMonth,
} = require('../utils');
const keyboards = require('../keyboards');
const session = require('../session');
const config = require('../config');

// /start for admin
async function adminStart(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let selectedFlat = null;
  if (user.selected_flat_id) {
    selectedFlat = await queries.getFlat(user.selected_flat_id);
  }
  if (!selectedFlat && flats.length > 0) {
    selectedFlat = flats[0];
    await queries.setSelectedFlat(user.user_id, selectedFlat.id);
  }

  let msg = `Здравствуйте! Вы вошли как арендодатель.\n\n`;
  if (flats.length === 0) {
    msg += `У вас пока нет квартир. Используйте /addflat для создания.`;
  } else {
    msg += `Активная квартира: ${selectedFlat ? `${selectedFlat.id}. ${selectedFlat.name}` : 'не выбрана'}\n`;
    msg += `Всего квартир: ${flats.length}\n\n`;
    msg += `Доступные команды:\n`;
    msg += `/addflat — создать квартиру\n`;
    msg += `/select_flat <номер> — выбрать квартиру\n`;
    msg += `/flats — список квартир\n`;
    msg += `/deleteflat <номер> — удалить квартиру\n`;
    msg += `/history — история транзакций\n`;
    msg += `/stats — тарифы и показания\n`;
    msg += `/summary — сводка по квартирам\n`;
    msg += `/invite_tenant — пригласить арендатора\n`;
    msg += `/listusers — список пользователей\n`;
    msg += `/removeuser <ID> — удалить арендатора из базы данных\n`;
    msg += `/subscribe — информация о подписке\n`;
    msg += `/toggle_rent — включить/выключить аренду\n`;
    msg += `/set_rent <сумма> — установить аренду\n`;
    msg += `/pay — внести платёж\n`;
    msg += `/submit или кнопка «Ввести показания» — ввести показания (если арендатор не в боте)\n`;
    msg += `/set_initial_readings <эл> <вода> <газ> — начальные показания\n`;
    msg += `/cancel — отменить текущее действие\n`;
    msg += `/help — подробная инструкция`;
  }
  await ctx.reply(msg, keyboards.adminMainMenu());
}

// /help for admin
async function adminHelp(ctx) {
  const msg = `📋 Инструкция для арендодателя

🏠 Квартиры:
• /addflat — создать новую квартиру (диалог: название, баланс, тарифы)
• /select_flat <номер> — выбрать активную квартиру
• /flats — список всех квартир с балансами
• /deleteflat <номер> — удалить квартиру (с подтверждением, при любом балансе)

⚙️ Тарифы (через кнопки меню):
• Изменение тарифа требует дату начала действия (ДД.ММ.ГГГГ)
• Дата не может быть раньше первого числа текущего месяца
• Если тариф = 0, показания по этому счётчику не запрашиваются
• Электричество: 5 чисел (порог1 тариф1 порог2 тариф2 тариф3) или одно число

📊 Показания и расчёты:
• /submit или кнопка «Ввести показания» — ввести показания счётчиков (если арендатор не в боте)
• /set_initial_readings <эл> <вода> <газ> — начальные показания
• /stats — текущие тарифы и последние показания
• /summary — сводка по квартирам
• /history — история начислений и платежей

👥 Арендаторы:
• /invite_tenant — ссылка-приглашение (без срока доступа)
• /listusers — список пользователей
• /removeuser <TelegramID> — удалить арендатора из базы данных

💰 Платежи:
• /pay или кнопка «Внести платеж» — внести платёж
• /toggle_rent — включить/выключить учёт аренды
• /set_rent <сумма> — установить сумму аренды

📌 Подписка:
• /subscribe — информация о подписке
• /support — связь с поддержкой (можно прикрепить фото/документ)

❌ /cancel — отменить любое незавершённое действие

📅 Расписание:
• 23-24 числа — напоминания арендаторам о сдаче показаний
• 23-е 10:00 — автоначисление фиксированных платежей (если нет показаний)
• 26-е — уведомление арендодателю о несданных показаниях
• 8-го числа — напоминание об оплате`;
  await ctx.reply(msg);
}

// /addflat — multi-step dialog (Principle 2)
async function addFlat(ctx, user) {
  if (user.role !== 'super_admin') {
    const sub = await queries.getSubscription(user.user_id);
    if (!sub || !queries.isSubscriptionActive(sub)) {
      return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
    }
    const count = await queries.countFlatsForAdmin(user.user_id);
    if (count >= sub.max_flats) {
      if (queries.isTrialSubscription(sub)) {
        return ctx.reply('Пробный период позволяет только 1 квартиру. Оформите подписку для снятия ограничений.');
      }
      return ctx.reply(`Превышен лимит квартир (${sub.max_flats}). Обратитесь к суперадминистратору через /support.`);
    }
  }
  session.setSession(user.user_id, { flow: 'add_flat', step: 'name' });
  await ctx.reply('Введите название квартиры:', keyboards.removeKeyboard());
}

// Handle add_flat dialog steps
async function handleAddFlatInput(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.step === 'name') {
    if (!text) return ctx.reply('Название не может быть пустым. Введите название:');
    session.updateSession(user.user_id, { step: 'balance', flatName: text });
    return ctx.reply('Введите начальный баланс (можно пропустить — 0, или введите число, отрицательное = переплата):');
  }

  if (sess.step === 'balance') {
    let initialBalance = 0;
    if (text && text.toLowerCase() !== 'пропустить' && text !== '-') {
      const n = parseNumber(text);
      if (n === null) return ctx.reply('Некорректное число. Введите число или «пропустить»:');
      initialBalance = round2(n);
    }
    session.updateSession(user.user_id, { step: 'initial_readings', initialBalance });
    return ctx.reply(
      'Введите начальные показания счётчиков (электричество, вода, газ) через пробел или «пропустить»:'
    );
  }

  if (sess.step === 'initial_readings') {
    if (text.toLowerCase() === 'пропустить' || text === '') {
      session.updateSession(user.user_id, { step: 'tariffs_prompt', initialReadings: null });
      return ctx.reply(
        'Хотите настроить тарифы сейчас? (вода, газ, электричество, ТКО, УК, капремонт, аренда)\n' +
        'Введите «да» для настройки или «пропустить» (все тарифы будут 0):'
      );
    }
    const parts = text.split(/\s+/).map(s => s.replace(',', '.'));
    if (parts.length !== 3) {
      return ctx.reply('Нужно 3 числа (электричество, вода, газ) через пробел или «пропустить»:');
    }
    const [elec, water, gas] = parts.map(p => parseNumber(p));
    if ([elec, water, gas].some(n => n === null || n < 0)) {
      return ctx.reply('Все значения должны быть неотрицательными числами. Введите заново или «пропустить»:');
    }
    session.updateSession(user.user_id, { step: 'tariffs_prompt', initialReadings: { elec, water, gas } });
    return ctx.reply(
      'Хотите настроить тарифы сейчас? (вода, газ, электричество, ТКО, УК, капремонт, аренда)\n' +
      'Введите «да» для настройки или «пропустить» (все тарифы будут 0):'
    );
  }

  if (sess.step === 'tariffs_prompt') {
    if (text.toLowerCase() === 'да') {
      session.updateSession(user.user_id, { step: 'tariff_water', tariffData: {} });
      return ctx.reply('Введите тариф воды (руб./м³, 0 = отключено):');
    }
    // Skip tariffs — create flat without tariff_history record
    await createFlatFinal(ctx, user, sess, false);
    return;
  }

  // Tariff setup steps
  const tariffSteps = ['tariff_water', 'tariff_gas', 'tariff_tko', 'tariff_uk', 'tariff_caprepair', 'tariff_rent'];
  const stepIndex = tariffSteps.indexOf(sess.step);
  if (stepIndex >= 0) {
    const n = parseNumber(text);
    if (n === null || n < 0) return ctx.reply('Некорректное значение. Введите неотрицательное число:');

    const fieldMap = {
      tariff_water: 'water',
      tariff_gas: 'gas',
      tariff_tko: 'tko',
      tariff_uk: 'uk',
      tariff_caprepair: 'caprepair',
    };
    if (fieldMap[sess.step]) {
      sess.tariffData[fieldMap[sess.step]] = n;
    } else if (sess.step === 'tariff_rent') {
      sess.tariffData.rent_enabled = n > 0;
      sess.tariffData.rent_amount = n;
    }
    session.updateSession(user.user_id, { tariffData: sess.tariffData });

    if (stepIndex < tariffSteps.length - 1) {
      const nextStep = tariffSteps[stepIndex + 1];
      session.updateSession(user.user_id, { step: nextStep });
      const prompts = {
        tariff_gas: 'Введите тариф газа (руб./м³, 0 = отключено):',
        tariff_tko: 'Введите тариф ТКО (руб., 0 = отключено):',
        tariff_uk: 'Введите тариф УК (руб., 0 = отключено):',
        tariff_caprepair: 'Введите тариф капремонта (руб., 0 = отключено):',
        tariff_rent: 'Введите сумму аренды (руб., 0 = отключено):',
      };
      return ctx.reply(prompts[nextStep]);
    }

    // After rent — ask about electricity mode
    session.updateSession(user.user_id, { step: 'tariff_electricity_mode' });
    return ctx.reply(
      'Электричество: выберите режим.\n' +
      '1 — одноставочный (одно число, тариф за кВт·ч)\n' +
      '2 — ступенчатый (5 чисел: порог1 тариф1 порог2 тариф2 тариф3)\n' +
      'Введите 1 или 2 (или 0 для отключения):'
    );
  }

  if (sess.step === 'tariff_electricity_mode') {
    const mode = parseNumber(text);
    if (mode === 0) {
      // Electricity disabled
      sess.tariffData.electricity_tariff1 = 0;
      sess.tariffData.electricity_tariff2 = 0;
      sess.tariffData.electricity_tariff3 = 0;
      session.updateSession(user.user_id, { tariffData: sess.tariffData, step: 'confirm' });
      return showAddFlatConfirmation(ctx, sess);
    }
    if (mode === 1) {
      session.updateSession(user.user_id, { step: 'tariff_electricity_single' });
      return ctx.reply('Введите тариф за кВт·ч:');
    }
    if (mode === 2) {
      session.updateSession(user.user_id, { step: 'tariff_electricity_tiered' });
      return ctx.reply('Введите 5 чисел через пробел: порог1 тариф1 порог2 тариф2 тариф3:');
    }
    return ctx.reply('Введите 1, 2 или 0:');
  }

  if (sess.step === 'tariff_electricity_single') {
    const n = parseNumber(text);
    if (n === null || n < 0) return ctx.reply('Некорректное значение. Введите неотрицательное число:');
    sess.tariffData.electricity_threshold1 = 999999;
    sess.tariffData.electricity_tariff1 = n;
    sess.tariffData.electricity_threshold2 = 999999;
    sess.tariffData.electricity_tariff2 = 0;
    sess.tariffData.electricity_tariff3 = 0;
    session.updateSession(user.user_id, { tariffData: sess.tariffData, step: 'confirm' });
    return showAddFlatConfirmation(ctx, sess);
  }

  if (sess.step === 'tariff_electricity_tiered') {
    const parts = text.split(/\s+/).map(s => s.replace(',', '.'));
    if (parts.length !== 5) return ctx.reply('Нужно 5 чисел. Введите: порог1 тариф1 порог2 тариф2 тариф3:');
    const [th1, t1, th2, t2, t3] = parts.map(p => parseNumber(p));
    if ([th1, t1, th2, t2, t3].some(n => n === null || n < 0)) return ctx.reply('Некорректные значения. Введите 5 чисел:');
    if (th1 >= th2) return ctx.reply('Порог1 должен быть меньше Порога2. Введите заново:');
    sess.tariffData.electricity_threshold1 = th1;
    sess.tariffData.electricity_tariff1 = t1;
    sess.tariffData.electricity_threshold2 = th2;
    sess.tariffData.electricity_tariff2 = t2;
    sess.tariffData.electricity_tariff3 = t3;
    session.updateSession(user.user_id, { tariffData: sess.tariffData, step: 'confirm' });
    return showAddFlatConfirmation(ctx, sess);
  }

  if (sess.step === 'confirm') {
    if (text.toLowerCase() === 'да' || text === '✅ да' || text.toLowerCase() === 'подтвердить') {
      await createFlatFinal(ctx, user, sess, true);
    } else {
      session.clearSession(user.user_id);
      await ctx.reply('❌ Создание квартиры отменено.', keyboards.adminMainMenu());
    }
    return;
  }
}

function showAddFlatConfirmation(ctx, sess) {
  let msg = `Проверьте данные:\n\n`;
  msg += `Название: ${sess.flatName}\n`;
  msg += `Начальный баланс: ${sess.initialBalance || 0}\n`;
  if (sess.initialReadings) {
    msg += `Начальные показания: эл=${sess.initialReadings.elec}, вода=${sess.initialReadings.water}, газ=${sess.initialReadings.gas}\n`;
  }
  const td = sess.tariffData || {};
  msg += `\nТарифы:\n`;
  msg += `  Вода: ${td.water || 0} руб./м³\n`;
  msg += `  Газ: ${td.gas || 0} руб./м³\n`;
  msg += `  ТКО: ${td.tko || 0} руб.\n`;
  msg += `  УК: ${td.uk || 0} руб.\n`;
  msg += `  Капремонт: ${td.caprepair || 0} руб.\n`;
  msg += `  Аренда: ${td.rent_enabled ? formatMoneyShort(td.rent_amount) : 'выключена'}\n`;
  if (td.electricity_tariff1 || td.electricity_tariff2 || td.electricity_tariff3) {
    if (td.electricity_tariff2 === 0 && td.electricity_tariff3 === 0) {
      msg += `  Электричество: ${td.electricity_tariff1} руб./кВт·ч (одноставочный)\n`;
    } else {
      msg += `  Электричество: пороги ${td.electricity_threshold1}/${td.electricity_threshold2}, тарифы ${td.electricity_tariff1}/${td.electricity_tariff2}/${td.electricity_tariff3}\n`;
    }
  } else {
    msg += `  Электричество: отключено\n`;
  }
  msg += `\nПодтвердить создание? (да/нет)`;
  return ctx.reply(msg);
}

async function createFlatFinal(ctx, user, sess, withTariffs) {
  const flat = await queries.createFlat(sess.flatName, user.user_id, sess.initialBalance || 0);

  // If initial balance is non-zero, create an initial transaction
  if (sess.initialBalance && Math.abs(sess.initialBalance) > 0.001) {
    await queries.createInitialBalanceTransaction(flat.id, sess.initialBalance, user.user_id);
  }

  if (withTariffs && sess.tariffData) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayStr = firstDay.toISOString().split('T')[0];
    await queries.createTariffRecord(flat.id, sess.tariffData, firstDayStr);

    // Set rent if specified
    if (sess.tariffData.rent_enabled) {
      await queries.setRent(flat.id, true, sess.tariffData.rent_amount || 0);
    }
  }

  // Save initial meter readings if provided
  if (sess.initialReadings) {
    await queries.setInitialReadings(flat.id, sess.initialReadings.elec, sess.initialReadings.water, sess.initialReadings.gas);
  }

  await queries.setSelectedFlat(user.user_id, flat.id);
  session.clearSession(user.user_id);
  await ctx.reply(`✅ Квартира «${sess.flatName}» создана (№${flat.id}). Она выбрана как активная.`, keyboards.adminMainMenu());
}

// /select_flat
async function selectFlat(ctx, user) {
  const arg = ctx.message.text.replace(/^\/select_flat\s*/i, '').trim();
  if (!arg) {
    const flats = await queries.listFlatsForAdmin(user.user_id);
    if (!flats.length) return ctx.reply('У вас нет квартир.');
    const list = flats.map(f => `${f.id}. ${f.name}`).join('\n');
    return ctx.reply(`Выберите квартиру:\n${list}\n\nИспользуйте /select_flat <номер>`, keyboards.flatListKeyboard(flats));
  }
  const flatId = parseInt(arg);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) {
    return ctx.reply('Квартира не найдена.');
  }
  await queries.setSelectedFlat(user.user_id, flatId);
  const balance = await queries.getBalance(flatId);
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`);
}

// /flats
async function listFlats(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  if (!flats.length) return ctx.reply('У вас нет квартир.');
  let msg = `Ваши квартиры:\n\n`;
  for (const f of flats) {
    const balance = await queries.getBalance(f.id);
    const balStr = balance > 0 ? `долг ${formatMoneyShort(balance)}` : balance < 0 ? `переплата ${formatMoneyShort(Math.abs(balance))}` : `0`;
    msg += `${f.id}. ${f.name} — ${balStr}\n`;
  }
  await ctx.reply(msg);
}

// /deleteflat — with confirmation (v4.0: any balance allowed)
async function deleteFlatCmd(ctx, user) {
  const arg = ctx.message.text.replace(/^\/deleteflat\s*/i, '').trim();
  if (!arg) return ctx.reply('Укажите номер квартиры: /deleteflat <номер>');
  const flatId = parseInt(arg);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) {
    return ctx.reply('Квартира не найдена.');
  }
  const balance = await queries.getBalance(flatId);
  let msg = `⚠️ Вы собираетесь удалить квартиру «${flat.name}» (№${flat.id}).\n`;
  if (Math.abs(balance) > 0.001) {
    msg += `Внимание: сальдо не равно нулю (${formatMoney(balance)}). Все данные будут потеряны!\n`;
  }
  msg += `\nВсе связанные данные (показания, транзакции, тарифы, арендаторы) будут удалены.\n\nПодтвердите удаление:`;
  await ctx.reply(msg, keyboards.deleteConfirmKeyboard(flatId));
}

// /history
async function history(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');
  const txns = await queries.getTransactions(flatId);
  if (!txns.length) return ctx.reply('История пуста.');
  let msg = `История транзакций:\n\n`;
  for (const t of txns.slice(0, 30)) {
    const date = new Date(t.created_at).toLocaleDateString('ru-RU');
    const sign = t.type === 'accrual' || t.type === 'initial' ? '+' : '-';
    const typeLabel = t.type === 'accrual' ? 'Начисление' : t.type === 'initial' ? 'Нач.баланс' : 'Платёж';
    msg += `${date} | ${typeLabel} | ${sign}${formatMoneyShort(Math.abs(t.amount))} | ${t.month}\n`;
    if (t.description) msg += `   ${t.description.split('\n').join(' ')}\n`;
  }
  const balance = await queries.getBalance(flatId);
  msg += `\nТекущий баланс: ${formatMoney(balance)}`;
  await ctx.reply(msg);
}

// /stats
async function stats(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');
  const flat = await queries.getFlat(flatId);
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

// /invite_tenant
async function inviteTenant(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру: /select_flat <номер>');

  if (user.role !== 'super_admin') {
    const sub = await queries.getSubscription(user.user_id);
    if (queries.isTrialSubscription(sub)) {
      const tenantCount = await queries.countTenantsForAdmin(user.user_id);
      if (tenantCount >= 2) {
        return ctx.reply('Пробный период позволяет пригласить не более 2 арендаторов. Оформите подписку для снятия ограничений.');
      }
    }
  }

  const token = await queries.createInviteToken('tenant', flatId);
  const link = `https://t.me/${config.BOT_USERNAME}?start=${token.token}`;
  let msg = `🔗 Ссылка-приглашение для арендатора:\n${link}\n\n`;
  msg += `Срок действия ссылки: 7 дней.\n`;
  msg += `Доступ арендатора бессрочный (до удаления администратором).`;
  await ctx.reply(msg);
}

// /removeuser
async function removeUser(ctx, user) {
  const targetId = parseInt(ctx.message.text.replace(/^\/removeuser\s*/i, '').trim());
  if (!targetId) return ctx.reply('Укажите Telegram ID: /removeuser <TelegramID>');
  const targetUser = await queries.getUser(targetId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role === 'super_admin') return ctx.reply('Нельзя удалить суперадминистратора.');

  if (targetUser.role === 'tenant') {
    if (user.role === 'admin') {
      const flat = await queries.getFlat(targetUser.flat_id);
      if (!flat || flat.admin_user_id !== user.user_id) {
        return ctx.reply('Этот арендатор не принадлежит вашим квартирам.');
      }
    }
    await queries.deleteUser(targetId);
    await ctx.reply(`✅ Арендатор ${targetId} удалён из базы данных. Показания и транзакции сохранены в истории квартиры.`);
  } else {
    await ctx.reply('Можно удалять только арендаторов.');
  }
}

// /listusers
async function listUsers(ctx, user) {
  if (user.role === 'super_admin') {
    const allUsers = await queries.listAllUsers();
    let msg = `Все пользователи (${allUsers.length}):\n\n`;
    for (const u of allUsers.slice(0, 50)) {
      msg += `${u.user_id} | ${u.role} | flat=${u.flat_id || '—'} | active=${u.is_active ? 'yes' : 'no'}\n`;
    }
    return ctx.reply(msg);
  }
  const users = await queries.listUsersForAdmin(user.user_id);
  if (!users.length) return ctx.reply('В ваших квартирах нет арендаторов.');
  let msg = `Арендаторы ваших квартир:\n\n`;
  for (const u of users) {
    const flat = await queries.getFlat(u.flat_id);
    msg += `${u.user_id} | кв.${u.flat_id} ${flat?.name || ''} | ${u.is_active ? 'активен' : 'деактивирован'}\n`;
  }
  await ctx.reply(msg);
}

// /subscribe
async function subscribeInfo(ctx, user) {
  const sub = await queries.getSubscription(user.user_id);
  if (!sub) return ctx.reply('Подписка не найдена. Обратитесь к суперадминистратору.');
  const active = queries.isSubscriptionActive(sub);
  const count = await queries.countFlatsForAdmin(user.user_id);
  let msg = `Информация о подписке:\n\n`;
  msg += `Статус: ${active ? '✅ Активна' : '❌ Истекла'}\n`;
  msg += `Дата окончания: ${formatDate(sub.end_date)}\n`;
  msg += `Лимит квартир: ${sub.max_flats}\n`;
  msg += `Использовано квартир: ${count}\n`;
  if (!active) {
    msg += `\n⚠️ Подписка истекла. Данные хранятся 3 месяца, затем будут удалены.\n`;
    msg += `Используйте /support для связи с поддержкой.`;
  }
  await ctx.reply(msg);
}

// /toggle_rent
async function toggleRent(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const flat = await queries.getFlat(flatId);
  const newState = !flat.rent_enabled;
  await queries.setRent(flatId, newState, flat.rent_amount);
  await ctx.reply(`Учёт аренды ${newState ? 'включён' : 'выключен'} для квартиры «${flat.name}».${newState ? ' Установите сумму: /set_rent <сумма>' : ''}`);
}

// /set_rent
async function setRent(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const amount = parseNumber(ctx.message.text.replace(/^\/set_rent\s*/i, '').trim());
  if (amount === null || amount < 0) return ctx.reply('Укажите корректную сумму: /set_rent <сумма>');
  await queries.setRent(flatId, true, round2(amount));
  await ctx.reply(`Сумма аренды установлена: ${formatMoneyShort(amount)} руб./мес.`);
}

// /pay
async function pay(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const balance = await queries.getBalance(flatId);
  const flat = await queries.getFlat(flatId);
  session.setSession(user.user_id, {
    flow: 'payment',
    flatId,
    flatName: flat.name,
  });
  let msg = `Квартира: ${flat.name}\nТекущий баланс: ${formatMoney(balance)}\n\n`;
  msg += balance > 0 ? `Задолженность арендатора.\n` : balance < 0 ? `Переплата (предоплата).\n` : `Баланс нулевой.\n`;
  msg += `Введите сумму полученного платежа (число):`;
  await ctx.reply(msg, keyboards.removeKeyboard());
}

// /set_initial_readings
async function setInitialReadings(ctx, user) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const parts = ctx.message.text.split(/\s+/).slice(1);
  if (parts.length < 3) {
    return ctx.reply('Использование: /set_initial_readings <электричество> <вода> <газ>');
  }
  const [elec, water, gas] = parts.map(normalizeNumber);
  if ([elec, water, gas].some(n => n === null || n < 0)) {
    return ctx.reply('Все значения должны быть положительными числами.');
  }
  await queries.setInitialReadings(flatId, elec, water, gas);
  await ctx.reply(`✅ Начальные показания установлены:\nЭлектричество: ${elec}\nВода: ${water}\nГаз: ${gas}`);
}

// Handle payment input
async function handlePaymentInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const amount = parseNumber(ctx.message.text.trim());
  if (amount === null || amount <= 0) {
    session.clearSession(user.user_id);
    return ctx.reply('Некорректная сумма. Попробуйте снова: /pay', keyboards.adminMainMenu());
  }
  const flat = await queries.getFlat(sess.flatId);
  if (!flat || flat.admin_user_id !== user.user_id) {
    session.clearSession(user.user_id);
    return ctx.reply('Квартира не найдена или не принадлежит вам. Попробуйте снова: /pay', keyboards.adminMainMenu());
  }
  const mk = monthKey();
  await queries.createPayment(sess.flatId, mk, amount, user.user_id);
  const balance = await queries.getBalance(sess.flatId);
  session.clearSession(user.user_id);
  await ctx.reply(
    `✅ Платёж ${formatMoneyShort(amount)} внесён.\nНовый баланс: ${formatMoney(balance)}`,
    keyboards.adminMainMenu()
  );

  // Notify all active tenants of this flat
  const tenants = await queries.getTenantsForFlat(sess.flatId);
  for (const tenant of tenants) {
    try {
      await ctx.telegram.sendMessage(
        tenant.user_id,
        `💰 Внесён платёж на сумму ${formatMoneyShort(amount)} руб.\nНовый баланс: ${formatMoney(balance)} руб.`
      );
    } catch (e) { /* tenant may have blocked bot or left chat */ }
  }
}

// Handle tariff change via menu buttons
async function handleTariffChange(ctx, user, tariffType) {
  const flatId = user.selected_flat_id;
  if (!flatId) return ctx.reply('Сначала выберите квартиру.');
  const flat = await queries.getFlat(flatId);
  const tariff = await queries.getCurrentTariff(flatId);

  session.setSession(user.user_id, {
    flow: 'tariff_change',
    tariffType,
    flatId,
    flatName: flat.name,
  });

  let prompt = '';
  switch (tariffType) {
    case 'water':
      prompt = `Текущий тариф воды: ${tariff?.water || 0} руб./м³\nВведите новое значение:`;
      break;
    case 'gas':
      prompt = `Текущий тариф газа: ${tariff?.gas || 0} руб./м³\nВведите новое значение:`;
      break;
    case 'tko':
      prompt = `Текущий ТКО: ${tariff?.tko || 0} руб.\nВведите новое значение:`;
      break;
    case 'uk':
      prompt = `Текущий УК: ${tariff?.uk || 0} руб.\nВведите новое значение:`;
      break;
    case 'caprepair':
      prompt = `Текущий капремонт: ${tariff?.caprepair || 0} руб.\nВведите новое значение:`;
      break;
    case 'electricity':
      prompt = `Текущие пороги и тарифы:\n`;
      prompt += `  Порог1: ${tariff?.electricity_threshold1 || 150}, Тариф1: ${tariff?.electricity_tariff1 || 0}\n`;
      prompt += `  Порог2: ${tariff?.electricity_threshold2 || 800}, Тариф2: ${tariff?.electricity_tariff2 || 0}\n`;
      prompt += `  Тариф3: ${tariff?.electricity_tariff3 || 0}\n\n`;
      prompt += `Введите 5 чисел через пробел (порог1 тариф1 порог2 тариф2 тариф3)\n`;
      prompt += `или одно число для единого тарифа:`;
      break;
  }
  await ctx.reply(prompt, keyboards.removeKeyboard());
}

// Handle tariff input (second step: date)
async function handleTariffInput(ctx, user) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.tariffType === 'electricity') {
    const parts = text.split(/\s+/).map(n => n.replace(',', '.'));
    let tariffData;
    if (parts.length === 1) {
      const unified = parseNumber(parts[0]);
      if (unified === null || unified < 0) {
        session.clearSession(user.user_id);
        return ctx.reply('Некорректное значение. Попробуйте снова через меню.', keyboards.adminMainMenu());
      }
      tariffData = {
        electricity_threshold1: 999999,
        electricity_tariff1: unified,
        electricity_threshold2: 999999,
        electricity_tariff2: 0,
        electricity_tariff3: 0,
      };
    } else if (parts.length === 5) {
      const [th1, t1, th2, t2, t3] = parts.map(p => parseNumber(p));
      if ([th1, t1, th2, t2, t3].some(n => n === null || n < 0)) {
        session.clearSession(user.user_id);
        return ctx.reply('Некорректные значения. Попробуйте снова.', keyboards.adminMainMenu());
      }
      if (th1 >= th2) {
        return ctx.reply('❌ Порог1 должен быть меньше Порога2. Введите заново:');
      }
      tariffData = {
        electricity_threshold1: th1,
        electricity_tariff1: t1,
        electricity_threshold2: th2,
        electricity_tariff2: t2,
        electricity_tariff3: t3,
      };
    } else {
      session.clearSession(user.user_id);
      return ctx.reply('Введите 5 чисел или 1 число. Попробуйте снова через меню.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { tariffData });
  } else {
    const value = parseNumber(text);
    if (value === null || value < 0) {
      session.clearSession(user.user_id);
      return ctx.reply('Некорректное значение. Попробуйте снова через меню.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { tariffData: { [sess.tariffType]: value } });
  }

  session.updateSession(user.user_id, { step: 'tariff_date' });
  await ctx.reply('Теперь укажите дату начала действия тарифа (ДД.ММ.ГГГГ):');
}

// Handle tariff date input
async function handleTariffDate(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  const isoDate = parseDateInput(text);
  if (!isoDate) {
    return ctx.reply('Некорректный формат даты. Используйте ДД.ММ.ГГГГ:');
  }

  const effectiveDate = toFirstDayOfMonth(isoDate);

  if (!isCurrentOrFutureMonth(effectiveDate)) {
    return ctx.reply('❌ Дата не может быть раньше первого числа текущего месяца. Введите снова:');
  }

  const currentTariff = await queries.getCurrentTariff(sess.flatId);
  const merged = {
    water: currentTariff?.water || 0,
    electricity_threshold1: currentTariff?.electricity_threshold1 || 150,
    electricity_tariff1: currentTariff?.electricity_tariff1 || 0,
    electricity_threshold2: currentTariff?.electricity_threshold2 || 800,
    electricity_tariff2: currentTariff?.electricity_tariff2 || 0,
    electricity_tariff3: currentTariff?.electricity_tariff3 || 0,
    gas: currentTariff?.gas || 0,
    tko: currentTariff?.tko || 0,
    uk: currentTariff?.uk || 0,
    caprepair: currentTariff?.caprepair || 0,
    ...sess.tariffData,
  };

  await queries.createTariffRecord(sess.flatId, merged, effectiveDate);
  session.clearSession(user.user_id);
  await ctx.reply(`✅ Тариф обновлён с ${formatDate(effectiveDate)}.`, keyboards.adminMainMenu());

  // Notify tenants and landlord about tariff change (Principle 6)
  await notifyTariffChange(ctx, sess.flatId, sess.tariffType, currentTariff, merged, effectiveDate, bot);
}

// Send tariff change notifications (Principle 6)
async function notifyTariffChange(ctx, flatId, tariffType, oldTariff, newTariffData, effectiveDate, bot) {
  const flat = await queries.getFlat(flatId);
  const tariffLabels = {
    water: 'Вода',
    gas: 'Газ',
    tko: 'ТКО',
    uk: 'УК',
    caprepair: 'Капремонт',
    electricity: 'Электричество',
  };
  const label = tariffLabels[tariffType] || tariffType;

  let oldVal, newVal;
  if (tariffType === 'electricity') {
    oldVal = `тариф1=${oldTariff?.electricity_tariff1 || 0}, тариф2=${oldTariff?.electricity_tariff2 || 0}, тариф3=${oldTariff?.electricity_tariff3 || 0}`;
    newVal = `тариф1=${newTariffData.electricity_tariff1}, тариф2=${newTariffData.electricity_tariff2}, тариф3=${newTariffData.electricity_tariff3}`;
  } else {
    oldVal = `${oldTariff?.[tariffType] || 0} руб.`;
    newVal = `${newTariffData[tariffType] || 0} руб.`;
  }

  const now = new Date();
  const effective = new Date(effectiveDate);
  const isCurrentMonth = effective.getFullYear() === now.getFullYear() && effective.getMonth() === now.getMonth();

  let msg = `🔔 Изменение тарифа: ${label}\n`;
  msg += `Квартира: ${flat.name} (№${flat.id})\n`;
  msg += `Дата начала: ${formatDate(effectiveDate)}\n`;
  msg += `Старый тариф: ${oldVal}\n`;
  msg += `Новый тариф: ${newVal}\n\n`;

  if (isCurrentMonth) {
    msg += `⚠️ Смена тарифа в текущем месяце.\n`;
    msg += `Рекомендуется передать показания до даты смены, чтобы избежать интервального расчёта.\n`;
    msg += `Если показания будут переданы только после смены, весь месяц будет рассчитан по новому тарифу.`;
  } else {
    msg += `Текущий месяц рассчитывается без изменений.\n`;
    msg += `Рекомендуется заранее подготовиться к смене тарифа.`;
  }

  // Notify landlord
  if (flat.admin_user_id) {
    try { await ctx.telegram.sendMessage(flat.admin_user_id, msg); } catch (e) { /* ignore */ }
  }

  // Notify all active tenants
  const tenants = await queries.getTenantsForFlat(flatId);
  for (const tenant of tenants) {
    try { await ctx.telegram.sendMessage(tenant.user_id, msg); } catch (e) { /* ignore */ }
  }
}

async function summary(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  if (!flats.length) return ctx.reply('У вас нет квартир.');

  let totalDebt = 0;
  let totalOverpay = 0;
  let msg = `📊 Сводка по вашим квартирам:\n\n`;
  for (const f of flats) {
    const balance = await queries.getBalance(f.id);
    if (balance > 0) totalDebt += balance;
    else totalOverpay += Math.abs(balance);
    const balStr = balance > 0 ? `долг ${formatMoneyShort(balance)}` : balance < 0 ? `переплата ${formatMoneyShort(Math.abs(balance))}` : `0`;
    const tenants = await queries.getTenantsForFlat(f.id);
    msg += `${f.id}. ${f.name} — ${balStr} (арендаторов: ${tenants.length})\n`;
  }
  msg += `\nОбщий долг: ${formatMoney(totalDebt)}\n`;
  msg += `Общая переплата: ${formatMoney(totalOverpay)}\n`;
  msg += `Всего квартир: ${flats.length}`;
  await ctx.reply(msg);
}

module.exports = {
  adminStart,
  adminHelp,
  addFlat,
  handleAddFlatInput,
  selectFlat,
  listFlats,
  deleteFlatCmd,
  history,
  stats,
  summary,
  inviteTenant,
  removeUser,
  listUsers,
  subscribeInfo,
  toggleRent,
  setRent,
  pay,
  setInitialReadings,
  handlePaymentInput,
  handleTariffChange,
  handleTariffInput,
  handleTariffDate,
  notifyTariffChange,
};
