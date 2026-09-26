// Super-admin command handlers
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
const adminCmd = require('./admin');

async function superAdminStart(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let selectedFlat = null;
  if (user.selected_flat_id) {
    selectedFlat = await queries.getFlat(user.selected_flat_id);
  }
  if (!selectedFlat && flats.length > 0) {
    selectedFlat = flats[0];
    await queries.setSelectedFlat(user.user_id, selectedFlat.id);
  }

  let msg = `Здравствуйте, суперадминистратор!\n\n`;
  msg += `Активная квартира: ${selectedFlat ? `${selectedFlat.id}. ${selectedFlat.name}` : 'не выбрана'}\n`;
  msg += `Всего квартир: ${flats.length}\n\n`;
  msg += `Управление квартирами (без ограничений):\n`;
  msg += `/addflat — создать квартиру\n`;
  msg += `/select_flat <номер> — выбрать квартиру\n`;
  msg += `/flats — список квартир\n`;
  msg += `/deleteflat <номер> — удалить квартиру\n`;
  msg += `/history — история транзакций\n`;
  msg += `/stats — тарифы и показания\n`;
  msg += `/summary — сводка по квартирам\n`;
  msg += `/invite_tenant — пригласить арендатора\n`;
  msg += `/listusers — список пользователей\n`;
  msg += `/removeuser <ID> — удалить пользователя (арендатора или арендодателя)\n`;
  msg += `/toggle_user <ID> — активировать/деактивировать учётную запись\n`;
  msg += `/reply <ID> <текст> — ответить пользователю через поддержку\n`;
  msg += `/toggle_rent — включить/выключить аренду\n`;
  msg += `/set_rent <сумма> — установить аренду\n`;
  msg += `/pay — внести платёж\n`;
  msg += `/submit или кнопка «Ввести показания» — ввести показания (если арендатор не в боте)\n`;
  msg += `/set_initial_readings <эл> <вода> <газ> — начальные показания\n\n`;
  msg += `Управление арендодателями:\n`;
  msg += `/add_admin — добавить арендодателя вручную\n`;
  msg += `/invite_admin — ссылка-приглашение для арендодателя\n`;
  msg += `/list_admins — список арендодателей\n`;
  msg += `/manage_subscription <user_id> <ДД.ММ.ГГГГ> <max_flats> — управление подпиской\n\n`;
  msg += `/globalstats — общая статистика\n`;
  msg += `/backup — резервная копия БД\n`;
  msg += `/cancel — отменить текущее действие\n`;
  msg += `/help — подробная инструкция`;
  await ctx.reply(msg, keyboards.adminMainMenu());
}

async function superAdminHelp(ctx) {
  let msg = `📋 Инструкция для суперадминистратора

🏠 Квартиры (без ограничений подписки):
• /addflat — создать квартиру (диалог: название, баланс, тарифы)
• /select_flat <номер> — выбрать активную квартиру
• /flats — список квартир с балансами
• /deleteflat <номер> — удалить квартиру (с подтверждением)

⚙️ Тарифы (через кнопки меню):
• Изменение тарифа требует дату начала действия (ДД.ММ.ГГГГ)
• Если тариф = 0, показания не запрашиваются
• Электричество: 5 чисел (порог1 тариф1 порог2 тариф2 тариф3) или одно число

📊 Показания и расчёты:
• /submit или кнопка «Ввести показания» — ввести показания (если арендатор не в боте)
• /set_initial_readings <эл> <вода> <газ> — начальные показания
• /stats — текущие тарифы и показания
• /summary — сводка по квартирам и общая статистика
• /history — история начислений и платежей

👥 Арендаторы и пользователи:
• /invite_tenant — ссылка-приглашение
• /listusers — список пользователей
• /removeuser <TelegramID> — удалить пользователя (арендатора или арендодателя вместе с квартирами)
• /toggle_user <TelegramID> — активировать/деактивировать учётную запись

📨 Поддержка:
• /reply <TelegramID> <текст> — ответить пользователю через бота

💰 Платежи:
• /pay — внести платёж
• /toggle_rent — включить/выключить аренду
• /set_rent <сумма> — установить сумму аренды

🏢 Арендодатели:
• /add_admin — добавить вручную
• /invite_admin — ссылка-приглашение (можно сразу указать параметры подписки)
• /list_admins — список с подписками
• /manage_subscription <user_id> <ДД.ММ.ГГГГ> <max_flats> — управление

📊 /globalstats — общая статистика
💾 /backup — резервная копия
📨 /support — входящие обращения пользователей
❌ /cancel — отменить любое незавершённое действие`;
  await ctx.reply(msg);
}

