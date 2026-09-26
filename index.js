// Main entry point for the Telegram rental bot
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const config = require('./src/config');
const queries = require('./src/queries');
const auth = require('./src/auth');
const keyboards = require('./src/keyboards');
const session = require('./src/session');
const { formatMoney } = require('./src/utils');

const adminCmd = require('./src/commands/admin');
const tenantCmd = require('./src/commands/tenant');
const superCmd = require('./src/commands/superadmin');
const supportCmd = require('./src/commands/support');
const { setupScheduler } = require('./src/scheduler');
const { initSchema } = require('./src/schema');

if (!config.BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Set it in .env');
  process.exit(1);
}

if (!config.SETUP_KEY) {
  console.error('SETUP_KEY is required. Set it in .env');
  process.exit(1);
}

const bot = new Telegraf(config.BOT_TOKEN);

// ---- /start command ----
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const payload = ctx.startPayload || '';

  if (payload) {
    return handleInvite(ctx, payload);
  }

  const user = await queries.getUser(userId);
  if (!user) {
    const state = await queries.initBotState(config.SETUP_KEY);
    if (!state.setup_complete) {
      if (payload === state.setup_key) {
        await queries.createUser(userId, 'super_admin');
        await queries.setSuperAdmin(userId);
        return ctx.reply(
          '✅ Вы назначены суперадминистратором! Используйте /help для списка команд.',
          keyboards.adminMainMenu()
        );
      }
      session.setSession(userId, { flow: 'setup_key' });
      return ctx.reply(
        '🔧 Бот не настроен. Вы первый пользователь.\nВведите ключ настройки для получения прав суперадминистратора:',
        keyboards.removeKeyboard()
      );
    }
    // New user without invite — show trial welcome
    let msg = `🏠 Добро пожаловать в бот для управления арендой и коммунальными платежами!\n\n`;
    msg += `Этот бот поможет вам:\n`;
    msg += `✅ Автоматизировать сбор показаний счётчиков\n`;
    msg += `✅ Рассчитывать коммунальные платежи\n`;
    msg += `✅ Отслеживать баланс арендаторов\n`;
    msg += `✅ Вести учёт арендной платы\n\n`;
    msg += `Вы можете начать использовать бота прямо сейчас — пробный период 14 дней\n`;
    msg += `с полным функционалом: 1 квартира, до 2 арендаторов.\n\n`;
    msg += `👉 Нажмите «Начать 14-дневный пробный период», чтобы создать первую квартиру.`;
    return ctx.reply(msg, keyboards.trialStartKeyboard());
  }

  if (user.role === 'super_admin') return superCmd.superAdminStart(ctx, user);
  if (user.role === 'admin') return adminCmd.adminStart(ctx, user);
  if (user.role === 'tenant') {
    if (!auth.isTenantAccessValid(user)) {
      return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
    }
    return tenantCmd.tenantStart(ctx, user);
  }
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- Invite handling ----
async function handleInvite(ctx, tokenStr) {
  const userId = ctx.from.id;
  const token = await queries.getInviteToken(tokenStr);

  if (!token || token.used) {
    return ctx.reply('Ссылка недействительна или уже использована. По всем вопросам обращаться @Cheatgtp');
  }
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    return ctx.reply('Срок действия ссылки истёк. По всем вопросам обращаться @Cheatgtp');
  }

  const existing = await queries.getUser(userId);
  if (existing) {
    return ctx.reply('Вы уже зарегистрированы в системе. Используйте /start.');
  }

  if (token.role === 'admin') {
    await queries.createUser(userId, 'admin');
    await queries.markTokenUsed(token.id);
    // If subscription params were provided on the token, create subscription
    if (token.sub_end_date && token.sub_max_flats) {
      await queries.createSubscription(userId, token.sub_end_date, token.sub_max_flats);
    }
    await ctx.reply(
      '✅ Вы зарегистрированы как арендодатель! Используйте /start для начала работы.',
      keyboards.adminMainMenu()
    );
    const state = await queries.getBotState();
    if (state?.super_admin_user_id) {
      try {
        let notifyMsg = `🔔 Новый арендодатель зарегистрирован: ${userId}`;
        if (token.sub_end_date && token.sub_max_flats) {
          notifyMsg += `\nПодписка уже настроена: до ${token.sub_end_date}, лимит ${token.sub_max_flats} квартир`;
        } else {
          notifyMsg += `\nИспользуйте /manage_subscription для настройки подписки.`;
        }
        await ctx.telegram.sendMessage(state.super_admin_user_id, notifyMsg);
      } catch (e) { /* ignore */ }
    }
  } else if (token.role === 'tenant') {
    await queries.createUser(userId, 'tenant', token.flat_id);
    await queries.markTokenUsed(token.id);
    await ctx.reply('✅ Вы зарегистрированы как арендатор! Используйте /start для начала работы.');
    const flat = await queries.getFlat(token.flat_id);
    if (flat?.admin_user_id) {
      try {
        await ctx.telegram.sendMessage(
          flat.admin_user_id,
          `🔔 Новый арендатор зарегистрирован: ${userId}\nКвартира: ${flat.name}`
        );
      } catch (e) { /* ignore */ }
    }
  }
}

