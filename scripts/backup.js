// Database backup script — creates a copy of the SQLite database file.
// Run: npm run backup  (or: node scripts/backup.js)
// On production, schedule via cron: 0 2 * * * cd /path/to/bot && node scripts/backup.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = 7;
const DB_PATH = config.DB_PATH;

function runBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[Backup] Database file not found: ${DB_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split('T')[0];
  const filename = `db_${date}.db`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(`[Backup] Copying ${DB_PATH} to ${filepath}`);
  try {
    fs.copyFileSync(DB_PATH, filepath);
    console.log(`[Backup] Successfully created: ${filepath}`);
  } catch (err) {
    console.error(`[Backup] Failed: ${err.message}`);
    process.exit(1);
  }

  // Rotate: keep only last MAX_BACKUPS
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('db_') && f.endsWith('.db'))
    .sort();

  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    console.log(`[Backup] Rotated out: ${oldest}`);
  }

  console.log(`[Backup] Done. ${Math.min(files.length, MAX_BACKUPS)} backups retained.`);
}

runBackup();
