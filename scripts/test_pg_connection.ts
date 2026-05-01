import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Extract ref from VITE_SUPABASE_URL
const url = process.env.VITE_SUPABASE_URL || '';
const ref = url.match(/https:\/\/(.*)\.supabase\.co/)?.[1] || '';
const password = "GiBGfehvn41zNGpD"; // Hardcoded from .env

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

async function test() {
  console.log(`Connecting to ${config.host}...`);
  const client = new pg.Client(config);
  try {
    await client.connect();
    console.log("Connected successfully!");
    const res = await client.query('SELECT current_database(), current_user, version();');
    console.log(res.rows[0]);
    await client.end();
  } catch (err) {
    console.error("Connection failed:", err.message);
    if (err.message.includes('ENOTFOUND')) {
      console.log("DNS Resolution failed. Trying pooler IPv4...");
      // Try pooler here?
    }
  }
}

test();
