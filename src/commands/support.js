// Support command: accepts text and/or media, forwards to super admin
const queries = require('../queries');
const keyboards = require('../keyboards');
const session = require('../session');

const roleLabels = {
  tenant: 'Арендатор',
  admin: 'Арендодатель',
  super_admin: 'Суперадмин',
};

async function startSupport(ctx, user) {
  session.setSession(user.user_id, { flow: 'support' });
  await ctx.reply(
    'Опишите вашу проблему или вопрос. Вы можете прикрепить фото или документ (необязательно).',
    keyboards.removeKeyboard()
  );
}

async function handleSupportInput(ctx, user, bot) {
  const state = await queries.getBotState();
  if (!state?.super_admin_user_id) {
    session.clearSession(user.user_id);
    return ctx.reply('Служба поддержки временно недоступна. Попробуйте позже.', getMainMenu(user));
  }

  const msg = ctx.message;
  const fromUser = ctx.from;
  const flat = user.flat_id ? await queries.getFlat(user.flat_id) : null;

  let header = `📨 Обращение в поддержку\n`;
  header += `ID: ${fromUser.id}\n`;
  const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ');
  if (fullName) header += `Имя: ${fullName}\n`;
  header += `Роль: ${roleLabels[user.role] || user.role}\n`;
  header += `Квартира: ${flat ? flat.name : 'не привязан'}\n\n`;

  try {
    if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      await bot.telegram.sendPhoto(state.super_admin_user_id, largest.file_id, {
        caption: header + (msg.caption || ''),
      });
    } else if (msg.document) {
      await bot.telegram.sendDocument(state.super_admin_user_id, msg.document.file_id, {
        caption: header + (msg.caption || ''),
      });
    } else if (msg.video) {
      await bot.telegram.sendVideo(state.super_admin_user_id, msg.video.file_id, {
        caption: header + (msg.caption || ''),
      });
    } else if (msg.voice) {
      await bot.telegram.sendVoice(state.super_admin_user_id, msg.voice.file_id, {
        caption: header,
      });
    } else if (msg.audio) {
      await bot.telegram.sendAudio(state.super_admin_user_id, msg.audio.file_id, {
        caption: header + (msg.caption || ''),
      });
    } else if (msg.sticker) {
      await bot.telegram.sendMessage(state.super_admin_user_id, header + '[стикер]');
      await bot.telegram.sendSticker(state.super_admin_user_id, msg.sticker.file_id);
    } else if (msg.text) {
      await bot.telegram.sendMessage(state.super_admin_user_id, header + msg.text);
    } else {
      await bot.telegram.copyMessage(state.super_admin_user_id, msg.chat.id, msg.message_id, {
        caption: header,
      });
    }
  } catch (e) {
    session.clearSession(user.user_id);
    return ctx.reply('Не удалось отправить обращение. Попробуйте позже.', getMainMenu(user));
  }

  session.clearSession(user.user_id);
  await ctx.reply(
    '✅ Ваше обращение отправлено в службу поддержки. Мы свяжемся с вами в ближайшее время.',
    getMainMenu(user)
  );
}

function getMainMenu(user) {
  if (user.role === 'tenant') return keyboards.tenantMainMenu();
  return keyboards.adminMainMenu();
}

module.exports = { startSupport, handleSupportInput };
