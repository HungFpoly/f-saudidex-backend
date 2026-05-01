import "./shared/config/loadEnv";
import express from "express";
import cors from "cors";

// Shared Engine Imports
// Heavy engine imports moved to dynamic imports in handlers to satisfy Cloud Run timeout
import { buildClientRuntimeEnvScript } from "./shared/config/clientRuntimeEnv";
import { AIProvider } from "./shared/config/aiProviders";
import { requireSupabaseAdmin } from "./shared/lib/supabase";
import { triggerCloudRunJob, getJobExecutionStatus } from "./shared/lib/gcpJobs";
import { isAIEnabled, setAIEnabledOverride } from "./shared/config/runtime";
import { validator } from "./shared/lib/validator";
import { buildProvidersHealthApiResponse } from "./shared/server/providerHealth";
import { PLATFORM } from "./shared/config/platform";
import { searchIndexer } from "./shared/lib/searchIndexer";
import {
  runLegacyInteractiveDiscover,
  runLegacyInteractiveEnrich,
} from "./shared/server/interactiveLegacyDiscoverEnrich";

// Initialise AI state from environment
if (process.env.AI_DISABLED === 'true' || process.env.VITE_AI_DISABLED === 'true') {
  setAIEnabledOverride(false);
}

const app = express();
const corsOrigin = (process.env.CORS_ORIGIN || "").trim();
const corsAllowlist = corsOrigin
  ? corsOrigin
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

const isOriginAllowed = (requestOrigin?: string) => {
  if (!requestOrigin) return true;
  if (corsAllowlist.length === 0) return true;

  return corsAllowlist.some((rule) => {
    if (rule === "*") return true;
    if (rule === requestOrigin) return true;
    if (rule.includes("*")) {
      const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`, "i").test(requestOrigin);
    }
    return false;
  });
};

app.use(
  cors({
    origin: (requestOrigin, callback) => {
      if (isOriginAllowed(requestOrigin)) return callback(null, true);
      console.warn(`[CORS] Blocked origin: ${requestOrigin || "unknown"}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-requested-with",
      "x-admin-secret",
      "baggage",
      "sentry-trace",
    ],
    optionsSuccessStatus: 204,
  })
);
app.use(express.json({ limit: "10mb" }));

// Dynamic Sitemap Support
const CHUNK_SIZE = 10000;
const BASE_URL = process.env.VITE_APP_URL || 'https://saudib2b.com';

app.get('/sitemap.xml', async (req, res) => {
  try {
    const supabaseAdmin = requireSupabaseAdmin();
    const { count, error } = await supabaseAdmin
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');

    if (error) throw error;

    const sitemaps = [
      `${BASE_URL}/sitemap-static.xml`,
      `${BASE_URL}/sitemap-categories.xml`
    ];

    const companyPages = Math.ceil((count || 0) / CHUNK_SIZE);
    for (let i = 1; i <= companyPages; i++) {
      sitemaps.push(`${BASE_URL}/sitemap-companies-${i}.xml`);
    }

    const { generateSitemapIndexXml } = await import("./shared/lib/sitemapUtils");
    res.header('Content-Type', 'application/xml');
    res.send(generateSitemapIndexXml(sitemaps));
  } catch (error) {
    console.error('[SitemapIndex] Error:', error);
    res.status(500).send('Error generating sitemap index');
  }
});

app.get('/sitemap-static.xml', async (req, res) => {
  const { generateSitemapXml } = await import("./shared/lib/sitemapUtils");
  const staticUrls = [
    { loc: `${BASE_URL}/en`, changefreq: 'daily' as const, priority: 1.0 },
    { loc: `${BASE_URL}/ar`, changefreq: 'daily' as const, priority: 1.0 },
    { loc: `${BASE_URL}/en/search`, changefreq: 'daily' as const, priority: 0.8 },
    { loc: `${BASE_URL}/ar/search`, changefreq: 'daily' as const, priority: 0.8 },
    { loc: `${BASE_URL}/en/categories`, changefreq: 'weekly' as const, priority: 0.7 },
    { loc: `${BASE_URL}/ar/categories`, changefreq: 'weekly' as const, priority: 0.7 },
    { loc: `${BASE_URL}/en/regions`, changefreq: 'weekly' as const, priority: 0.7 },
    { loc: `${BASE_URL}/ar/regions`, changefreq: 'weekly' as const, priority: 0.7 },
  ];
  res.header('Content-Type', 'application/xml');
  res.send(generateSitemapXml(staticUrls));
});

