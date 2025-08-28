import { BaseReranker, RerankingConfig } from './base-reranker';
import { VectorSearchResult } from '../vectordb/types';

// Type definitions for HuggingFace transformers (to avoid 'any' types)
interface HuggingFaceTokenizer {
    (queries: string[], options: TokenizerOptions): TokenizedInputs;
}

interface TokenizerOptions {
    text_pair: string[];
    padding: boolean;
    truncation: boolean;
    max_length: number;
}

interface TokenizedInputs {
    input_ids: any;
    attention_mask: any;
}

interface HuggingFaceModel {
    (inputs: TokenizedInputs): Promise<ModelOutput>;
}

interface ModelOutput {
    logits: {
        data: Float32Array;
    };
}

interface HuggingFaceTransformers {
    AutoTokenizer: {
        from_pretrained: (modelName: string, options?: any) => Promise<HuggingFaceTokenizer>;
    };
    AutoModelForSequenceClassification: {
        from_pretrained: (modelName: string, options?: any) => Promise<HuggingFaceModel>;
    };
}

/**
 * HuggingFace Transformers.js implementation of cross-encoder reranking
 */
export class HuggingFaceReranker extends BaseReranker {
    private tokenizer: HuggingFaceTokenizer | null = null;
    private model: HuggingFaceModel | null = null;

    constructor(config: RerankingConfig) {
        super({
            enabled: config.enabled,
            model: config.model || 'jinaai/jina-reranker-v2-base-multilingual',
            batchSize: config.batchSize || 16,
            maxLength: config.maxLength || 512,
            quantized: config.quantized !== false, // Default to true
        });
    }

    protected async doInitialize(): Promise<void> {
        if (!this.config.enabled) {
            return;
        }

        try {
            console.log(`[RERANKING] 🔄 Loading ${this.getProvider()} model: ${this.config.model}`);

            // Try to import HuggingFace transformers (optional dependency)
            let transformers: HuggingFaceTransformers;
            try {
                transformers = await import('@huggingface/transformers');
            } catch (importError) {
                const installCmd = process.env.npm_execpath?.includes('pnpm') ? 'pnpm add' : 'npm install';
                throw new Error(
                    `❌ HuggingFace Transformers not available for reranking.\n\n` +
                        `📦 To enable reranking, install the optional dependency:\n` +
                        `   ${installCmd} @huggingface/transformers\n\n` +
                        `💡 Or disable reranking by setting:\n` +
                        `   RERANKING_PROVIDER=Disabled\n` +
                        `   RERANKING_ENABLED=false\n\n` +
                        `🔍 For npx users: The package will auto-install on first use with network access.`
                );
            }

            const { AutoTokenizer, AutoModelForSequenceClassification } = transformers;

            // Load tokenizer
            this.tokenizer = await AutoTokenizer.from_pretrained(this.config.model);

            // Load model with configuration
            this.model = await AutoModelForSequenceClassification.from_pretrained(this.config.model, {
                quantized: this.config.quantized || true,
                device: 'auto', // Force CPU for now, GPU support can be added later
            });

            this.initialized = true;
            console.log(`[RERANKING] ✅ ${this.getProvider()} model loaded successfully`);
        } catch (error: any) {
            console.error(`[RERANKING] ❌ Failed to load ${this.getProvider()} model:`, error.message);
            this.initialized = false;
            throw error;
        }
    }

    protected async doRerank(
        query: string,
        results: VectorSearchResult[],
        topK: number
    ): Promise<VectorSearchResult[]> {
        if (!this.tokenizer || !this.model) {
            throw new Error('HuggingFace reranker not properly initialized');
        }

        const batchSize = this.config.batchSize || 16;
        const allScoredResults: Array<VectorSearchResult & { cross_encoder_score: number }> = [];

        console.log(`[RERANKING] 🔍 Processing ${results.length} results in batches of ${batchSize}`);

        // Process results in batches to manage memory
        for (let i = 0; i < results.length; i += batchSize) {
            const batch = results.slice(i, i + batchSize);
            const batchResults = await this.processBatch(query, batch);
            allScoredResults.push(...batchResults);

            // Log progress for large result sets
            if (results.length > 20) {
                console.log(
                    `[RERANKING] 📊 Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
                        results.length / batchSize
                    )}`
                );
            }
        }

        // Sort by cross-encoder scores (descending) and return top K
        const rerankedResults = allScoredResults
            .sort((a, b) => b.cross_encoder_score - a.cross_encoder_score)
            .slice(0, topK);

        console.log(
            `[RERANKING] 🎯 Top score: ${rerankedResults[0]?.cross_encoder_score?.toFixed(4) || 'N/A'}, Bottom score: ${
                rerankedResults[rerankedResults.length - 1]?.cross_encoder_score?.toFixed(4) || 'N/A'
            }`
        );

        return rerankedResults;
    }

    private async processBatch(
        query: string,
        batch: VectorSearchResult[]
    ): Promise<Array<VectorSearchResult & { cross_encoder_score: number }>> {
        if (!this.tokenizer || !this.model) {
            throw new Error('Model components not initialized');
        }

        try {
            // Extract content from each result in the batch
            const documents = batch.map(result => this.extractContent(result));
            const queries = new Array(documents.length).fill(query);

            // Tokenize the query-document pairs
            const inputs = this.tokenizer(queries, {
                text_pair: documents,
                padding: true,
                truncation: true,
                max_length: this.config.maxLength || 512,
            });

            // Get relevance scores from the model
            const outputs = await this.model(inputs);
            const scores = Array.from(outputs.logits.data);

            // Combine original results with cross-encoder scores
            return batch.map((result, idx) => ({
                ...result,
                cross_encoder_score: scores[idx],
            }));
        } catch (error: any) {
            console.warn(`[RERANKING] ⚠️  Batch processing failed, assigning neutral scores:`, error.message);

            // Return batch with neutral scores as fallback
            return batch.map(result => ({
                ...result,
                cross_encoder_score: 0.5,
            }));
        }
    }

    getProvider(): string {
        return 'HuggingFace';
    }

    cleanup(): void {
        this.tokenizer = null;
        this.model = null;
        this.initialized = false;
        this.initializationPromise = null;
        console.log(`[RERANKING] 🧹 ${this.getProvider()} reranker cleaned up`);
    }

    /**
     * Get model information for debugging/monitoring
     */
    getModelInfo(): { model: string; provider: string; enabled: boolean; initialized: boolean } {
        return {
            model: this.config.model,
            provider: this.getProvider(),
            enabled: this.config.enabled,
            initialized: this.initialized,
        };
    }
}