// ---- Flat management (unrestricted) ----

async function addFlat(ctx, user) {
  // Super admin: no subscription check, use same multi-step dialog
  return adminCmd.addFlat(ctx, user);
}

// Handle add_flat dialog (delegate to admin)
async function handleAddFlatInput(ctx, user, bot) {
  return adminCmd.handleAddFlatInput(ctx, user, bot);
}

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
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`, keyboards.adminMainMenu());
}

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
  msg += `\nВсе связанные данные будут удалены.\n\nПодтвердите удаление:`;
  await ctx.reply(msg, keyboards.deleteConfirmKeyboard(flatId));
}

async function history(ctx, user) {
  return adminCmd.history(ctx, user);
}

async function stats(ctx, user) {
  return adminCmd.stats(ctx, user);
}

async function inviteTenant(ctx, user) {
  return adminCmd.inviteTenant(ctx, user);
}

async function removeUser(ctx, user) {
  const targetId = parseInt(ctx.message.text.replace(/^\/removeuser\s*/i, '').trim());
  if (!targetId) return ctx.reply('Укажите Telegram ID: /removeuser <TelegramID>');
  const targetUser = await queries.getUser(targetId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role === 'super_admin') return ctx.reply('Нельзя удалить суперадминистратора.');

  if (targetUser.role === 'admin') {
    await queries.deleteUserAndData(targetId);
    await ctx.reply(`✅ Арендодатель ${targetId} и все его квартиры удалены из базы данных.`);
  } else {
    await queries.deleteUser(targetId);
    await ctx.reply(`✅ Арендатор ${targetId} удалён из базы данных. Показания и транзакции сохранены в истории квартиры.`);
  }
}

async function toggleUser(ctx, user) {
  const targetId = parseInt(ctx.message.text.replace(/^\/toggle_user\s*/i, '').trim());
  if (!targetId) return ctx.reply('Укажите Telegram ID: /toggle_user <TelegramID>');
  const targetUser = await queries.getUser(targetId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role === 'super_admin') return ctx.reply('Нельзя изменить статус суперадминистратора.');

  const updated = await queries.toggleUserActive(targetId);
  const status = updated.is_active ? 'активна' : 'неактивна';
  await ctx.reply(`✅ Учётная запись ${targetId} теперь ${status}.`);
  try {
    await ctx.telegram.sendMessage(
      targetId,
      updated.is_active
        ? '✅ Ваша учётная запись активирована. Все функции снова доступны.'
        : '⚠️ Ваша учётная запись деактивирована администратором. Доступ к функциям бота приостановлен.'
    );
  } catch (e) { /* ignore */ }
}

async function replyToUser(ctx, user) {
  const text = ctx.message.text.replace(/^\/reply\s*/i, '');
  const match = text.match(/^(\d+)\s+([\s\S]+)$/);
  if (!match) {
    return ctx.reply('Использование: /reply <TelegramID> <текст сообщения>');
  }
  const targetId = parseInt(match[1]);
  const replyText = match[2].trim();
  if (!replyText) return ctx.reply('Текст сообщения не может быть пустым.');

  const targetUser = await queries.getUser(targetId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');

  try {
    await ctx.telegram.sendMessage(
      targetId,
      `📨 Ответ поддержки:\n\n${replyText}`
    );
    await ctx.reply(`✅ Ответ отправлен пользователю ${targetId}.`);
  } catch (e) {
    await ctx.reply('Не удалось отправить ответ. Возможно, пользователь заблокировал бота.');
  }
}

async function listUsers(ctx, user) {
  return adminCmd.listUsers(ctx, user);
}

async function toggleRent(ctx, user) {
  return adminCmd.toggleRent(ctx, user);
}

async function setRent(ctx, user) {
  return adminCmd.setRent(ctx, user);
}

async function pay(ctx, user) {
  return adminCmd.pay(ctx, user);
}

async function setInitialReadings(ctx, user) {
  return adminCmd.setInitialReadings(ctx, user);
}

// ---- Landlord management ----

async function addAdmin(ctx, user) {
  session.setSession(user.user_id, { flow: 'add_admin', step: 'user_id' });
  await ctx.reply('Введите Telegram ID нового арендодателя:', keyboards.removeKeyboard());
}

// /invite_admin — multi-step: optional end date and max flats
async function inviteAdmin(ctx, user) {
  session.setSession(user.user_id, { flow: 'invite_admin', step: 'end_date' });
  await ctx.reply(
    'Создание приглашения для арендодателя.\n' +
    'Введите дату окончания подписки (ДД.ММ.ГГГГ) или «пропустить»:',
    keyboards.removeKeyboard()
  );
}

async function handleInviteAdminInput(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.step === 'end_date') {
    let endDate = null;
    if (text.toLowerCase() !== 'пропустить') {
      const iso = parseDateInput(text);
      if (!iso) return ctx.reply('Некорректный формат даты. Используйте ДД.ММ.ГГГГ или «пропустить»:');
      endDate = iso;
    }
    session.updateSession(user.user_id, { step: 'max_flats', subEndDate: endDate });
    return ctx.reply('Введите максимальное количество квартир (или «пропустить»):');
  }

  if (sess.step === 'max_flats') {
    let maxFlats = null;
    if (text.toLowerCase() !== 'пропустить') {
      const n = parseInt(text);
      if (isNaN(n) || n < 1) return ctx.reply('Введите целое число больше 0 или «пропустить»:');
      maxFlats = n;
    }
    const token = await queries.createInviteToken('admin', null, sess.subEndDate, maxFlats);
    const link = `https://t.me/${config.BOT_USERNAME}?start=${token.token}`;
    session.clearSession(user.user_id);
    let msg = `🔗 Ссылка-приглашение для арендодателя:\n${link}\n\nСрок действия: 7 дней.\n`;
    if (sess.subEndDate || maxFlats) {
      msg += `Параметры подписки:\n`;
      if (sess.subEndDate) msg += `  До: ${formatDate(sess.subEndDate)}\n`;
      if (maxFlats) msg += `  Лимит квартир: ${maxFlats}\n`;
      msg += `Они будут применены при регистрации.`;
    } else {
      msg += `После регистрации используйте /manage_subscription для настройки подписки.`;
    }
    await ctx.reply(msg, keyboards.adminMainMenu());
  }
}

