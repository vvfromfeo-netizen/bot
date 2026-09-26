const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const dir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function query(text, params) {
  return db.prepare(text).run(params || []);
}

function queryOne(text, params) {
  return db.prepare(text).get(params || []) || null;
}

function queryAll(text, params) {
  return db.prepare(text).all(params || []);
}

module.exports = { db, query, queryOne, queryAll };
