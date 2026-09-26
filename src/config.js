require('dotenv').config();
const path = require('path');

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'rental_bot.db'),
  SETUP_KEY: process.env.SETUP_KEY || '',
  BOT_USERNAME: process.env.BOT_USERNAME || 'rental_utility_bot',
  SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || '@Cheatgtp',
  TIMEZONE: process.env.TZ || 'Europe/Moscow',
  INVITE_EXPIRY_DAYS: 7,
  DATA_RETENTION_MONTHS: 3,
};
