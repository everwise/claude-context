import { TfIdf } from '../utils/tf-idf';
import { PRFConfig, PRFResult, ExpansionTerm, DEFAULT_PRF_CONFIG } from './prf-types';
import { SemanticSearchResult } from '../types';

/**
 * Pseudo-Relevance Feedback (PRF) Engine for query expansion
 * 
 * Implements research-backed PRF methodology:
 * 1. Analyzes top-K pseudo-relevant documents from BM25/hybrid search
 * 2. Extracts high-value expansion terms using TF-IDF analysis
 * 3. Expands original query using RM3-style interpolation
 * 4. Optimized for code search with programming language awareness
 */
export class PRFEngine {
    private config: PRFConfig;
    private tfIdf: TfIdf;
    private stats: {
        totalQueries: number;
        totalProcessingTime: number;
        successfulExpansions: number;
    };

    constructor(config?: Partial<PRFConfig>) {
        this.config = { ...DEFAULT_PRF_CONFIG, ...config };
        this.tfIdf = new TfIdf();
        this.stats = {
            totalQueries: 0,
            totalProcessingTime: 0,
            successfulExpansions: 0
        };
    }

    /**
     * Expand query using pseudo-relevance feedback from search results
     * 
     * @param originalQuery - Original search query
     * @param searchResults - Pseudo-relevant documents from initial search
     * @returns PRF result with expanded query and metadata
     */
    async expandQuery(
        originalQuery: string,
        searchResults: SemanticSearchResult[]
    ): Promise<PRFResult> {
        const startTime = Date.now();
        this.stats.totalQueries++;

        try {
            // Validate inputs
            if (!originalQuery?.trim()) {
                throw new Error('Original query cannot be empty');
            }

            if (!searchResults || searchResults.length === 0) {
                return this.createEmptyResult(originalQuery, startTime, 'No search results provided');
            }

            // Select pseudo-relevant documents (top-K)
            const pseudoRelevantDocs = searchResults.slice(0, this.config.topK);
            
            if (pseudoRelevantDocs.length < Math.min(3, this.config.topK)) {
                return this.createEmptyResult(
                    originalQuery, 
                    startTime, 
                    `Insufficient documents: ${pseudoRelevantDocs.length} < ${Math.min(3, this.config.topK)} required`
                );
            }

            // Extract and rank expansion terms
            const expansionTerms = await this.extractExpansionTerms(
                originalQuery,
                pseudoRelevantDocs
            );

            if (expansionTerms.length === 0) {
                return this.createEmptyResult(
                    originalQuery,
                    startTime, 
                    'No valid expansion terms found after filtering'
                );
            }

            // Generate expanded query using RM3 interpolation
            const expandedQuery = this.buildExpandedQuery(originalQuery, expansionTerms);
            
            const result: PRFResult = {
                originalQuery,
                expandedQuery,
                expansionTerms,
                documentsAnalyzed: pseudoRelevantDocs.length,
                reasoning: this.generateReasoning(originalQuery, expansionTerms, pseudoRelevantDocs.length),
                processingTimeMs: Date.now() - startTime
            };

            this.stats.successfulExpansions++;
            this.stats.totalProcessingTime += result.processingTimeMs;

            return result;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            this.stats.totalProcessingTime += processingTime;

            return {
                originalQuery,
                expandedQuery: originalQuery, // Fallback to original
                expansionTerms: [],
                documentsAnalyzed: 0,
                reasoning: `PRF expansion failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                processingTimeMs: processingTime
            };
        }
    }

    /**
     * Extract and rank expansion terms from pseudo-relevant documents
     */
    private async extractExpansionTerms(
        originalQuery: string,
        pseudoRelevantDocs: SemanticSearchResult[]
    ): Promise<ExpansionTerm[]> {
        // Reset TF-IDF corpus for this query
        this.tfIdf = new TfIdf();

        // Preprocess documents with code-aware tokenization
        const processedDocs = pseudoRelevantDocs.map(doc => 
            this.preprocessContent(doc.content)
        );

        // Build corpus for TF-IDF analysis
        this.tfIdf.createCorpusFromStringArray(processedDocs);

        // Extract all terms with their statistics
        const termStats = this.calculateTermStatistics(originalQuery, processedDocs);

        // Filter and rank terms
        const candidateTerms = Array.from(termStats.entries())
            .map(([term, stats]) => ({
                term,
                score: stats.tfidfScore,
                frequency: stats.frequency,
                documentCount: stats.documentCount,
                source: 'tfidf' as const
            }))
            .filter(term => this.shouldIncludeTerm(term.term, originalQuery))
            .sort((a, b) => b.score - a.score) // Sort by TF-IDF score descending
            .slice(0, this.config.expansionTerms); // Take top N terms

        return candidateTerms;
    }

    /**
     * Calculate TF-IDF statistics for all terms in the document corpus
     */
    private calculateTermStatistics(
        originalQuery: string,
        documents: string[]
    ): Map<string, { tfidfScore: number; frequency: number; documentCount: number }> {
        const termStats = new Map<string, { tfidfScore: number; frequency: number; documentCount: number }>();

        // Process each document
        documents.forEach((doc, docIndex) => {
            const docTerms = doc.split(/\s+/).filter(term => term.length > 0);
            const uniqueTerms = [...new Set(docTerms)];

            // Calculate TF-IDF for each unique term in this document
            uniqueTerms.forEach(term => {
                const tf = this.tfIdf.calculateTermFrequency(term, docTerms);
                const idf = this.tfIdf.calculateInverseDocumentFrequency(term);
                const tfidfScore = tf * idf;

                if (!termStats.has(term)) {
                    termStats.set(term, {
                        tfidfScore: 0,
                        frequency: 0,
                        documentCount: 0
                    });
                }

                const stats = termStats.get(term)!;
                
                // Use maximum TF-IDF score across documents (best case)
                stats.tfidfScore = Math.max(stats.tfidfScore, tfidfScore);
                
                // Accumulate frequency across all documents
                stats.frequency += docTerms.filter(t => t === term).length;
                
                // Count documents containing this term
                stats.documentCount += 1;
            });
        });

        return termStats;
    }

    /**
     * Preprocess document content with code-aware tokenization
     */
    private preprocessContent(content: string): string {
        if (!content) return '';

        let processed = content;

        if (this.config.codeTokens) {
            // Code-aware preprocessing
            processed = processed
                // Split camelCase: getUserName -> get User Name
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                // Split snake_case: user_name -> user name
                .replace(/_+/g, ' ')
                // Split kebab-case: user-name -> user name  
                .replace(/-+/g, ' ')
                // Handle common code patterns
                .replace(/([a-zA-Z])(\d)/g, '$1 $2')  // Split alphanumeric: abc123 -> abc 123
                .replace(/(\d)([a-zA-Z])/g, '$1 $2');  // Split numeric-alpha: 123abc -> 123 abc
        }

        // General text normalization
        return processed
            .replace(/[^\w\s]/g, ' ')      // Remove special characters except word chars and spaces
            .replace(/\s+/g, ' ')          // Normalize whitespace
            .toLowerCase()                 // Convert to lowercase
            .trim();                       // Remove leading/trailing spaces
    }

    /**
     * Determine if a term should be included as an expansion candidate
     */
    private shouldIncludeTerm(term: string, originalQuery: string): boolean {
        const termLower = term.toLowerCase();
        const queryLower = originalQuery.toLowerCase();

        return (
            // Length filter
            term.length >= this.config.minTermLength &&
            
            // Frequency filter (handled by TF-IDF scoring)
            
            // Stop words filter
            !this.config.stopWords.has(termLower) &&
            
            // Not in original query
            !queryLower.includes(termLower) &&
            
            // Not pure numbers
            !/^\d+$/.test(term) &&
            
            // Starts with letter (programming convention)
            /^[a-zA-Z]/.test(term) &&
            
            // Not common noise patterns
            !this.isNoisePattern(term)
        );
    }

    /**
     * Check if term matches common noise patterns
     */
    private isNoisePattern(term: string): boolean {
        const noisePatterns = [
            /^[a-z]$/,           // Single letters
            /^\d+[a-z]?$/,       // Numbers with optional single letter
            /^x{2,}$/,           // Multiple x's (xxx, xxxx)
            /^[xyz]\d*$/,        // Variable-like patterns (x, y, z with numbers)
        ];

        return noisePatterns.some(pattern => pattern.test(term));
    }

    /**
     * Build expanded query using RM3-style interpolation
     */
    private buildExpandedQuery(originalQuery: string, expansionTerms: ExpansionTerm[]): string {
        if (expansionTerms.length === 0) {
            return originalQuery;
        }

        // Select top expansion terms based on configuration
        const topTerms = expansionTerms
            .slice(0, Math.min(this.config.expansionTerms, expansionTerms.length))
            .map(term => term.term);

        // RM3-style interpolation: weighted combination of original and expansion terms
        const originalWeight = this.config.originalWeight;
        const expansionWeight = 1 - originalWeight;

        // For simplicity, we'll use concatenation with implicit weighting
        // More sophisticated implementations would use proper RM3 probability interpolation
        if (expansionWeight > 0.5) {
            // Expansion terms more important - put them first
            return `${topTerms.join(' ')} ${originalQuery}`;
        } else {
            // Original query more important - put it first
            return `${originalQuery} ${topTerms.join(' ')}`;
        }
    }

    /**
     * Generate human-readable reasoning for the expansion
     */
    private generateReasoning(
        originalQuery: string,
        expansionTerms: ExpansionTerm[],
        documentsAnalyzed: number
    ): string {
        const reasons: string[] = [];

        reasons.push(`Analyzed ${documentsAnalyzed} pseudo-relevant documents`);
        
        if (expansionTerms.length > 0) {
            reasons.push(`Extracted ${expansionTerms.length} expansion terms using TF-IDF analysis`);
            
            const topTerms = expansionTerms.slice(0, 3).map(t => t.term);
            reasons.push(`Top terms: ${topTerms.join(', ')}`);
            
            const avgScore = expansionTerms.reduce((sum, term) => sum + term.score, 0) / expansionTerms.length;
            reasons.push(`Average TF-IDF score: ${avgScore.toFixed(3)}`);
        }

        if (this.config.codeTokens) {
            reasons.push('Applied code-aware tokenization');
        }

        return reasons.join('; ');
    }

    /**
     * Create empty result for error/edge cases
     */
    private createEmptyResult(originalQuery: string, startTime: number, reason: string): PRFResult {
        return {
            originalQuery,
            expandedQuery: originalQuery,
            expansionTerms: [],
            documentsAnalyzed: 0,
            reasoning: reason,
            processingTimeMs: Date.now() - startTime
        };
    }

    /**
     * Get current PRF processing statistics
     */
    public getStats(): {
        totalQueries: number;
        avgProcessingTime: number;
        successRate: number;
    } {
        return {
            totalQueries: this.stats.totalQueries,
            avgProcessingTime: this.stats.totalQueries > 0 
                ? this.stats.totalProcessingTime / this.stats.totalQueries 
                : 0,
            successRate: this.stats.totalQueries > 0 
                ? this.stats.successfulExpansions / this.stats.totalQueries 
                : 0
        };
    }

    /**
     * Reset statistics
     */
    public resetStats(): void {
        this.stats = {
            totalQueries: 0,
            totalProcessingTime: 0,
            successfulExpansions: 0
        };
    }
}