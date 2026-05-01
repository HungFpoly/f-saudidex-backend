/**
 * Search Indexer Service for Saudidex
 *
 * This service handles indexing of company data for efficient searching.
 * It maintains a search index that maps search terms to company records,
 * enabling fast and relevant search results.
 */

import { supabaseAdmin } from './supabase';
import { CompanyData } from './validator';

export interface SearchIndexEntry {
  id: string;                    // Company ID
  name_en: string;               // English name
  name_ar: string;               // Arabic name
  business_type: string;         // Business type
  description_en: string;        // English description
  description_ar: string;        // Arabic description
  city: string;                  // City
  categories: string[];          // Categories
  products: string[];            // Products
  services: string[];            // Services
  brands: string[];              // Brands
  searchable_text: string;       // Combined searchable text
  last_updated: string;          // Last update timestamp
}

export class SearchIndexer {
  private static readonly BATCH_SIZE = 100;

  /**
   * Index a single company from its data
   */
  async indexCompany(company: CompanyData): Promise<boolean> {
    if (!company.id) {
      console.error('Cannot index company without ID');
      return false;
    }

    try {
      // Prepare searchable text combining all relevant fields
      const searchableText = this.buildSearchableText(company);

      const indexEntry: SearchIndexEntry = {
        id: company.id,
        name_en: company.name_en || '',
        name_ar: company.name_ar || '',
        business_type: company.business_type || '',
        description_en: company.description_en || '',
        description_ar: company.description_ar || '',
        city: company.city || '',
        categories: company.categories || [],
        products: company.products || [],
        services: company.services || [],
        brands: company.brands || [],
        searchable_text: searchableText,
        last_updated: new Date().toISOString()
      };

      // Insert or update the search index entry
      const { error } = await supabaseAdmin
        .from('search_index')
        .upsert(indexEntry, { onConflict: 'id' });

      if (error) {
        console.error(`SearchIndexer.indexCompany [${company.id}] - Error:`, error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`SearchIndexer.indexCompany [${company.id}] - Exception:`, error);
      return false;
    }
  }

  /**
   * Index a company by fetching its latest data from the database first
   */
  async indexCompanyById(companyId: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .maybeSingle();

      if (error || !data) {
        console.error(`SearchIndexer.indexCompanyById [${companyId}] - Fetch Error:`, error?.message || 'Not found');
        return false;
      }

      return await this.indexCompany(data);
    } catch (error) {
      console.error(`SearchIndexer.indexCompanyById [${companyId}] - Exception:`, error);
      return false;
    }
  }

  /**
   * Index multiple companies in batches
   */
  async indexCompanies(companies: CompanyData[]): Promise<{ success: number; failed: number }> {
    let successCount = 0;
    let failedCount = 0;

    // Process companies in batches
    for (let i = 0; i < companies.length; i += SearchIndexer.BATCH_SIZE) {
      const batch = companies.slice(i, i + SearchIndexer.BATCH_SIZE);
      const entries: SearchIndexEntry[] = [];

      for (const company of batch) {
        if (!company.id) {
          console.error('Cannot index company without ID');
          failedCount++;
          continue;
        }

        try {
          // Prepare searchable text combining all relevant fields
          const searchableText = this.buildSearchableText(company);

          const indexEntry: SearchIndexEntry = {
            id: company.id,
            name_en: company.name_en || '',
            name_ar: company.name_ar || '',
            business_type: company.business_type || '',
            description_en: company.description_en || '',
            description_ar: company.description_ar || '',
            city: company.city || '',
            categories: company.categories || [],
            products: company.products || [],
            services: company.services || [],
            brands: company.brands || [],
            searchable_text: searchableText,
            last_updated: new Date().toISOString()
          };

          entries.push(indexEntry);
        } catch (error) {
          console.error('SearchIndexer.indexCompanies - Error preparing entry:', error);
          failedCount++;
        }
      }

      // Bulk insert/update entries
      if (entries.length > 0) {
        try {
          const { error } = await supabaseAdmin
            .from('search_index')
            .upsert(entries, { onConflict: 'id' });

          if (error) {
            console.error('SearchIndexer.indexCompanies - Error indexing batch:', error);
            failedCount += entries.length;
          } else {
            successCount += entries.length;
          }
        } catch (error) {
          console.error('SearchIndexer.indexCompanies - Error inserting batch:', error);
          failedCount += entries.length;
        }
      }
    }

    return { success: successCount, failed: failedCount };
  }