// ---- /help ----
bot.help(async (ctx) => {
  const user = await queries.getUser(ctx.from.id);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.superAdminHelp(ctx);
  if (user.role === 'admin') return adminCmd.adminHelp(ctx);
  if (user.role === 'tenant') return tenantCmd.tenantHelp(ctx);
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- /cancel ----
bot.command('cancel', async (ctx) => {
  const user = await queries.getUser(ctx.from.id);
  session.clearSession(ctx.from.id);
  if (!user) return ctx.reply('Действие отменено.');
  await ctx.reply('Действие отменено. Возвращаемся в главное меню.', getMainMenu(user));
});

function getMainMenu(user) {
  if (user.role === 'tenant') return keyboards.tenantMainMenu();
  return keyboards.adminMainMenu();
}

// ---- Middleware: check registration and subscription ----
async function getCtxUser(ctx) {
  return await queries.getUser(ctx.from.id);
}

async function isExpiredForAdmin(user) {
  if (user.role !== 'admin') return false;
  return !(await auth.checkSubscriptionActive(user.user_id));
}

// ---- Admin commands ----
bot.command('addflat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.addFlat(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.addFlat(ctx, user);
});

bot.command('select_flat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.selectFlat(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.selectFlat(ctx, user);
});

bot.command('flats', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.listFlats(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.listFlats(ctx, user);
});

bot.command('deleteflat', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.deleteFlatCmd(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.deleteFlatCmd(ctx, user);
});

bot.command('history', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.history(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.history(ctx, user);
});

bot.command('stats', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'tenant') {
    if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
    return tenantCmd.tenantStats(ctx, user);
  }
  // /stats stays available even with expired subscription
  if (user.role === 'admin') return adminCmd.stats(ctx, user);
  if (user.role === 'super_admin') return adminCmd.stats(ctx, user);
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

bot.command('invite_tenant', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.inviteTenant(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.inviteTenant(ctx, user);
});

bot.command('removeuser', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'admin' && await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.removeUser(ctx, user);
});

bot.command('listusers', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'admin' && await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.listUsers(ctx, user);
});

bot.command('subscribe', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await adminCmd.subscribeInfo(ctx, user);
});

bot.command('toggle_rent', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.toggleRent(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.toggleRent(ctx, user);
});

bot.command('set_rent', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.setRent(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.setRent(ctx, user);
});

bot.command('pay', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.pay(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.pay(ctx, user);
});

bot.command('set_initial_readings', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.setInitialReadings(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.setInitialReadings(ctx, user);
});

bot.command('summary', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'super_admin') return superCmd.summary(ctx, user);
  if (await isExpiredForAdmin(user)) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  await adminCmd.summary(ctx, user);
});

bot.command('support', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await supportCmd.startSupport(ctx, user);
});

// ---- Tenant commands ----
bot.command('balance', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
  await tenantCmd.tenantBalance(ctx, user);
});

