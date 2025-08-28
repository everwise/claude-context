// Interface definitions for reranking providers
import { VectorSearchResult } from '../vectordb/types';

export interface RerankingResult {
    originalResults: VectorSearchResult[];
    rerankedResults: VectorSearchResult[];
    processingTimeMs: number;
    confidence: number;
    modelUsed: string;
}

/**
 * Abstract base class for reranking implementations
 */
export abstract class BaseReranker {
    protected config: RerankingConfig;
    protected initialized: boolean = false;
    protected initializationPromise: Promise<void> | null = null;

    constructor(config: RerankingConfig) {
        this.config = config;
    }

    /**
     * Initialize the reranker model (lazy initialization)
     */
    async initialize(): Promise<void> {
        if (!this.config.enabled || this.initialized) {
            return;
        }

        if (!this.initializationPromise) {
            this.initializationPromise = this.doInitialize();
        }

        return this.initializationPromise;
    }

    /**
     * Actual initialization implementation
     */
    protected abstract doInitialize(): Promise<void>;

    /**
     * Rerank search results using the model
     * @param query Original search query
     * @param results List of search results to rerank
     * @param topK Number of top results to return
     * @returns Reranked results or original results if reranking fails
     */
    async rerank(
        query: string,
        results: VectorSearchResult[],
        topK: number = 10
    ): Promise<VectorSearchResult[]> {
        if (!this.config.enabled || !this.initialized) {
            return results.slice(0, topK);
        }

        if (results.length === 0) {
            return results;
        }

        try {
            const startTime = Date.now();
            const rerankedResults = await this.doRerank(query, results, topK);
            const processingTime = Date.now() - startTime;

            console.log(`[RERANKING] ✅ ${this.getProvider()} reranking completed: ${results.length} → ${rerankedResults.length} results in ${processingTime}ms`);
            
            return rerankedResults;
        } catch (error: any) {
            console.warn(`[RERANKING] ⚠️  ${this.getProvider()} reranking failed, falling back to original results:`, error.message);
            return results.slice(0, topK);
        }
    }

    /**
     * Actual reranking implementation
     */
    protected abstract doRerank(
        query: string,
        results: VectorSearchResult[],
        topK: number
    ): Promise<VectorSearchResult[]>;

    /**
     * Extract readable content from a search result for reranking input
     */
    protected extractContent(result: VectorSearchResult): string {
        const doc = result.document;
        const parts: string[] = [];

        // Build context-aware content
        if (doc.relativePath) {
            parts.push(`File: ${doc.relativePath}`);
        }
        if (doc.content) {
            parts.push(doc.content);
        }

        const content = parts.join(' ');
        
        // Truncate to reasonable length (following existing patterns)
        return content.length > 2000 ? content.substring(0, 2000) + '...' : content;
    }

    /**
     * Check if reranker is enabled and initialized
     */
    isEnabled(): boolean {
        return this.config.enabled && this.initialized;
    }

    /**
     * Get provider name
     */
    abstract getProvider(): string;

    /**
     * Clean up resources
     */
    abstract cleanup(): void;
}

export interface RerankingConfig {
    enabled: boolean;
    model: string;
    batchSize?: number;
    maxLength?: number;
    quantized?: boolean;
}