  /**
   * Remove a company from the search index
   */
  async removeFromIndex(companyId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from('search_index')
        .delete()
        .eq('id', companyId);

      if (error) {
        console.error('SearchIndexer.removeFromIndex - Error:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('SearchIndexer.removeFromIndex - Error:', error);
      return false;
    }
  }

  /**
   * Search companies by query string
   */
  async search(query: string, limit: number = 20, offset: number = 0): Promise<SearchIndexEntry[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      // Split query into individual terms and escape special characters
      const terms = query.trim().split(/\s+/).filter(term => term.length > 0);
      
      if (terms.length === 0) {
        return [];
      }

      // Build search query using Postgres full-text search
      let searchQuery = supabaseAdmin
        .from('search_index')
        .select('*')
        .range(offset, offset + limit - 1)
        .order('last_updated', { ascending: false });

      // Add search condition for each term
      for (const term of terms) {
        searchQuery = searchQuery.ilike('searchable_text', `%${term}%`);
      }

      const { data, error } = await searchQuery;

      if (error) {
        console.error('SearchIndexer.search - Error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('SearchIndexer.search - Error:', error);
      return [];
    }
  }

  /**
   * Rebuild the entire search index from the companies table
   */
  async rebuildFullIndex(): Promise<{ success: number; failed: number }> {
    try {
      // Get all companies from the database
      const { data: companies, error } = await supabaseAdmin
        .from('companies')
        .select(`
          id,
          name_en,
          name_ar,
          business_type,
          description_en,
          description_ar,
          city,
          categories,
          products,
          services,
          brands
        `);

      if (error) {
        console.error('SearchIndexer.rebuildFullIndex - Error fetching companies:', error);
        return { success: 0, failed: 0 };
      }

      if (!companies) {
        console.log('SearchIndexer.rebuildFullIndex - No companies found');
        return { success: 0, failed: 0 };
      }

      console.log(`SearchIndexer.rebuildFullIndex - Indexing ${companies.length} companies`);
      return await this.indexCompanies(companies);
    } catch (error) {
      console.error('SearchIndexer.rebuildFullIndex - Error:', error);
      return { success: 0, failed: 0 };
    }
  }

  /**
   * Build searchable text from company fields
   */
  private buildSearchableText(company: CompanyData): string {
    const parts = [];

    // Add name fields
    if (company.name_en) parts.push(company.name_en);
    if (company.name_ar) parts.push(company.name_ar);

    // Add business type
    if (company.business_type) parts.push(company.business_type);

    // Add descriptions
    if (company.description_en) parts.push(company.description_en);
    if (company.description_ar) parts.push(company.description_ar);

    // Add city
    if (company.city) parts.push(company.city);

    // Add categories, products, services, brands
    if (Array.isArray(company.categories)) parts.push(...company.categories);
    if (Array.isArray(company.products)) parts.push(...company.products);
    if (Array.isArray(company.services)) parts.push(...company.services);
    if (Array.isArray(company.brands)) parts.push(...company.brands);

    // Combine all parts into a single searchable string
    return parts
      .join(' | ')
      .toLowerCase()
      .replace(/[^\w\s\u0600-\u06FF\u0750-\u077F]/g, ' ')  // Keep Arabic characters
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// Export a singleton instance
export const searchIndexer = new SearchIndexer();