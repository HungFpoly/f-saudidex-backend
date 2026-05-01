/**
 * Entity Resolver Service for Saudidex
 *
 * This service handles the resolution of entities (companies) by identifying
 * and merging duplicate records, resolving conflicting information, and
 * maintaining a consistent view of each entity.
 */

import { supabaseAdmin } from './supabase';
import { CompanyData } from './validator';
import { deduper } from './deduper';

export interface ResolutionResult {
  resolvedEntity: CompanyData;
  sources: string[];  // IDs of the original entities that contributed to this resolution
  conflicts: string[]; // Fields that had conflicting values
  confidence: number; // Overall confidence in the resolution
}

export interface ResolutionOptions {
  mergeStrategy?: 'preferMaster' | 'preferLatest' | 'majorityRule' | 'aiAssisted';
  confidenceThreshold?: number; // Minimum confidence required to perform resolution
}

export class EntityResolver {
  /**
   * Resolve a group of potentially duplicate companies into a single resolved entity
   */
  async resolveEntities(
    entities: CompanyData[],
    options: ResolutionOptions = {}
  ): Promise<ResolutionResult | null> {
    if (!entities || entities.length < 2) {
      console.warn('EntityResolver.resolveEntities - Need at least 2 entities to resolve');
      return null;
    }

    const {
      mergeStrategy = 'preferMaster',
      confidenceThreshold = 0.5
    } = options;

    try {
      // First, verify that these entities are actually duplicates
      const firstEntity = entities[0];
      const duplicates = entities.slice(1).filter(entity => 
        deduper.isDuplicate(firstEntity, entity).isDuplicate
      );

      if (duplicates.length === 0) {
        console.warn('EntityResolver.resolveEntities - No duplicates found in provided entities');
        return null;
      }

      // Create a unified entity by merging all duplicates
      let resolvedEntity: CompanyData;
      const conflicts: string[] = [];

      switch (mergeStrategy) {
        case 'preferMaster':
          resolvedEntity = this.mergePreferMaster(firstEntity, duplicates);
          break;
        case 'preferLatest':
          resolvedEntity = this.mergePreferLatest(entities);
          break;
        case 'majorityRule':
          resolvedEntity = this.mergeMajorityRule(entities);
          break;
        case 'aiAssisted':
          // For now, default to preferMaster since AI might be disabled
          resolvedEntity = this.mergePreferMaster(firstEntity, duplicates);
          break;
        default:
          resolvedEntity = this.mergePreferMaster(firstEntity, duplicates);
      }

      // Calculate conflicts
      conflicts.push(...this.detectConflicts(entities));

      // Calculate overall confidence
      const confidence = this.calculateResolutionConfidence(entities, conflicts);

      // Check if confidence meets threshold
      if (confidence < confidenceThreshold) {
        console.warn(`EntityResolver.resolveEntities - Resolution confidence ${confidence} below threshold ${confidenceThreshold}`);
      }

      return {
        resolvedEntity,
        sources: entities.map(e => e.id!).filter(id => id),
        conflicts,
        confidence
      };
    } catch (error) {
      console.error('EntityResolver.resolveEntities - Error:', error);
      return null;
    }
  }

  /**
   * Detect conflicts between entities
   */
  private detectConflicts(entities: CompanyData[]): string[] {
    const conflicts: string[] = [];
    const fieldsToCheck = [
      'name_en', 'name_ar', 'business_type', 'description_en', 
      'description_ar', 'website_url', 'phone', 'email', 'city'
    ];

    for (const field of fieldsToCheck) {
      const values = entities
        .map(e => e[field as keyof CompanyData])
        .filter(value => value !== undefined && value !== null && value !== '');

      // Check if all values are the same
      const uniqueValues = [...new Set(values)];
      if (uniqueValues.length > 1) {
        conflicts.push(field);
      }
    }

    return conflicts;
  }