async function listAdmins(ctx, user) {
  const subs = await queries.listAllSubscriptions();
  if (!subs.length) return ctx.reply('Нет арендодателей.');
  let msg = `Арендодатели:\n\n`;
  for (const s of subs) {
    const flatCount = await queries.countFlatsForAdmin(s.admin_user_id);
    const active = queries.isSubscriptionActive(s);
    msg += `ID: ${s.admin_user_id} | ${active ? '✅' : '❌'} | до ${formatDate(s.end_date)} | квартир: ${flatCount}/${s.max_flats}\n`;
  }
  await ctx.reply(msg);
}

async function manageSubscription(ctx, user) {
  const parts = ctx.message.text.split(/\s+/);
  if (parts.length < 4) {
    return ctx.reply('Использование: /manage_subscription <user_id> <ДД.ММ.ГГГГ> <max_flats>');
  }
  const targetUserId = parseInt(parts[1]);
  const endDate = parseDateInput(parts[2]);
  const maxFlats = parseInt(parts[3]);
  if (!targetUserId || !endDate || isNaN(maxFlats) || maxFlats < 1) {
    return ctx.reply('Некорректные данные. Формат: /manage_subscription <user_id> <ДД.ММ.ГГГГ> <max_flats>');
  }
  const targetUser = await queries.getUser(targetUserId);
  if (!targetUser) return ctx.reply('Пользователь не найден.');
  if (targetUser.role !== 'admin') return ctx.reply('Пользователь не является арендодателем.');

  const existing = await queries.getSubscription(targetUserId);
  if (existing) {
    await queries.updateSubscription(targetUserId, endDate, maxFlats);
  } else {
    await queries.createSubscription(targetUserId, endDate, maxFlats);
  }
  await ctx.reply(`✅ Подписка обновлена для ${targetUserId}:\nДо: ${formatDate(endDate)}\nЛимит квартир: ${maxFlats}`);
  try {
    await ctx.telegram.sendMessage(
      targetUserId,
      `🔔 Ваша подписка обновлена:\nДо: ${formatDate(endDate)}\nЛимит квартир: ${maxFlats}\n\nВсе функции снова доступны.`
    );
  } catch (e) { /* ignore */ }
}