app.get('/sitemap-categories.xml', async (req, res) => {
  try {
    const { CATEGORIES, CITIES } = await import("./shared/lib/data");
    const { buildCategoryPath, buildLocationPath } = await import("./shared/lib/seoRoutes");
    const { generateSitemapXml } = await import("./shared/lib/sitemapUtils");
    
    const urls: any[] = [];
    
    CATEGORIES.forEach(cat => {
      urls.push({
        loc: `${BASE_URL}${buildCategoryPath(cat.slug, 'en')}`,
        alternates: [{ lang: 'ar', loc: `${BASE_URL}${buildCategoryPath(cat.slug, 'ar')}` }],
        changefreq: 'daily',
        priority: 0.8
      });
      urls.push({
        loc: `${BASE_URL}${buildCategoryPath(cat.slug, 'ar')}`,
        alternates: [{ lang: 'en', loc: `${BASE_URL}${buildCategoryPath(cat.slug, 'en')}` }],
        changefreq: 'daily',
        priority: 0.8
      });
    });

    CITIES.forEach(city => {
      urls.push({
        loc: `${BASE_URL}${buildLocationPath(city.slug)}`,
        changefreq: 'weekly',
        priority: 0.7
      });
    });

    res.header('Content-Type', 'application/xml');
    res.send(generateSitemapXml(urls));
  } catch (error) {
    res.status(500).send('Error generating categories sitemap');
  }
});

app.get('/sitemap-companies-:page.xml', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const from = (page - 1) * CHUNK_SIZE;
    const to = from + CHUNK_SIZE - 1;

    const supabaseAdmin = requireSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('id, slug, name_en, updated_at, created_at')
      .eq('status', 'approved')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const { buildCompanyPath } = await import("./shared/lib/seoRoutes");
    const { generateSitemapXml } = await import("./shared/lib/sitemapUtils");

    const urls = (data || []).map(company => {
      const slug = company.slug || company.name_en?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || company.id;
      const lastmod = (company.updated_at || company.created_at || '').split('T')[0];
      
      return {
        loc: `${BASE_URL}${buildCompanyPath(company.id, slug, 'en')}`,
        alternates: [{ lang: 'ar', loc: `${BASE_URL}${buildCompanyPath(company.id, slug, 'ar')}` }],
        lastmod,
        changefreq: 'weekly' as const,
        priority: 0.6
      };
    });

    res.header('Content-Type', 'application/xml');
    res.send(generateSitemapXml(urls));
  } catch (error) {
    console.error('[SitemapCompanies] Error:', error);
    res.status(500).send('Error generating companies sitemap');
  }
});

// Admin Auth Middleware
const adminAuth = async (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const adminSecret = req.headers['x-admin-secret'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  
  // Allow bypass via master secret (for Cloud Scheduler/Internal Crons)
  const masterSecret = process.env.ADMIN_CURSOR_SECRET || process.env.VITE_ADMIN_CURSOR_SECRET;
  if (adminSecret && adminSecret === masterSecret) {
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized access: Missing Token or Secret" });
  }
  
  try {
    const supabaseAdmin = requireSupabaseAdmin();
    const { data: { user }, error } = await (supabaseAdmin.auth as any).getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized access to admin API: Invalid session" });
    }
    req.user = user;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: "Auth configuration error: " + err.message });
  }
};