  /**
   * Calculate resolution confidence based on entity similarity and conflicts
   */
  private calculateResolutionConfidence(entities: CompanyData[], conflicts: string[]): number {
    // Start with a base confidence
    let confidence = 0.7;

    // Reduce confidence based on number of conflicts
    confidence -= (conflicts.length * 0.05);

    // Increase confidence if entities share strong identifiers
    const sharedDomain = entities.every(e => e.website_url && entities[0].website_url?.includes(new URL(entities[0].website_url!).hostname));
    if (sharedDomain) {
      confidence += 0.1;
    }

    // Increase confidence if entities share contact info
    const sharedContact = entities.some(e => 
      e.email === entities[0].email || 
      e.phone === entities[0].phone
    );
    if (sharedContact) {
      confidence += 0.1;
    }

    // Ensure confidence stays within bounds
    return Math.min(1.0, Math.max(0.0, confidence));
  }

  /**
   * Merge entities preferring the first (master) entity's values
   */
  private mergePreferMaster(master: CompanyData, duplicates: CompanyData[]): CompanyData {
    const merged: CompanyData = { ...master };

    for (const dup of duplicates) {
      // Fill in missing values from duplicates
      if (!merged.name_en && dup.name_en) merged.name_en = dup.name_en;
      if (!merged.name_ar && dup.name_ar) merged.name_ar = dup.name_ar;
      if (!merged.business_type && dup.business_type) merged.business_type = dup.business_type;
      if (!merged.description_en && dup.description_en) merged.description_en = dup.description_en;
      if (!merged.description_ar && dup.description_ar) merged.description_ar = dup.description_ar;
      if (!merged.website_url && dup.website_url) merged.website_url = dup.website_url;
      if (!merged.phone && dup.phone) merged.phone = dup.phone;
      if (!merged.email && dup.email) merged.email = dup.email;
      if (!merged.city && dup.city) merged.city = dup.city;

      // Handle array fields
      if (dup.categories) {
        merged.categories = [...new Set([...merged.categories || [], ...dup.categories])];
      }
      if (dup.products) {
        merged.products = [...new Set([...merged.products || [], ...dup.products])];
      }
      if (dup.services) {
        merged.services = [...new Set([...merged.services || [], ...dup.services])];
      }
      if (dup.brands) {
        merged.brands = [...new Set([...merged.brands || [], ...dup.brands])];
      }
      if (dup.locations) {
        merged.locations = [...new Set([...merged.locations || [], ...dup.locations])];
      }
    }

    return merged;
  }

  /**
   * Merge entities preferring the most recently updated values
   */
  private mergePreferLatest(entities: CompanyData[]): CompanyData {
    // Sort entities by modification date (assuming there's a modified_at field)
    // For now, we'll just take the first one as master and enhance with newer data from others
    const master = { ...entities[0] };
    
    // We would normally sort by modification date, but without that info
    // we'll just combine all unique values preferring later entities
    for (const entity of entities.slice(1)) {
      // Prefer entity's values over master's if they exist
      if (entity.name_en) master.name_en = entity.name_en;
      if (entity.name_ar) master.name_ar = entity.name_ar;
      if (entity.business_type) master.business_type = entity.business_type;
      if (entity.description_en) master.description_en = entity.description_en;
      if (entity.description_ar) master.description_ar = entity.description_ar;
      if (entity.website_url) master.website_url = entity.website_url;
      if (entity.phone) master.phone = entity.phone;
      if (entity.email) master.email = entity.email;
      if (entity.city) master.city = entity.city;

      // Handle array fields
      if (entity.categories) {
        master.categories = [...new Set([...master.categories || [], ...entity.categories])];
      }
      if (entity.products) {
        master.products = [...new Set([...master.products || [], ...entity.products])];
      }
      if (entity.services) {
        master.services = [...new Set([...master.services || [], ...entity.services])];
      }
      if (entity.brands) {
        master.brands = [...new Set([...master.brands || [], ...entity.brands])];
      }
      if (entity.locations) {
        master.locations = [...new Set([...master.locations || [], ...entity.locations])];
      }
    }

    return master;
  }

