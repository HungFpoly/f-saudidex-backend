import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const SB_URL = process.env.VITE_SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SB_URL || !SB_KEY) {
  console.error("Missing Supabase URL or Service Role Key in .env");
  process.exit(1);
}

const supabase = createClient(SB_URL, SB_KEY);

async function backup() {
  const backupDir = path.join(process.cwd(), 'backups', `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`Starting backup to ${backupDir}...`);

  // 1. Get all tables in the public schema
  const { data: tables, error: tablesError } = await supabase
    .rpc('get_tables'); // We might need to create this function or use a different way

  // Fallback: manually list common tables if RPC fails
  let tableNames = [];
  if (tablesError) {
    console.warn("RPC 'get_tables' not found, using information_schema via query...");
    const { data: infoTables, error: queryError } = await supabase
      .from('companies') // Try to use a known table to see if it works
      .select('id')
      .limit(1);
    
    // Actually, let's use a generic SQL query via the API if possible, 
    // but the service role key doesn't always have access to information_schema via PostgREST.
    // Instead, I'll use the known tables from the migrations dir.
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir);
    const tableSet = new Set<string>();
    for (const file of files) {
      if (!file.endsWith('.sql')) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Case insensitive match for table names, handling optional quotes and public. prefix
      const matches = content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?(\w+)["']?/gi);
      for (const match of matches) {
        tableSet.add(match[1].toLowerCase());
      }
    }
    tableNames = Array.from(tableSet);
  } else {
    tableNames = tables.map((t: any) => t.table_name);
  }

  console.log(`Found tables: ${tableNames.join(', ')}`);

  for (const table of tableNames) {
    console.log(`Dumping table: ${table}...`);
    let allRows: any[] = [];
    let from = 0;
    const step = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .range(from, from + step - 1);
      
      if (error) {
        console.error(`Error dumping ${table}:`, error.message);
        break;
      }
      
      if (!data || data.length === 0) break;
      
      allRows = allRows.concat(data);
      if (data.length < step) break;
      from += step;
    }

    if (allRows.length > 0) {
      fs.writeFileSync(path.join(backupDir, `${table}.json`), JSON.stringify(allRows, null, 2));
      console.log(`Saved ${allRows.length} rows for ${table}`);
    } else {
      console.log(`Table ${table} is empty.`);
    }
  }

  console.log("Full backup completed successfully.");
}

backup().catch(console.error);
