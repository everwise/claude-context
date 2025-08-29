/**
 * Result of query preprocessing operations
 */
export interface PreprocessingResult {
    /** Original input query */
    originalQuery: string;
    /** Normalized query with basic cleaning */
    normalizedQuery: string;
    /** List of expanded terms and variants */
    expandedTerms: string[];
    /** Detected patterns (filenames, languages, etc.) */
    detectedPatterns: string[];
    /** Human-readable reasoning for the preprocessing decisions */
    reasoning: string;
}

/**
 * Configuration options for query preprocessing
 */
export interface QueryPreprocessorConfig {
    /** Enable abbreviation expansion (js -> javascript) */
    enableAbbreviationExpansion?: boolean;
    /** Enable conceptual mapping (error handling -> try catch finally) */
    enableConceptualMapping?: boolean;
    /** Enable case splitting (camelCase -> camel Case) */
    enableCaseSplitting?: boolean;
    /** Enable filename detection and enhancement */
    enableFilenameDetection?: boolean;
    /** Enable programming language detection */
    enableLanguageDetection?: boolean;
    /** Enable implementation-focused query variants */
    enableImplementationFocus?: boolean;
    /** Maximum number of query variants to return */
    maxVariants?: number;
}

/**
 * Map of abbreviations to their full forms
 */
export type AbbreviationMap = Record<string, string>;

/**
 * Map of concepts to their technical terms
 */
export type ConceptMap = Record<string, string[]>;

/**
 * Map of programming languages to their keywords/patterns
 */
export type LanguagePatternMap = Record<string, string[]>;