  /**
   * Merge entities using majority rule for conflicting values
   */
  private mergeMajorityRule(entities: CompanyData[]): CompanyData {
    const merged: CompanyData = {};

    // Define fields to merge
    const stringFields = ['name_en', 'name_ar', 'business_type', 'description_en', 'description_ar', 'website_url', 'phone', 'email', 'city'];

    for (const field of stringFields) {
      // Get all non-empty values for this field
      const values = entities
        .map(e => e[field as keyof CompanyData] as string)
        .filter(value => value && value.trim() !== '');

      if (values.length > 0) {
        // Find the most common value (majority)
        const counts: Record<string, number> = {};
        for (const value of values) {
          counts[value] = (counts[value] || 0) + 1;
        }

        // Find the value with the highest count
        let majorityValue = values[0];
        let maxCount = 0;
        for (const [value, count] of Object.entries(counts)) {
          if (count > maxCount) {
            maxCount = count;
            majorityValue = value;
          }
        }

        (merged as any)[field] = majorityValue;
      }
    }

    // Handle array fields by combining all values
    const arrayFields = ['categories', 'products', 'services', 'brands', 'locations'];
    for (const field of arrayFields) {
      const allArrays = entities
        .map(e => e[field as keyof CompanyData] as string[])
        .filter(arr => Array.isArray(arr)) as string[][];
      
      if (allArrays.length > 0) {
        const combinedArray = ([] as string[]).concat(...allArrays);
        (merged as any)[field] = [...new Set(combinedArray)];
      }
    }

    return merged;
  }

  /**
   * Update the resolved entity in the database
   */
  async saveResolvedEntity(resolvedResult: ResolutionResult): Promise<boolean> {
    if (!resolvedResult.resolvedEntity.id) {
      console.error('EntityResolver.saveResolvedEntity - Cannot save entity without ID');
      return false;
    }

    try {
      // Update the main company record
      const { error: updateError } = await supabaseAdmin
        .from('companies')
        .update(resolvedResult.resolvedEntity)
        .eq('id', resolvedResult.resolvedEntity.id);

      if (updateError) {
        console.error('EntityResolver.saveResolvedEntity - Error updating company:', updateError);
        return false;
      }

      // Optionally, mark the source entities as merged/deprecated
      if (resolvedResult.sources.length > 1) {
        // Log the merge in the audit log
        const { error: logError } = await supabaseAdmin
          .from('ai_merge_rankings')  // Using this table to log merges
          .insert({
            source_company_ids: resolvedResult.sources,
            merged_into_id: resolvedResult.resolvedEntity.id,
            resolution_confidence: resolvedResult.confidence,
            created_at: new Date().toISOString()
          });

        if (logError) {
          console.warn('EntityResolver.saveResolvedEntity - Error logging merge:', logError);
        }
      }

      return true;
    } catch (error) {
      console.error('EntityResolver.saveResolvedEntity - Error:', error);
      return false;
    }
  }

  /**
   * Find potential duplicates for a given company
   */
  async findPotentialDuplicates(company: CompanyData, threshold: number = 0.8): Promise<CompanyData[]> {
    try {
      // First, do a basic lookup by domain or exact name match
      let query = supabaseAdmin.from('companies').select('*').neq('id', company.id || '');
      
      if (company.website_url) {
        try {
          const url = new URL(company.website_url);
          query = query.ilike('website_url', `%${url.hostname}%`);
        } catch {
          // If URL parsing fails, continue without domain matching
        }
      } else if (company.name_en) {
        query = query.ilike('name_en', `%${company.name_en}%`);
      } else if (company.name_ar) {
        query = query.ilike('name_ar', `%${company.name_ar}%`);
      }

      const { data: candidates, error } = await query.limit(50);

      if (error) {
        console.error('EntityResolver.findPotentialDuplicates - Error querying candidates:', error);
        return [];
      }

      if (!candidates) {
        return [];
      }

      // Filter candidates using the deduper
      return candidates.filter(candidate => {
        const result = deduper.isDuplicate(company, candidate);
        return result.isDuplicate && result.confidence >= threshold;
      });
    } catch (error) {
      console.error('EntityResolver.findPotentialDuplicates - Error:', error);
      return [];
    }
  }
}

// Export a singleton instance
export const entityResolver = new EntityResolver();