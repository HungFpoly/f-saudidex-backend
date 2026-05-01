export * from './DirectoryParserAdapter';

// Auto-register all concrete adapters
// ORDER MATTERS: adapters are checked in import order when match scores are equal.
// GenericDirectoryParser (0.05) must come BEFORE UniversalAIParser (0.1) so
// deterministic parsing is always attempted before AI extraction.
import './GenericDirectoryParser';        // Deterministic HTML pattern fallback (0.05)
import './SaudiChamberAdapter';
import './B2BPortalAdapter';
import './SaudiGovRegistryAdapter';
import './ModonAdapter';
import './SaudiIndustryGuideAdapter';
import './CyboAdapter';
import './BizMideastAdapter';
import './KSADirectoryAdapter';
import './UniversalAIParser';             // AI fallback — LAST resort (0.1)

/**
 * Source Adapter System for Saudidex Discovery
 *
 * This system replaces the single universal AI prompt with source-specific
 * parsers that use structured HTML parsing (Cheerio selectors) for accurate
 * extraction from known directory sites.
 *
 * ## How It Works
 *
 * 1. When a discovery URL is submitted, the parser registry checks all
 *    registered adapters and picks the best match (highest confidence score).
 *
 * 2. If an adapter matches, it parses the raw HTML using Cheerio selectors
 *    and returns structured company data — no AI calls needed.
 *
 * 3. If no adapter matches or returns 0 companies, the system falls back
 *    to the universal AI extraction prompt.
 *
 * ## Available Adapters
 *
 * | # | Adapter | ID | Match Pattern | Extraction Strategy |
 * |---|---------|-----|--------------|---------------------|
 * | 1 | SaudiChamberAdapter | saudi-chamber | chamber.sa, /members on .sa | JSON-LD → Tables → Cards |
 * | 2 | B2BPortalAdapter | b2b-portal | alibaba.com, kompass.com, /suppliers/ | Card grid → List items |
 * | 3 | SaudiGovRegistryAdapter | saudi-gov-registry | .gov.sa, /cr, /license | Registry tables → JSON-LD |
 * | 4 | ModonAdapter | modon | modon.gov.sa/Partners/Factories | SharePoint list → cards → links |
 * | 5 | SaudiIndustryGuideAdapter | saudi-industry-guide | saudiindustryguide.com | Cards → Tables |
 * | 5 | CyboAdapter | cybo | cybo.com | Business cards with categories |
 * | 6 | BizMideastAdapter | bizmideast | bizmideast.com | Listings → Profile pages |
 * | 7 | KSADirectoryAdapter | ksa-directory | ksa.directory, saudidir.com | Directory cards → Profile pages |
 * | 8 | UniversalAIParser | universal-ai | Any http/https URL | AI fallback (always matches) |
 *
 * ## Coverage Map
 *
 * The following directories are covered by specific adapters:
 *
 * | Directory URL | Adapter |
 * |--------------|---------|
 * | https://saudiindustryguide.com/ | SaudiIndustryGuideAdapter |
 * | https://www.modon.gov.sa/ar/Partners/Factories/Pages/default.aspx | ModonAdapter |
 * | https://modon.gov.sa/en/Partners/Factories/ | ModonAdapter |
 * | https://psnr.mim.gov.sa/catalog/ar/factories | SaudiGovRegistryAdapter |
 * | https://lc.mcci.org.sa/Home/Factories | SaudiChamberAdapter |
 * | https://quality.eamana.gov.sa/.../Certif_Cust_List.aspx | SaudiGovRegistryAdapter |
 * | https://industry.com.sa/en/vendor | B2BPortalAdapter |
 * | https://saudidir.com/ksa/... | KSADirectoryAdapter |
 * | https://www.cybo.com/saudi-arabia/ | CyboAdapter |
 * | https://www.bizmideast.com/SA/... | BizMideastAdapter |
 * | https://www.ksa.directory/.../i/2230 | KSADirectoryAdapter |
 *
 * ## Creating a New Adapter
 *
 * 1. Create a new file: `src/lib/adapters/YourAdapter.ts`
 * 2. Extend `BaseDirectoryParser`
 * 3. Implement `matches(url)`, `parse(html, baseUrl)`, optionally `discoverPagination()`
 * 4. Auto-register at the bottom: `parserRegistry.register(new YourAdapter())`
 * 5. Import it in this barrel file: `import './YourAdapter'`
 *
 * ## Example
 *
 * ```ts
 * import { BaseDirectoryParser, ParseResult, parserRegistry } from './DirectoryParserAdapter';
 * import * as cheerio from 'cheerio';
 *
 * export class MyAdapter extends BaseDirectoryParser {
 *   readonly id = 'my-adapter';
 *   readonly name = 'My Custom Directory';
 *
 *   matches(url: string): number {
 *     return url.includes('my-directory.com') ? 0.9 : 0;
 *   }
 *
 *   async parse(html: string, baseUrl: string): Promise<ParseResult> {
 *     const $ = cheerio.load(html);
 *     const companies = [];
 *
 *     $('.company-item').each((_, el) => {
 *       const name = $(el).find('h3').text().trim();
 *       if (name) {
 *         companies.push({
 *           name_en: this.cleanName(name),
 *           confidence_score: 0.7,
 *           source_url: baseUrl,
 *           field_confidence: { name_en: 0.8, ... }
 *         });
 *       }
 *     });
 *
 *     return { companies, totalFound: companies.length, parseMethod: 'adapter', adapterName: this.name };
 *   }
 * }
 *
 * parserRegistry.register(new MyAdapter());
 * ```
 */