function setupApiRoutes(app: any) {
  const apiRouter = express.Router();

  apiRouter.get("/health", (req, res) => res.json({ status: "ok" }));

  apiRouter.get("/providers/health", (req, res) => {
    const providerId = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const response = buildProvidersHealthApiResponse(providerId);
    res.status(response.statusCode).json(response.body);
  });

  // Interactive discovery (parity với saudidex-backend: adapter + safeFetch + allowAI/pageCursor/contentOnly...)
  apiRouter.post("/discover", adminAuth, async (req, res) => {
    console.log(`[API] /discover request:`, req.body);
    const requested = Number(req.body?.maxPages ?? 20);
    const platformLimit = PLATFORM.isVercel ? 10 : 200;
    const maxPages = Math.min(Math.max(1, requested || 20), platformLimit);

    if (req.body?.maxPages != null && requested > platformLimit) {
      console.warn(`[API] /discover clamped maxPages ${requested} → ${maxPages}`);
    }

    req.body = { ...(req.body || {}), maxPages };
    return runLegacyInteractiveDiscover(req as any, res as any);
  });

  // AI Helpers Proxy
  apiRouter.use(['/ai/*'], async (req, res, next) => {
    if (!isAIEnabled()) {
      return res.status(403).json({ status: "ai_disabled", message: "AI features are disabled via master toggle" });
    }
    next();
  });

  const handlePersistedEnrichmentRequest = async (req: any, res: any) => {
    const { provider, companyId, websiteUrl } = req.body;
    if (!websiteUrl) return res.status(400).json({ error: "Website URL required" });
    if (!companyId) return res.status(400).json({ error: "Company ID required" });
    if (provider === 'webllm') return res.status(400).json({ error: 'WebLLM is browser-only and cannot run the persisted enrichment pipeline.' });

    try {
      const { runPersistedEnrichment } = await import("./shared/engine/core/pipeline");
      const result = await runPersistedEnrichment({
        url: websiteUrl,
        companyId: String(companyId),
        provider: (provider || 'gemini') as AIProvider,
      });

      if (result.status === 'blocked') {
        return res.status(422).json({
          error: 'Target blocked the request or robots policy denied access.',
          blocked: true,
        });
      }

      if (result.status !== 'completed' || !result.payload) {
        return res.status(422).json({
          error: 'No pages found during enrichment scrape.',
          blocked: false,
        });
      }

      res.json({ ...result.payload, was_clamped: result.wasClamped });
    } catch (error: any) {
      console.error("[API] Enrichment error:", error);
      res.status(500).json({ error: error.message });
    }
  };

  /** Interactive site enrichment from saudidex-backend (`companyId` optional for raw-html storage only). Persisted pipeline: `POST /api/admin/enrich`. */
  apiRouter.post("/enrich", adminAuth, (req, res) =>
    runLegacyInteractiveEnrich(req as any, res as any)
  );

  apiRouter.post('/admin/discover', adminAuth, async (req, res) => {
    const { baseUrl, provider, maxPages: rawMaxPages = 30, autoEnrich = false } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'Base URL required' });
    if (provider === 'webllm') return res.status(400).json({ error: 'WebLLM is browser-only and cannot run the persisted scrape pipeline.' });

    const platformLimit = PLATFORM.isVercel ? 10 : 200;
    const maxPages = Math.min(Math.max(1, rawMaxPages), platformLimit);

    try {
      const { runPersistedDiscovery } = await import("./shared/engine/core/pipeline");
      const result = await runPersistedDiscovery({
        url: baseUrl,
        maxPages,
        autoEnrich: !!autoEnrich,
        enrichmentProvider: (provider || 'gemini') as AIProvider,
      });
      res.json(result);
    } catch (error: any) {
      console.error("[API] Persisted discovery error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.post('/admin/enrich', adminAuth, handlePersistedEnrichmentRequest);

  apiRouter.post('/ai/classify', adminAuth, async (req, res) => {
    const { ai_classifyCompany } = await import("./shared/engine/core/enrichment");
    res.json(await ai_classifyCompany(req.body.company, req.body.provider));
  });
  apiRouter.post('/ai/normalize', adminAuth, async (req, res) => {
    const { ai_normalizeCompany } = await import("./shared/engine/core/enrichment");
    res.json(await ai_normalizeCompany(req.body.company, req.body.provider));
  });
  apiRouter.post('/ai/brands', adminAuth, async (req, res) => {
    const { ai_detectBrands } = await import("./shared/engine/core/enrichment");
    res.json(await ai_detectBrands(req.body.company, req.body.provider));
  });
  apiRouter.post('/ai/rank-duplicates', adminAuth, async (req, res) => {
    const { company, candidates } = req.body;
    const { deduper, stringSimilarity } = await import("./shared/lib/deduper");
    const baseName = String(company?.name_en || company?.name_ar || '').trim();

    const rankings = Array.isArray(candidates)
      ? candidates.map((candidate: any) => {
          const verdict = deduper.isDuplicate(company, candidate);
          const nameSimilarity = baseName && (candidate?.name_en || candidate?.name_ar)
            ? stringSimilarity(baseName, String(candidate.name_en || candidate.name_ar))
            : 0;
          const reasons: string[] = [];

          if (candidate?.website_url && company?.website_url && verdict.confidence >= 0.95) {
            reasons.push('Same website domain');
          }
          if (nameSimilarity >= 0.85) {
            reasons.push(`High name similarity (${Math.round(nameSimilarity * 100)}%)`);
          }
          if (candidate?.linkedin_url && company?.linkedin_url && candidate.linkedin_url === company.linkedin_url) {
            reasons.push('Same LinkedIn URL');
          }

          const matchScore = Math.max(verdict.confidence, nameSimilarity * 0.8);
          return {
            candidate_id: String(candidate?.id || ''),
            match_score: Number(matchScore.toFixed(3)),
            reasons: reasons.length > 0 ? reasons : ['Low-confidence heuristic match'],
            recommended_action: matchScore >= 0.9 ? 'merge' : matchScore >= 0.75 ? 'review' : 'dismiss',
          };
        }).sort((a, b) => b.match_score - a.match_score)
      : [];

    res.json({ rankings });
  });
  apiRouter.post('/ai/improve-profile', adminAuth, async (req, res) => {
    const { ai_improveProfile } = await import("./shared/engine/core/enrichment");
    res.json(await ai_improveProfile(req.body.company, req.body.provider));
  });
  apiRouter.post('/ai/suggest-fields', adminAuth, async (req, res) => {
    const { ai_suggestMissingFields } = await import("./shared/engine/core/enrichment");
    res.json(await ai_suggestMissingFields(req.body.company, req.body.provider));
  });
  apiRouter.post('/ai/summarize-evidence', adminAuth, async (req, res) => {
    const { ai_summarizeEvidence } = await import("./shared/engine/core/enrichment");
    res.json(await ai_summarizeEvidence(req.body.company, req.body.summary_type, req.body.provider));
  });
  apiRouter.post('/ai/merge', adminAuth, async (req, res) => {
    const { ai_mergeCompanies } = await import("./shared/engine/core/enrichment");
    res.json(await ai_mergeCompanies(req.body.master, req.body.duplicate, req.body.provider));
  });
  apiRouter.post('/ai/score-completeness', adminAuth, async (req, res) => {
    const { ai_scoreCompleteness } = await import("./shared/engine/core/enrichment");
    res.json(ai_scoreCompleteness(req.body.company));
  });
  apiRouter.post('/ai/run-all', adminAuth, async (req, res) => {
    const { provider, company, jobs = ['classify', 'normalize', 'brands', 'suggest-fields', 'score-completeness'] } = req.body;
    const jobList = Array.isArray(jobs) ? jobs : [];
    const results: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    const jobsRun: string[] = [];
    const {
      ai_classifyCompany,
      ai_normalizeCompany,
      ai_detectBrands,
      ai_improveProfile,
      ai_suggestMissingFields,
      ai_summarizeEvidence,
      ai_scoreCompleteness,
    } = await import("./shared/engine/core/enrichment");

    for (const job of jobList) {
      try {
        switch (job) {
          case 'classify':
            results.classify = await ai_classifyCompany(company, provider);
            break;
          case 'normalize':
            results.normalize = await ai_normalizeCompany(company, provider);
            break;
          case 'brands':
            results.brands = await ai_detectBrands(company, provider);
            break;
          case 'improve-profile':
            results.improve_profile = await ai_improveProfile(company, provider);
            break;
          case 'suggest-fields':
            results.suggest_fields = await ai_suggestMissingFields(company, provider);
            break;
          case 'summarize-evidence':
            results.summarize_evidence = await ai_summarizeEvidence(company, 'general', provider);
            break;
          case 'score-completeness':
            results.score_completeness = ai_scoreCompleteness(company);
            break;
          default:
            errors[job] = `Unsupported run-all job: ${job}`;
            continue;
        }
        jobsRun.push(job);
      } catch (error: any) {
        errors[job] = error.message || String(error);
      }
    }

    res.json({
      company_id: String(company?.id || ''),
      results,
      errors,
      jobs_run: jobsRun,
    });
  });

  apiRouter.post('/ai/research', adminAuth, async (req, res) => {
    try {
      const { performDeepResearch } = await import("./shared/engine/core/research");
      const result = await performDeepResearch(req.body);
      res.json(result);
    } catch (error: any) {
      console.error("[API] Research error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // Cloud Run Job Management
  apiRouter.post('/jobs/trigger', adminAuth, async (req, res) => {
    try {
      const result = await triggerCloudRunJob(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.get('/jobs/status/:name', adminAuth, async (req, res) => {
    try {
      const result = await getJobExecutionStatus(req.params.name);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  apiRouter.post('/admin/audit-quality', adminAuth, async (req, res) => {
    try {
      const { auditCompanyQuality } = await import("./shared/engine/core/dataQuality");
      const result = await auditCompanyQuality(req.body.limit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Batch Operations
  apiRouter.post('/admin/batch-enrich', adminAuth, async (req, res) => {
    try {
      const { runBatchEnrich } = await import("./shared/engine/core/batch");
      const result = await runBatchEnrich(req.body);
      res.json(result);
    } catch (error: any) {
      console.error("[API] Batch enrichment error:", error);
      const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 500;
      res.status(statusCode).json({ error: error.message });
    }
  });

  // Regional Health Analytics
  apiRouter.get('/admin/regional-health', adminAuth, async (req, res) => {
    try {
      const supabaseAdmin = requireSupabaseAdmin();
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // 1. Get regional aggregates
      const { data: stats, error: statsError } = await supabaseAdmin
        .from('job_status')
        .select('run_region, status, started_at, completed_at')
        .gte('created_at', last24h);

      if (statsError) throw statsError;

      const regions = ["me-central1", "us-central1", "europe-west1", "asia-east1"];
      const healthReport = regions.map(region => {
        const regionJobs = stats?.filter(j => j.run_region === region) || [];
        const succeeded = regionJobs.filter(j => j.status === 'completed').length;
        const failed = regionJobs.filter(j => j.status === 'failed').length;
        const running = regionJobs.filter(j => j.status === 'running').length;
        const total = regionJobs.length;

        const durations = regionJobs
          .filter(j => j.started_at && j.completed_at)
          .map(j => new Date(j.completed_at).getTime() - new Date(j.started_at).getTime());
        
        const avgDuration = durations.length > 0 
          ? durations.reduce((a, b) => a + b, 0) / durations.length 
          : 0;

        return {
          region,
          successRate: total > 0 ? (succeeded / (succeeded + failed || 1)) * 100 : 100,
          totalJobs: total,
          succeeded,
          failed,
          running,
          avgDurationMs: Math.round(avgDuration)
        };
      });

      res.json(healthReport);
    } catch (error: any) {
      console.error("[API] Regional health error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin company upsert (service-role, bypasses RLS for trusted admin sessions)
  apiRouter.post('/admin/companies/upsert', adminAuth, async (req, res) => {
    try {
      const payload = req.body?.company;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid payload: "company" object is required.' });
      }

      const supabaseAdmin = requireSupabaseAdmin();
      let candidate = validator.sanitizeCompanyPersistencePayload({
        ...(payload as Record<string, any>),
      });
      let { data, error } = await supabaseAdmin
        .from('companies')
        .upsert(candidate, { onConflict: 'id' })
        .select('id')
        .single();

      const isUniqueViolation = (e: any, pattern: RegExp) =>
        e?.code === '23505' && pattern.test(e?.message || '');

      let finalData = data;
      let finalError = error;

      // Handle Name Uniqueness Violation
      const isNameUniqueViolation = isUniqueViolation(finalError, /idx_companies_name_en_unique|companies_name_en_key|name_en/i);
      if (isNameUniqueViolation && candidate.name_en) {
        console.log(`[API] Name collision detected for: "${candidate.name_en}". Searching for existing record...`);
        // More robust search: Trim, and handle common encoding/spacing issues
        const cleanName = String(candidate.name_en).trim();
        const { data: existingByName, error: searchError } = await supabaseAdmin
          .from('companies')
          .select('id, name_en, slug')
          .ilike('name_en', cleanName)
          .limit(1)
          .maybeSingle();

        if (existingByName?.id) {
          console.log(`[API] Found existing company with ID ${existingByName.id}. Retrying with ID-based upsert.`);
          candidate.id = existingByName.id;
          // Keep existing slug if ours is missing or we want to avoid slug collision on update
          if (!candidate.slug && existingByName.slug) candidate.slug = existingByName.slug;
          
          const retryByName = await supabaseAdmin
            .from('companies')
            .upsert(candidate, { onConflict: 'id' })
            .select('id')
            .single();
          
          finalData = retryByName.data;
          finalError = retryByName.error;
        } else if (searchError) {
          console.error(`[API] Error during name collision lookup:`, searchError.message);
        } else {
          console.error(`[API] Name collision reported by DB but no matching record found for "${cleanName}". Check for case-sensitivity or hidden characters.`);
        }
      }

      // Handle Slug Uniqueness Violation
      const isSlugUniqueViolation = isUniqueViolation(finalError, /idx_companies_slug_unique|companies_slug_key|slug/i);
      if (isSlugUniqueViolation) {
        console.log(`[API] Slug collision detected for: "${candidate.slug}". Regenerating...`);
        const baseSlug = String(candidate.slug || '').trim().replace(/-[0-9]+$/, '') || 
                        String(candidate.name_en || 'company').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const idSuffix = String(candidate.id || Date.now());
        candidate.slug = `${baseSlug || 'company'}-${idSuffix}`;
        
        const retrySlug = await supabaseAdmin
          .from('companies')
          .upsert(candidate, { onConflict: 'id' })
          .select('id')
          .single();
        
        finalData = retrySlug.data;
        finalError = retrySlug.error;
      }

      if (finalError) throw finalError;

      // Trigger background indexing
      if (finalData?.id) {
        searchIndexer.indexCompanyById(finalData.id).catch(err => {
          console.error(`[API] Background indexing failed for ${finalData.id}:`, err);
        });
      }

      res.json({ success: true, data: finalData });
    } catch (error: any) {
      console.error("[API] Admin company upsert error:", error);
      return res.status(500).json({ error: error?.message || 'Unknown upsert error' });
    }
  });

  // Admin companies list (service-role, bypasses RLS for moderation screens)
  apiRouter.get('/admin/companies', adminAuth, async (_req, res) => {
    try {
      const supabaseAdmin = requireSupabaseAdmin();
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;
      return res.json({ companies: data ?? [] });
    } catch (error: any) {
      console.error('[API] Admin companies list error:', error);
      return res.status(500).json({ error: error?.message || 'Failed to load companies' });
    }
  });

  // System Settings Endpoints
  apiRouter.get("/settings", adminAuth, (req, res) => {
    res.json({ ai_enabled: isAIEnabled() });
  });

  apiRouter.post("/settings", adminAuth, (req, res) => {
    const { ai_enabled } = req.body;
    if (typeof ai_enabled === 'boolean') {
      setAIEnabledOverride(ai_enabled);
      console.log(`[SETTINGS] AI Infrastructure updated: ${ai_enabled ? 'ENABLED' : 'DISABLED'}`);
      res.json({ success: true, ai_enabled: isAIEnabled() });
    } else {
      res.status(400).json({ error: "Invalid settings payload" });
    }
  });

  // Search Index Management
  apiRouter.post('/admin/search/rebuild', adminAuth, async (req, res) => {
    try {
      // Run in background to avoid timeouts
      searchIndexer.rebuildFullIndex().then(result => {
        console.log('[SearchIndexer] Rebuild completed:', result);
      }).catch(err => {
        console.error('[SearchIndexer] Rebuild failed:', err);
      });
      
      res.json({ success: true, message: "Search index rebuild started in background." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.use("/api", apiRouter);
}

const PORT = Number(process.env.PORT || 3000);

// Global Exception Handlers for better Cloud Run Logs
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});

// Basic health and environment endpoints registered IMMEDIATELY
app.get("/api/health", (req, res) => res.json({ 
  status: "ok", 
  mode: process.env.NODE_ENV,
  uptime: process.uptime()
}));

app.get('/env.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(buildClientRuntimeEnvScript());
});

async function startServer() {
  setupApiRoutes(app);

  console.log("[Core] API-only server — static SPA/Vite bundle is excluded from this package.");
}

// START LISTENING
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  const server = app.listen(PORT, "0.0.0.0", () => {
      console.log('--- SERVER STARTUP SEQUENCE ---');
      console.log(`🚀 Saudidex Server listening on 0.0.0.0:${PORT}`);
      console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`PLATFORM: ${PLATFORM.isRender ? 'RENDER' : (PLATFORM.isVercel ? 'VERCEL' : 'LOCAL')}`);
      
      // Start heavy initialization after port binding
      startServer().catch(err => {
          console.error("FAILED TO INITIALIZE SERVER:", err);
          process.exit(1);
      });
  });

  // Increase timeout for Render/Long-running tasks
  if (PLATFORM.isRender) {
    console.log('[Server] Extending timeout to 10 minutes for Render backend');
    server.timeout = 600000; 
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  }
} else {
  // On Vercel, we still need to run startServer to register API routes
  startServer().catch(err => {
      console.error("FAILED TO INITIALIZE VERCEL API:", err);
  });
}

export default app;