async function superAdminStats(ctx, user) {
  const stats = await queries.getGlobalStats();
  let msg = `📊 Общая статистика\n\n`;
  msg += `Арендодателей: ${stats.adminCount}\n`;
  msg += `Квартир: ${stats.flatCount}\n`;
  msg += `Активных подписок: ${stats.activeSubs}\n`;
  msg += `Общая задолженность: ${formatMoney(stats.totalDebt)}`;
  await ctx.reply(msg);
}

async function summary(ctx, user) {
  const flats = await queries.listFlatsForAdmin(user.user_id);
  let msg = `📊 Сводка по вашим квартирам:\n\n`;
  if (flats.length === 0) {
    msg += `У вас нет квартир.\n\n`;
  } else {
    let totalDebt = 0;
    let totalOverpay = 0;
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
  }
  const stats = await queries.getGlobalStats();
  msg += `\n📊 Общая статистика по системе:\n`;
  msg += `Арендодателей: ${stats.adminCount}\n`;
  msg += `Квартир: ${stats.flatCount}\n`;
  msg += `Активных подписок: ${stats.activeSubs}\n`;
  msg += `Общая задолженность: ${formatMoney(stats.totalDebt)}`;
  await ctx.reply(msg);
}

// ---- Session input handlers ----

async function handleAddAdminInput(ctx, user, bot) {
  const sess = session.getSession(user.user_id);
  const text = ctx.message.text.trim();

  if (sess.step === 'user_id') {
    const targetId = parseInt(text);
    if (!targetId) {
      return ctx.reply('Некорректный Telegram ID. Введите число:');
    }
    const existing = await queries.getUser(targetId);
    if (existing) {
      session.clearSession(user.user_id);
      return ctx.reply('Пользователь уже зарегистрирован. Используйте /manage_subscription.', keyboards.adminMainMenu());
    }
    session.updateSession(user.user_id, { step: 'end_date', targetId });
    return ctx.reply('Введите дату окончания подписки (ДД.ММ.ГГГГ):');
  }

  if (sess.step === 'end_date') {
    const iso = parseDateInput(text);
    if (!iso) {
      return ctx.reply('Некорректный формат даты. Используйте ДД.ММ.ГГГГ:');
    }
    session.updateSession(user.user_id, { step: 'max_flats', endDate: iso });
    return ctx.reply('Введите максимальное количество квартир:');
  }

  if (sess.step === 'max_flats') {
    const maxFlats = parseInt(text);
    if (isNaN(maxFlats) || maxFlats < 1) {
      return ctx.reply('Введите целое число больше 0:');
    }
    await queries.createUser(sess.targetId, 'admin');
    await queries.createSubscription(sess.targetId, sess.endDate, maxFlats);
    session.clearSession(user.user_id);
    await ctx.reply(
      `✅ Арендодатель добавлен.\nID: ${sess.targetId}\nПодписка до: ${formatDate(sess.endDate)}\nЛимит квартир: ${maxFlats}`,
      keyboards.adminMainMenu()
    );
    try {
      await bot.telegram.sendMessage(
        sess.targetId,
        `🔔 Вы зарегистрированы как арендодатель.\nПодписка до: ${formatDate(sess.endDate)}\nЛимит квартир: ${maxFlats}\n\nИспользуйте /start для начала работы.`
      );
    } catch (e) { /* ignore */ }
  }
}

// Delegate shared session handlers to admin module
async function handlePaymentInput(ctx, user) {
  return adminCmd.handlePaymentInput(ctx, user);
}

async function handleTariffChange(ctx, user, tariffType) {
  return adminCmd.handleTariffChange(ctx, user, tariffType);
}

async function handleTariffInput(ctx, user) {
  return adminCmd.handleTariffInput(ctx, user);
}

async function handleTariffDate(ctx, user, bot) {
  return adminCmd.handleTariffDate(ctx, user, bot);
}

module.exports = {
  superAdminStart,
  superAdminHelp,
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
  toggleUser,
  replyToUser,
  listUsers,
  toggleRent,
  setRent,
  pay,
  setInitialReadings,
  addAdmin,
  inviteAdmin,
  handleInviteAdminInput,
  listAdmins,
  manageSubscription,
  superAdminStats,
  handleAddAdminInput,
  handlePaymentInput,
  handleTariffChange,
  handleTariffInput,
  handleTariffDate,
};
