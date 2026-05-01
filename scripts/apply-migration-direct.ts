import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envLocalPath = path.join(__dirname, '..', '.env.local');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config({ path: envPath });
}

const url = process.env.VITE_SUPABASE_URL || '';
const ref = url.match(/https:\/\/(.*)\.supabase\.co/)?.[1] || '';
const password = process.env.SUPABASE_DB_PASSWORD || "GiBGfehvn41zNGpD";

const config = {
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: 'postgres',
  password: password,
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
};

async function run() {
  const explicitMigration = process.env.MIGRATION_FILE || process.argv[2];
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const latestMigration = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .at(-1);
  const migrationPath = explicitMigration
    ? path.join(migrationsDir, explicitMigration)
    : path.join(migrationsDir, latestMigration || '');
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found at ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf-8');
  console.log(`Applying migration to ${config.host}...`);
  
  const client = new pg.Client(config);
  try {
    await client.connect();
    console.log("Connected successfully!");
    await client.query(sql);
    console.log("Migration applied successfully!");
    await client.end();
  } catch (err) {
    console.error("Failed to apply migration:", err.message);
    process.exit(1);
  }
}

run();
