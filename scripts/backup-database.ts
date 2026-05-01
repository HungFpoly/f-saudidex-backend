import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Robust Database Backup Script
 * Usage: npm run backup
 */
async function performBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups');
  const filename = `saudidex_full_${timestamp}.sql`;
  const backupPath = path.join(backupDir, filename);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Use the Pooler URL provided by the user
  const dbUrl = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error("❌ ERROR: No DATABASE_URL_POOLER or DATABASE_URL found in .env");
    process.exit(1);
  }

  console.log(`🚀 Initializing backup to: ${filename}...`);

  try {
    // Execute pg_dump
    // -F p (plain text SQL)
    // --no-owner (removes user-specific ownership for easier restores)
    // --no-privileges (removes GRANT/REVOKE statements)
    execSync(`pg_dump "${dbUrl}" -F p -f "${backupPath}" --no-owner --no-privileges`, {
      stdio: 'inherit'
    });

    console.log(`✅ Backup completed successfully: ${backupPath}`);

    // --- Retention Policy: Keep last 10 backups ---
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('saudidex_full_'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 10) {
      files.slice(10).forEach(file => {
        fs.unlinkSync(path.join(backupDir, file.name));
        console.log(`🧹 Rotated old backup: ${file.name}`);
      });
    }

  } catch (error) {
    console.error("❌ Backup failed:", error);
    process.exit(1);
  }
}

performBackup();
