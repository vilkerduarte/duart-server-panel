#!/usr/bin/env node
/**
 * Duart Panel - Log Rotation Script
 * Rotates panel logs weekly.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || '/var/lib/duart-panel';
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const MAX_LOG_FILES = 4; // Keep 4 weeks of logs

function main() {
  if (!fs.existsSync(LOGS_DIR)) {
    console.log('Logs directory does not exist yet.');
    return;
  }

  const logFiles = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));

  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);

    // Rotate existing numbered logs
    for (let i = MAX_LOG_FILES; i >= 1; i--) {
      const oldFile = path.join(LOGS_DIR, `${file}.${i}`);
      if (i === MAX_LOG_FILES) {
        // Remove oldest
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      } else {
        const newFile = path.join(LOGS_DIR, `${file}.${i + 1}`);
        if (fs.existsSync(oldFile)) fs.renameSync(oldFile, newFile);
      }
    }

    // Rename current to .1
    const backupFile = path.join(LOGS_DIR, `${file}.1`);
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupFile);
    }

    // Create new empty log
    fs.writeFileSync(filePath, '');
  }

  console.log(`Log rotation completed. ${logFiles.length} file(s) rotated.`);
}

main();