bot.command('submit', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (user.role === 'tenant') {
    if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
    return tenantCmd.submitReadings(ctx, user, bot);
  }
  if (user.role === 'admin' || user.role === 'super_admin') {
    if (user.role === 'admin' && (await isExpiredForAdmin(user))) return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
    return tenantCmd.submitReadings(ctx, user, bot);
  }
  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

bot.command('delete_me', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  if (!auth.isTenantAccessValid(user)) return ctx.reply('Ваш доступ истёк. По всем вопросам обращаться @Cheatgtp');
  await tenantCmd.deleteMe(ctx, user, bot);
});

// ---- Super admin commands ----
bot.command('add_admin', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.addAdmin(ctx, user);
});

bot.command('invite_admin', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.inviteAdmin(ctx, user);
});

bot.command('list_admins', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.listAdmins(ctx, user);
});

bot.command('manage_subscription', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.manageSubscription(ctx, user);
});

bot.command('globalstats', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.superAdminStats(ctx, user);
});

bot.command('backup', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await ctx.reply('Резервное копирование выполняется автоматически каждый день в 2:00. Для ручного запуска используйте скрипт scripts/backup.js на сервере.');
});

bot.command('toggle_user', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.toggleUser(ctx, user);
});

bot.command('reply', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'super_admin') return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  await superCmd.replyToUser(ctx, user);
});

// ---- Callback query handlers ----
bot.action('confirm_reading', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.answerCbQuery('Ошибка');
  await tenantCmd.confirmReading(ctx, user, bot);
});

bot.action('retry_reading', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return ctx.answerCbQuery('Ошибка');
  await tenantCmd.retryReading(ctx, user, bot);
});

bot.action('confirm_delete_me', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.answerCbQuery('Ошибка');
  await tenantCmd.confirmDeleteMe(ctx, user, bot);
});

bot.action('cancel_delete_me', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || user.role !== 'tenant') return ctx.answerCbQuery('Ошибка');
  await tenantCmd.cancelDeleteMe(ctx, user);
});

bot.action('pay_action', async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.answerCbQuery('Ошибка');
  await ctx.answerCbQuery();
  if (user.role === 'super_admin') return superCmd.pay(ctx, user);
  await adminCmd.pay(ctx, user);
});

bot.action(/select_flat_(\d+)/, async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.answerCbQuery('Ошибка');
  const flatId = parseInt(ctx.match[1]);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) return ctx.answerCbQuery('Квартира не найдена');
  await queries.setSelectedFlat(user.user_id, flatId);
  const balance = await queries.getBalance(flatId);
  await ctx.answerCbQuery(`Квартира ${flat.name} выбрана`);
  await ctx.reply(`Активная квартира: ${flat.id}. ${flat.name}\nТекущий баланс: ${formatMoney(balance)}`, keyboards.adminMainMenu());
});

// Delete flat confirmation callbacks
bot.action(/confirm_delete_flat_(\d+)/, async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) return ctx.answerCbQuery('Ошибка');
  const flatId = parseInt(ctx.match[1]);
  const flat = await queries.getFlat(flatId);
  if (!flat || flat.admin_user_id !== user.user_id) return ctx.answerCbQuery('Квартира не найдена');
  await queries.deleteFlat(flatId);
  await ctx.answerCbQuery('Квартира удалена');
  await ctx.editMessageText(`✅ Квартира «${flat.name}» удалена вместе со всеми данными.`);
  await ctx.reply('Возвращаемся в главное меню.', keyboards.adminMainMenu());
});

bot.action('cancel_delete_flat', async (ctx) => {
  await ctx.answerCbQuery('Удаление отменено');
  await ctx.editMessageText('❌ Удаление квартиры отменено.');
});

// ---- Trial activation callback ----
bot.action('start_trial', async (ctx) => {
  const userId = ctx.from.id;
  const existing = await queries.getUser(userId);
  if (existing) {
    await ctx.answerCbQuery('Вы уже зарегистрированы');
    return ctx.editMessageText('Вы уже зарегистрированы. Используйте /start для входа.');
  }
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 14);
  const endDateStr = endDate.toISOString().split('T')[0];
  await queries.createUser(userId, 'admin');
  await queries.createSubscription(userId, endDateStr, 1);
  await ctx.answerCbQuery('Пробный период активирован');
  let msg = `✅ Пробный период активирован!\\nДействует до: ${endDateStr}\\nЛимит: 1 квартира, до 2 арендаторов.\\n\\n`;
  msg += `Используйте /addflat для создания первой квартиры.`;
  await ctx.editMessageText(msg);
  await ctx.reply('Главное меню', keyboards.adminMainMenu());
  const state = await queries.getBotState();
  if (state?.super_admin_user_id) {
    try {
      await ctx.telegram.sendMessage(
        state.super_admin_user_id,
        `🔔 Новый арендодатель ${userId} активировал пробный период (14 дней, 1 квартира).`
      );
    } catch (e) { /* ignore */ }
  }
});

