// Telegram keyboard builders
const { Markup } = require('telegraf');

function adminMainMenu() {
  return Markup.keyboard([
    ['Ввести показания', 'Внести платеж'],
    ['Изменить тариф Воды', 'Изменить тариф Электричества'],
    ['Изменить тариф Газа', 'Изменить тариф ТКО'],
    ['Изменить тариф УК', 'Изменить Капремонт'],
    ['Настройка аренды'],
    ['Мои квартиры', 'История платежей'],
    ['Поддержка', 'Главное меню'],
  ]).resize();
}

function tenantMainMenu() {
  return Markup.keyboard([
    ['Передать показания', 'Баланс'],
    ['Статистика', 'Поддержка'],
    ['Главное меню'],
  ]).resize();
}

function trialStartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Начать 14-дневный пробный период', 'start_trial')],
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', 'confirm_reading'),
      Markup.button.callback('🔄 Ввести заново', 'retry_reading'),
    ],
  ]);
}

function payKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💳 Внести платеж', 'pay_action')],
  ]);
}

function deleteConfirmKeyboard(flatId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', `confirm_delete_flat_${flatId}`),
      Markup.button.callback('❌ Отмена', 'cancel_delete_flat'),
    ],
  ]);
}

function deleteMeConfirmKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', 'confirm_delete_me'),
      Markup.button.callback('❌ Отмена', 'cancel_delete_me'),
    ],
  ]);
}

function flatListKeyboard(flats) {
  const buttons = flats.map(f => [Markup.button.callback(`${f.id}. ${f.name}`, `select_flat_${f.id}`)]);
  return Markup.inlineKeyboard(buttons);
}

function removeKeyboard() {
  return Markup.removeKeyboard();
}

module.exports = {
  adminMainMenu,
  tenantMainMenu,
  trialStartKeyboard,
  confirmKeyboard,
  payKeyboard,
  deleteConfirmKeyboard,
  deleteMeConfirmKeyboard,
  flatListKeyboard,
  removeKeyboard,
};
