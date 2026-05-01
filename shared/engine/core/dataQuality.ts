import { requireSupabaseAdmin } from "../../lib/supabase";
import { logToCloud } from "../../lib/monitoring";

/**
 * Data Quality Engine
 * Identifies low-confidence or potentially corrupted company records.
 */

export interface QualityAuditResult {
  badRecords: string[];
  totalAudited: number;
  stats: {
    lowConfidence: number;
    missingCriticalFields: number;
    outdated: number;
  };
}

export async function auditCompanyQuality(limit = 100): Promise<QualityAuditResult> {
  const supabase = requireSupabaseAdmin();
  
  // Fetch companies with low confidence scores or missing descriptions
  const { data: companies, error } = await supabase
    .from('companies')
    .select('id, name_en, name_ar, description_en, description_ar, confidence_score, updated_at')
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    logToCloud({ level: 'ERROR', category: 'ENRICHMENT', message: 'Failed to fetch companies for quality audit', details: error });
    throw error;
  }

  const badRecords: string[] = [];
  const stats = { lowConfidence: 0, missingCriticalFields: 0, outdated: 0 };

  const MIN_CONFIDENCE = 0.5;

  for (const company of companies) {
    let isBad = false;

    if ((company.confidence_score || 0) < MIN_CONFIDENCE) {
      stats.lowConfidence++;
      isBad = true;
    }

    // Critical fields check (English is mandatory for discovery)
    if (!company.description_en && !company.description_ar) {
      stats.missingCriticalFields++;
      isBad = true;
    }

    if (isBad) {
      badRecords.push(company.id);
    }
  }

  logToCloud({
    level: 'INFO',
    category: 'ENRICHMENT',
    message: `Data quality audit completed: found ${badRecords.length} bad records`,
    details: { total: companies.length, bad: badRecords.length, stats }
  });

  return {
    badRecords,
    totalAudited: companies.length,
    stats
  };
}

export async function queueReScrape(companyIds: string[]) {
  // In a real implementation, this would insert into a re_scrape_queue table
  // or trigger enrichment jobs immediately.
  logToCloud({
    level: 'INFO',
    category: 'ENRICHMENT',
    message: `Queuing ${companyIds.length} companies for re-scrape`,
    details: { companyIds }
  });
  
  return { success: true, count: companyIds.length };
}
