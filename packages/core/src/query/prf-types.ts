/**
 * Pseudo-Relevance Feedback (PRF) configuration options
 * Based on research-backed optimal parameters for code search
 */
export interface PRFConfig {
    /** Enable PRF for query expansion */
    enabled: boolean;
    
    /** Number of pseudo-relevant documents to analyze (research: 5-10 optimal) */
    topK: number;
    
    /** Number of expansion terms to add to query (research: 5-10 optimal) */
    expansionTerms: number;
    
    /** Minimum term frequency threshold to include term */
    minTermFreq: number;
    
    /** Original query weight in interpolation (research: 0.6-0.8 for RM3) */
    originalWeight: number;
    
    /** Enable code-aware tokenization (camelCase, snake_case splitting) */
    codeTokens: boolean;
    
    /** Programming language stop words to filter out */
    stopWords: Set<string>;
    
    /** Minimum term length to consider for expansion */
    minTermLength: number;
}

/**
 * Represents an expansion term with scoring metrics
 */
export interface ExpansionTerm {
    /** The expansion term */
    term: string;
    
    /** TF-IDF score of the term */
    score: number;
    
    /** Total frequency across all pseudo-relevant documents */
    frequency: number;
    
    /** Number of documents containing this term */
    documentCount: number;
    
    /** Source of term extraction */
    source: 'tfidf' | 'frequency' | 'context';
}

/**
 * Result of PRF query expansion process
 */
export interface PRFResult {
    /** Original input query */
    originalQuery: string;
    
    /** Expanded query with PRF terms */
    expandedQuery: string;
    
    /** Extracted expansion terms with scores */
    expansionTerms: ExpansionTerm[];
    
    /** Number of pseudo-relevant documents analyzed */
    documentsAnalyzed: number;
    
    /** Human-readable reasoning for the expansion */
    reasoning: string;
    
    /** Processing time in milliseconds */
    processingTimeMs: number;
}

/**
 * Default PRF configuration based on research findings
 */
export const DEFAULT_PRF_CONFIG: PRFConfig = {
    enabled: false,                    // Opt-in for now
    topK: 7,                          // Research sweet spot: 5-10
    expansionTerms: 8,                // Research optimal: 5-10  
    minTermFreq: 2,                   // Filter low-frequency terms
    originalWeight: 0.7,              // RM3 research: 0.6-0.8
    codeTokens: true,                 // Enable for code search
    minTermLength: 3,                 // Filter very short terms
    stopWords: new Set([
        // Common programming stop words
        'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'an', 'a',
        'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
        'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'this', 'that',
        'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
        'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'get', 'set', 'var', 'let',
        'const', 'if', 'else', 'then', 'when', 'where', 'how', 'why', 'what', 'which', 'who',
        // Code-specific stop words
        'todo', 'fixme', 'hack', 'note', 'warning', 'deprecated', 'readonly', 'abstract',
        'static', 'final', 'override', 'virtual', 'async', 'await', 'yield', 'return'
    ])
};

/**
 * PRF processing statistics for performance monitoring
 */
export interface PRFStats {
    /** Total queries processed with PRF */
    totalQueries: number;
    
    /** Average processing time in milliseconds */
    avgProcessingTime: number;
    
    /** Average number of expansion terms generated */
    avgExpansionTerms: number;
    
    /** Success rate (queries that generated valid expansions) */
    successRate: number;
    
    /** Cache hit rate for repeated queries */
    cacheHitRate: number;
}