// ---- Menu button handlers ----
const tariffButtons = {
  'Изменить тариф Воды': 'water',
  'Изменить тариф Электричества': 'electricity',
  'Изменить тариф Газа': 'gas',
  'Изменить тариф ТКО': 'tko',
  'Изменить тариф УК': 'uk',
  'Изменить Капремонт': 'caprepair',
};

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;
  const user = await getCtxUser(ctx);

  // Handle first-run setup key flow (user is not yet registered)
  if (!user) {
    const sess = session.getSession(userId);
    if (sess && sess.flow === 'setup_key') {
      const state = await queries.getBotState();
      if (text === state.setup_key) {
        await queries.createUser(userId, 'super_admin');
        await queries.setSuperAdmin(userId);
        session.clearSession(userId);
        return ctx.reply(
          '✅ Вы назначены суперадминистратором! Используйте /help для списка команд.',
          keyboards.adminMainMenu()
        );
      }
      return ctx.reply('❌ Неверный ключ. Введите ключ настройки:');
    }
    return ctx.reply('По всем вопросам обращаться @Cheatgtp');
  }

  // Check active session first
  const sess = session.getSession(user.user_id);
  if (sess) {
    // /cancel is handled by the command, but also check text
    if (text === '/cancel' || text.toLowerCase() === 'отмена') {
      session.clearSession(user.user_id);
      return ctx.reply('Действие отменено. Возвращаемся в главное меню.', getMainMenu(user));
    }

    if (sess.flow === 'add_flat' && (user.role === 'admin' || user.role === 'super_admin')) {
      if (user.role === 'super_admin') return superCmd.handleAddFlatInput(ctx, user, bot);
      return adminCmd.handleAddFlatInput(ctx, user, bot);
    }
    if (sess.flow === 'payment' && (user.role === 'admin' || user.role === 'super_admin')) {
      if (user.role === 'super_admin') return superCmd.handlePaymentInput(ctx, user);
      return adminCmd.handlePaymentInput(ctx, user);
    }
    if (sess.flow === 'support') {
      return supportCmd.handleSupportInput(ctx, user, bot);
    }
    if (sess.flow === 'tariff_change' && (user.role === 'admin' || user.role === 'super_admin')) {
      if (user.role === 'super_admin') {
        if (sess.step === 'tariff_date') return superCmd.handleTariffDate(ctx, user, bot);
        return superCmd.handleTariffInput(ctx, user);
      }
      if (sess.step === 'tariff_date') return adminCmd.handleTariffDate(ctx, user, bot);
      return adminCmd.handleTariffInput(ctx, user);
    }
    if (sess.flow === 'meter_readings' && (user.role === 'tenant' || user.role === 'admin' || user.role === 'super_admin')) {
      return tenantCmd.handleReadingInput(ctx, user);
    }
    if (sess.flow === 'add_admin' && user.role === 'super_admin') {
      return superCmd.handleAddAdminInput(ctx, user, bot);
    }
    if (sess.flow === 'invite_admin' && user.role === 'super_admin') {
      return superCmd.handleInviteAdminInput(ctx, user, bot);
    }
  }

  // Menu buttons
  if (text === 'Главное меню') {
    if (user.role === 'admin') return adminCmd.adminStart(ctx, user);
    if (user.role === 'super_admin') return superCmd.superAdminStart(ctx, user);
    if (user.role === 'tenant') return tenantCmd.tenantStart(ctx, user);
  }

  // Tenant menu buttons
  if (user.role === 'tenant') {
    if (text === 'Передать показания') return tenantCmd.submitReadings(ctx, user, bot);
    if (text === 'Баланс') return tenantCmd.tenantBalance(ctx, user);
    if (text === 'Статистика') return tenantCmd.tenantStats(ctx, user);
    if (text === 'Поддержка') return supportCmd.startSupport(ctx, user);
    return;
  }

  if (user.role === 'super_admin') {
    if (text === 'Ввести показания') return tenantCmd.submitReadings(ctx, user, bot);
    if (text === 'Настройка аренды') {
      const flat = await queries.getFlat(user.selected_flat_id);
      if (!flat) return ctx.reply('Выберите квартиру.');
      let msg = `Учёт аренды: ${flat.rent_enabled ? 'включён' : 'выключен'}\n`;
      msg += `Сумма: ${flat.rent_amount || 0} руб.\n\n`;
      msg += `Команды:\n/toggle_rent — включить/выключить\n/set_rent <сумма> — установить сумму`;
      return ctx.reply(msg);
    }
    if (text === 'Внести платеж') return superCmd.pay(ctx, user);
    if (text === 'Мои квартиры') return superCmd.listFlats(ctx, user);
    if (text === 'История платежей') return superCmd.history(ctx, user);
    if (text === 'Поддержка') return supportCmd.startSupport(ctx, user);
    if (tariffButtons[text]) {
      return superCmd.handleTariffChange(ctx, user, tariffButtons[text]);
    }
    return;
  }

  if (user.role === 'admin' && !(await isExpiredForAdmin(user))) {
    if (text === 'Ввести показания') return tenantCmd.submitReadings(ctx, user, bot);
    if (text === 'Настройка аренды') {
      const flat = await queries.getFlat(user.selected_flat_id);
      if (!flat) return ctx.reply('Выберите квартиру.');
      let msg = `Учёт аренды: ${flat.rent_enabled ? 'включён' : 'выключен'}\n`;
      msg += `Сумма: ${flat.rent_amount || 0} руб.\n\n`;
      msg += `Команды:\n/toggle_rent — включить/выключить\n/set_rent <сумма> — установить сумму`;
      return ctx.reply(msg);
    }
    if (text === 'Внести платеж') return adminCmd.pay(ctx, user);
    if (text === 'Мои квартиры') return adminCmd.listFlats(ctx, user);
    if (text === 'История платежей') return adminCmd.history(ctx, user);
    if (text === 'Поддержка') return supportCmd.startSupport(ctx, user);
    if (tariffButtons[text]) {
      return adminCmd.handleTariffChange(ctx, user, tariffButtons[text]);
    }
  }

  // Expired admin: only Поддержка and Главное меню are available
  if (user.role === 'admin' && await isExpiredForAdmin(user)) {
    if (text === 'Поддержка') return supportCmd.startSupport(ctx, user);
    if (text === 'Главное меню') return adminCmd.adminStart(ctx, user);
    return ctx.reply('Ваша подписка истекла. Для восстановления доступа используйте /support.');
  }

  if (user.role === 'admin' || user.role === 'super_admin') {
    return;
  }

  return ctx.reply('По всем вопросам обращаться @Cheatgtp');
});

// ---- Media handler (for support flow: photos, documents, etc.) ----
bot.on(['photo', 'document', 'video', 'voice', 'audio', 'sticker'], async (ctx) => {
  const user = await getCtxUser(ctx);
  if (!user) return;
  const sess = session.getSession(user.user_id);
  if (sess && sess.flow === 'support') {
    return supportCmd.handleSupportInput(ctx, user, bot);
  }
});

// ---- Error handling ----
bot.catch((err, ctx) => {
  console.error('[Bot Error]', err.message);
  if (ctx && ctx.reply) {
    ctx.reply('Произошла ошибка. Попробуйте позже.').catch(() => {});
  }
});

// ---- Start ----
async function start() {
  await initSchema();
  await queries.initBotState(config.SETUP_KEY);
  setupScheduler(bot);
  await bot.launch();
  console.log('[Bot] Started successfully');
}

start();

process.on('SIGINT', () => bot.stop('SIGINT'));
process.on('SIGTERM', () => bot.stop('SIGTERM'));
