import {
    Splitter,
    CodeChunk,
    AstCodeSplitter
} from './splitter';
import {
    Embedding,
    EmbeddingVector,
    OpenAIEmbedding
} from './embedding';
import { EmbeddingCache } from './cache/embedding-cache';
import {
    VectorDatabase,
    VectorDocument,
    VectorSearchResult,
    HybridSearchRequest,
    HybridSearchOptions,
    HybridSearchResult
} from './vectordb';
import { SemanticSearchResult } from './types';
import { BaseReranker, HuggingFaceReranker, RerankingConfig } from './reranking';
import { SimpleQueryPreprocessor, QueryPreprocessorConfig, PreprocessingResult, PRFEngine, PRFConfig } from './query';
import { envManager } from './utils/env-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import ignore from 'ignore';
import { FileSynchronizer } from './sync/synchronizer';

const DEFAULT_SUPPORTED_EXTENSIONS = [
    // Programming languages
    '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
    '.cs', '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.m', '.mm',
    // Text and markup files
    '.md', '.markdown', '.ipynb',
    // '.txt',  '.json', '.yaml', '.yml', '.xml', '.html', '.htm',
    // '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.env'
];

const DEFAULT_IGNORE_PATTERNS = [
    // Common build output and dependency directories
    'node_modules/**',
    'dist/**',
    'build/**',
    'out/**',
    'target/**',
    'coverage/**',
    '.nyc_output/**',

    // IDE and editor files
    '.vscode/**',
    '.idea/**',
    '*.swp',
    '*.swo',

    // Version control
    '.git/**',
    '.svn/**',
    '.hg/**',

    // Cache directories
    '.cache/**',
    '__pycache__/**',
    '.pytest_cache/**',

    // Logs and temporary files
    'logs/**',
    'tmp/**',
    'temp/**',
    '*.log',

    // Environment and config files
    '.env',
    '.env.*',
    '*.local',

    // Minified and bundled files
    '*.min.js',
    '*.min.css',
    '*.min.map',
    '*.bundle.js',
    '*.bundle.css',
    '*.chunk.js',
    '*.vendor.js',
    '*.polyfills.js',
    '*.runtime.js',
    '*.map', // source map files
    'node_modules', '.git', '.svn', '.hg', 'build', 'dist', 'out',
    'target', '.vscode', '.idea', '__pycache__', '.pytest_cache',
    'coverage', '.nyc_output', 'logs', 'tmp', 'temp'
];

export interface ContextConfig {
    embedding?: Embedding;
    vectorDatabase?: VectorDatabase;
    codeSplitter?: Splitter;
    supportedExtensions?: string[];
    ignorePatterns?: string[];
    customExtensions?: string[]; // New: custom extensions from MCP
    customIgnorePatterns?: string[]; // New: custom ignore patterns from MCP
    reranking?: RerankingConfig; // New: reranking configuration
    queryPreprocessor?: QueryPreprocessorConfig; // New: query preprocessing configuration
    prf?: PRFConfig; // New: pseudo-relevance feedback configuration
}

export class Context {
    private embedding: Embedding;
    private vectorDatabase: VectorDatabase;
    private codeSplitter: Splitter;
    private supportedExtensions: string[];
    private ignorePatterns: string[];
    private reranker: BaseReranker | null = null;
    private queryPreprocessor: SimpleQueryPreprocessor;
    private prfEngine: PRFEngine | null = null;
    private synchronizers = new Map<string, FileSynchronizer>();
    private projectIgnorePatterns = new Map<string, string[]>(); // Per-project patterns
    private projectIgnoreHandlers = new Map<string, any>(); // ignore library instances per project
    private embeddingCache: EmbeddingCache;

    constructor(config: ContextConfig = {}) {
        // Initialize services
        this.embedding = config.embedding || new OpenAIEmbedding({
            apiKey: envManager.get('OPENAI_API_KEY') || 'your-openai-api-key',
            model: 'text-embedding-3-small',
            ...(envManager.get('OPENAI_BASE_URL') && { baseURL: envManager.get('OPENAI_BASE_URL') })
        });

        if (!config.vectorDatabase) {
            throw new Error('VectorDatabase is required. Please provide a vectorDatabase instance in the config.');
        }
        this.vectorDatabase = config.vectorDatabase;

        this.codeSplitter = config.codeSplitter || new AstCodeSplitter(2500, 300);

        // Initialize reranker if configured
        if (config.reranking?.enabled) {
            this.reranker = this.createReranker(config.reranking);
            console.log(`[Context] 🔄 Initialized reranker: ${this.reranker.getProvider()} with model: ${config.reranking.model}`);
        } else {
            console.log(`[Context] 🚫 Reranking disabled`);
        }

        // Initialize query preprocessor
        this.queryPreprocessor = new SimpleQueryPreprocessor(config.queryPreprocessor);
        console.log(`[Context] 🔍 Initialized query preprocessor with configuration`);

        // Initialize PRF engine if configured
        if (config.prf?.enabled) {
            this.prfEngine = new PRFEngine(config.prf);
            console.log(`[Context] 🚀 Initialized PRF engine: topK=${config.prf.topK}, expansionTerms=${config.prf.expansionTerms}, codeTokens=${config.prf.codeTokens}`);
        } else {
            console.log(`[Context] 🚫 PRF (Pseudo-Relevance Feedback) disabled`);
        }

        // Load custom extensions from environment variables
        const envCustomExtensions = this.getCustomExtensionsFromEnv();

        // Combine default extensions with config extensions and env extensions
        const allSupportedExtensions = [
            ...DEFAULT_SUPPORTED_EXTENSIONS,
            ...(config.supportedExtensions || []),
            ...(config.customExtensions || []),
            ...envCustomExtensions
        ];
        // Remove duplicates
        this.supportedExtensions = [...new Set(allSupportedExtensions)];

        // Load custom ignore patterns from environment variables
        const envCustomIgnorePatterns = this.getCustomIgnorePatternsFromEnv();

        // Start with default ignore patterns
        const allIgnorePatterns = [
            ...DEFAULT_IGNORE_PATTERNS,
            ...(config.ignorePatterns || []),
            ...(config.customIgnorePatterns || []),
            ...envCustomIgnorePatterns
        ];
        // Remove duplicates
        this.ignorePatterns = [...new Set(allIgnorePatterns)];

        console.log(`[Context] 🔧 Initialized with ${this.supportedExtensions.length} supported extensions and ${this.ignorePatterns.length} ignore patterns`);
        if (envCustomExtensions.length > 0) {
            console.log(`[Context] 📎 Loaded ${envCustomExtensions.length} custom extensions from environment: ${envCustomExtensions.join(', ')}`);
        }
        if (envCustomIgnorePatterns.length > 0) {
            console.log(`[Context] 🚫 Loaded ${envCustomIgnorePatterns.length} custom ignore patterns from environment: ${envCustomIgnorePatterns.join(', ')}`);
        }

        this.embeddingCache = new EmbeddingCache();
        // Initialize cache asynchronously (don't await to avoid blocking constructor)
        this.embeddingCache.initialize().catch(error => {
            console.warn('[Context] Failed to initialize embedding cache:', error);
        });
    }

    /**
     * Get embedding instance
     */
    getEmbedding(): Embedding {
        return this.embedding;
    }

    /**
     * Get vector database instance
     */
    getVectorDatabase(): VectorDatabase {
        return this.vectorDatabase;
    }

    /**
     * Get code splitter instance
     */
    getCodeSplitter(): Splitter {
        return this.codeSplitter;
    }

    /**
     * Get supported extensions
     */
    getSupportedExtensions(): string[] {
        return [...this.supportedExtensions];
    }

    /**
     * Get ignore patterns
     */
    getIgnorePatterns(): string[] {
        return [...this.ignorePatterns];
    }

    /**
     * Get project-specific ignore patterns for a codebase
     */
    getProjectIgnorePatterns(codebasePath: string): string[] {
        const normalizedPath = path.resolve(codebasePath);
        return this.projectIgnorePatterns.get(normalizedPath) || [...this.ignorePatterns];
    }

    /**
     * Get reranker instance
     */
    getReranker(): BaseReranker | null {
        return this.reranker;
    }

    /**
     * Get synchronizers map
     */
    getSynchronizers(): Map<string, FileSynchronizer> {
        return new Map(this.synchronizers);
    }

    /**
     * Set synchronizer for a collection
     */
    setSynchronizer(collectionName: string, synchronizer: FileSynchronizer): void {
        this.synchronizers.set(collectionName, synchronizer);
    }

    /**
     * Public wrapper for loadIgnorePatterns private method
     */
    async getLoadedIgnorePatterns(codebasePath: string): Promise<void> {
        return this.loadIgnorePatterns(codebasePath);
    }

    /**
     * Public wrapper for prepareCollection private method
     */
    async getPreparedCollection(codebasePath: string): Promise<void> {
        return this.prepareCollection(codebasePath);
    }

    /**
     * Create reranker instance based on configuration
     */
    private createReranker(config: RerankingConfig): BaseReranker {
        // For now, only HuggingFace is supported
        // This can be extended to support other providers in the future
        return new HuggingFaceReranker(config);
    }

    /**
     * Get isHybrid setting from environment variable with default true
     */
    private getIsHybrid(): boolean {
        const isHybridEnv = envManager.get('HYBRID_MODE');
        if (isHybridEnv === undefined || isHybridEnv === null) {
            return true; // Default to true
        }
        return isHybridEnv.toLowerCase() === 'true';
    }

    /**
     * Generate collection name based on codebase path and hybrid mode
     */
    public getCollectionName(codebasePath: string): string {
        const isHybrid = this.getIsHybrid();
        const normalizedPath = path.resolve(codebasePath);
        const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');
        const prefix = isHybrid === true ? 'hybrid_code_chunks' : 'code_chunks';
        return `${prefix}_${hash.substring(0, 8)}`;
    }

    /**
     * Index a codebase for semantic search
     * @param codebasePath Codebase root path
     * @param progressCallback Optional progress callback function
     * @param forceReindex Whether to recreate the collection even if it exists
     * @returns Indexing statistics
     */
    async indexCodebase(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void,
        forceReindex: boolean = false
    ): Promise<{ indexedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' }> {
        const isHybrid = this.getIsHybrid();
        const searchType = isHybrid === true ? 'hybrid search' : 'semantic search';
        console.log(`[Context] 🚀 Starting to index codebase with ${searchType}: ${codebasePath}`);

        // 1. Load ignore patterns from various ignore files
        await this.loadIgnorePatterns(codebasePath);

        // 2. Check and prepare vector collection
        progressCallback?.({ phase: 'Preparing collection...', current: 0, total: 100, percentage: 0 });
        console.log(`Debug2: Preparing vector collection for codebase${forceReindex ? ' (FORCE REINDEX)' : ''}`);
        await this.prepareCollection(codebasePath, forceReindex);

        // 3. Recursively traverse codebase to get all supported files
        progressCallback?.({ phase: 'Scanning files...', current: 5, total: 100, percentage: 5 });
        const codeFiles = await this.getCodeFiles(codebasePath);
        console.log(`[Context] 📁 Found ${codeFiles.length} code files`);

        if (codeFiles.length === 0) {
            progressCallback?.({ phase: 'No files to index', current: 100, total: 100, percentage: 100 });
            return { indexedFiles: 0, totalChunks: 0, status: 'completed' };
        }

        // 3. Process each file with streaming chunk processing
        // Reserve 10% for preparation, 90% for actual indexing
        const indexingStartPercentage = 10;
        const indexingEndPercentage = 100;
        const indexingRange = indexingEndPercentage - indexingStartPercentage;

        const result = await this.processFileList(
            codeFiles,
            codebasePath,
            (filePath, fileIndex, totalFiles) => {
                // Calculate progress percentage
                const progressPercentage = indexingStartPercentage + (fileIndex / totalFiles) * indexingRange;

                console.log(`[Context] 📊 Processed ${fileIndex}/${totalFiles} files`);
                progressCallback?.({
                    phase: `Processing files (${fileIndex}/${totalFiles})...`,
                    current: fileIndex,
                    total: totalFiles,
                    percentage: Math.round(progressPercentage)
                });
            }
        );

        console.log(`[Context] ✅ Codebase indexing completed! Processed ${result.processedFiles} files in total, generated ${result.totalChunks} code chunks`);

        progressCallback?.({
            phase: 'Indexing complete!',
            current: result.processedFiles,
            total: codeFiles.length,
            percentage: 100
        });

        return {
            indexedFiles: result.processedFiles,
            totalChunks: result.totalChunks,
            status: result.status
        };
    }

    async reindexByChange(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void
    ): Promise<{ added: number, removed: number, modified: number }> {
        const collectionName = this.getCollectionName(codebasePath);
        const synchronizer = this.synchronizers.get(collectionName);

        if (!synchronizer) {
            // Load project-specific ignore patterns before creating FileSynchronizer
            await this.loadIgnorePatterns(codebasePath);

            // Use project-specific ignore patterns for this codebase
            const projectIgnorePatterns = this.getProjectIgnorePatterns(codebasePath);
            const newSynchronizer = new FileSynchronizer(codebasePath, projectIgnorePatterns);
            await newSynchronizer.initialize();
            this.synchronizers.set(collectionName, newSynchronizer);
        }

        const currentSynchronizer = this.synchronizers.get(collectionName)!;

        progressCallback?.({ phase: 'Checking for file changes...', current: 0, total: 100, percentage: 0 });
        const { added, removed, modified } = await currentSynchronizer.checkForChanges();
        const totalChanges = added.length + removed.length + modified.length;

        if (totalChanges === 0) {
            progressCallback?.({ phase: 'No changes detected', current: 100, total: 100, percentage: 100 });
            console.log('[Context] ✅ No file changes detected.');
            return { added: 0, removed: 0, modified: 0 };
        }

        console.log(`[Context] 🔄 Found changes: ${added.length} added, ${removed.length} removed, ${modified.length} modified.`);

        let processedChanges = 0;
        const updateProgress = (phase: string) => {
            processedChanges++;
            const percentage = Math.round((processedChanges / (removed.length + modified.length + added.length)) * 100);
            progressCallback?.({ phase, current: processedChanges, total: totalChanges, percentage });
        };

        // Handle removed files
        for (const file of removed) {
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Removed ${file}`);
        }

        // Handle modified files
        for (const file of modified) {
            await this.deleteFileChunks(collectionName, file);
            updateProgress(`Deleted old chunks for ${file}`);
        }

        // Handle added and modified files
        const filesToIndex = [...added, ...modified].map(f => path.join(codebasePath, f));

        if (filesToIndex.length > 0) {
            await this.processFileList(
                filesToIndex,
                codebasePath,
                (filePath, fileIndex, totalFiles) => {
                    updateProgress(`Indexed ${filePath} (${fileIndex}/${totalFiles})`);
                }
            );
        }

        console.log(`[Context] ✅ Re-indexing complete. Added: ${added.length}, Removed: ${removed.length}, Modified: ${modified.length}`);
        progressCallback?.({ phase: 'Re-indexing complete!', current: totalChanges, total: totalChanges, percentage: 100 });

        return { added: added.length, removed: removed.length, modified: modified.length };
    }

    private async deleteFileChunks(collectionName: string, relativePath: string): Promise<void> {
        // Escape backslashes for Milvus query expression (Windows path compatibility)
        const escapedPath = relativePath.replace(/\\/g, '\\\\');
        const results = await this.vectorDatabase.query(
            collectionName,
            `relativePath == "${escapedPath}"`,
            ['id']
        );

        if (results.length > 0) {
            const ids = results.map(r => r.id as string).filter(id => id);
            if (ids.length > 0) {
                await this.vectorDatabase.delete(collectionName, ids);
                console.log(`[Context] Deleted ${ids.length} chunks for file ${relativePath}`);
            }
        }
    }

    /**
     * Select the best search query from preprocessing results
     * @param preprocessingResult Result from query preprocessing
     * @returns The most effective query variant for search
     */
    private selectBestSearchQuery(preprocessingResult: PreprocessingResult): string {
        const { originalQuery, expandedTerms, detectedPatterns } = preprocessingResult;

        // Strategy 1: If we have filename patterns, prioritize variants with filenames
        const filenamePatterns = detectedPatterns.filter(p => p.startsWith('filename:'));
        if (filenamePatterns.length > 0) {
            const filenameQuery = expandedTerms.find(term =>
                filenamePatterns.some(pattern =>
                    term.includes(pattern.substring(9)) // Remove 'filename:' prefix
                )
            );
            if (filenameQuery && filenameQuery !== originalQuery) {
                console.log(`[Context] 🎯 Using filename-enhanced query: "${filenameQuery}"`);
                return filenameQuery;
            }
        }

        // Strategy 2: If we have language patterns, prefer variants with language-specific terms
        const languagePatterns = detectedPatterns.filter(p => p.startsWith('language:'));
        if (languagePatterns.length > 0) {
            const languageQuery = expandedTerms.find(term =>
                languagePatterns.some(pattern => {
                    const lang = pattern.substring(9); // Remove 'language:' prefix
                    return term.toLowerCase().includes(lang) && term !== originalQuery;
                })
            );
            if (languageQuery) {
                console.log(`[Context] 🎯 Using language-enhanced query: "${languageQuery}"`);
                return languageQuery;
            }
        }

        // Strategy 3: Look for implementation-focused variants (contain 'function', 'class', 'implementation', etc.)
        const implementationTerms = ['function', 'class', 'method', 'implementation', 'definition'];
        const implQuery = expandedTerms.find(term =>
            term !== originalQuery &&
            implementationTerms.some(implTerm => term.toLowerCase().includes(implTerm))
        );
        if (implQuery) {
            console.log(`[Context] 🎯 Using implementation-focused query: "${implQuery}"`);
            return implQuery;
        }

        // Strategy 4: Prefer expanded technical terms over abbreviations
        const technicalQuery = expandedTerms.find(term =>
            term !== originalQuery &&
            (term.includes('javascript') || term.includes('python') || term.includes('typescript') ||
             term.includes('authentication') || term.includes('configuration') || term.includes('database'))
        );
        if (technicalQuery) {
            console.log(`[Context] 🎯 Using technical term expansion: "${technicalQuery}"`);
            return technicalQuery;
        }

        // Strategy 5: Use the longest variant (likely has most context)
        if (expandedTerms.length > 1) {
            const longestVariant = expandedTerms.reduce((longest, current) =>
                current.length > longest.length ? current : longest
            );
            if (longestVariant !== originalQuery) {
                console.log(`[Context] 🎯 Using longest variant: "${longestVariant}"`);
                return longestVariant;
            }
        }

        // Fallback: Use normalized query (original behavior)
        console.log(`[Context] 🎯 Using normalized query: "${preprocessingResult.normalizedQuery}"`);
        return preprocessingResult.normalizedQuery;
    }

    /**
     * Select the top N search queries based on different strategies
     * @param preprocessingResult Result from query preprocessing
     * @param maxQueries Maximum number of queries to return
     * @returns Array of the most promising query variants
     */
    private selectTopSearchQueries(preprocessingResult: PreprocessingResult, maxQueries: number = 3): string[] {
        const { originalQuery, expandedTerms, detectedPatterns } = preprocessingResult;
        const selectedQueries: string[] = [];
        const usedQueries = new Set<string>();

        // Priority 1: Filename-enhanced queries
        const filenamePatterns = detectedPatterns.filter(p => p.startsWith('filename:'));
        if (filenamePatterns.length > 0 && selectedQueries.length < maxQueries) {
            const filenameQuery = expandedTerms.find(term =>
                filenamePatterns.some(pattern => term.includes(pattern.substring(9))) &&
                !usedQueries.has(term)
            );
            if (filenameQuery) {
                selectedQueries.push(filenameQuery);
                usedQueries.add(filenameQuery);
            }
        }

        // Priority 2: Technical term expansions (js->javascript, auth->authentication)
        if (selectedQueries.length < maxQueries) {
            const technicalQuery = expandedTerms.find(term =>
                term !== originalQuery &&
                !usedQueries.has(term) &&
                (term.includes('javascript') || term.includes('python') || term.includes('typescript') ||
                 term.includes('authentication') || term.includes('configuration') || term.includes('database'))
            );
            if (technicalQuery) {
                selectedQueries.push(technicalQuery);
                usedQueries.add(technicalQuery);
            }
        }

        // Priority 3: Implementation-focused variants
        if (selectedQueries.length < maxQueries) {
            const implementationTerms = ['function', 'class', 'method', 'implementation'];
            const implQuery = expandedTerms.find(term =>
                term !== originalQuery &&
                !usedQueries.has(term) &&
                implementationTerms.some(implTerm => term.toLowerCase().includes(implTerm))
            );
            if (implQuery) {
                selectedQueries.push(implQuery);
                usedQueries.add(implQuery);
            }
        }

        // Fill remaining slots with longest unused variants
        if (selectedQueries.length < maxQueries) {
            const remainingVariants = expandedTerms
                .filter(term => !usedQueries.has(term) && term !== originalQuery)
                .sort((a, b) => b.length - a.length);

            for (const variant of remainingVariants) {
                if (selectedQueries.length >= maxQueries) break;
                selectedQueries.push(variant);
                usedQueries.add(variant);
            }
        }

        // Ensure we always have at least the original or normalized query
        if (selectedQueries.length === 0) {
            selectedQueries.push(preprocessingResult.normalizedQuery);
        }

        console.log(`[Context] 🎯 Selected queries: ${selectedQueries.map(q => `"${q}"`).join(', ')}`);
        return selectedQueries;
    }

    /**
     * Semantic search with unified implementation
     * @param codebasePath Codebase path to search in
     * @param query Search query
     * @param topK Number of results to return
     * @param threshold Similarity threshold
     */
    async semanticSearch(codebasePath: string, query: string, topK: number = 5, threshold: number = 0.5, filterExpr?: string): Promise<SemanticSearchResult[]> {
        const isHybrid = this.getIsHybrid();
        const searchType = isHybrid === true ? 'hybrid search' : 'semantic search';
        console.log(`[Context] 🔍 Executing ${searchType}: "${query}" in ${codebasePath}`);

        // Preprocess the query to generate enhanced variants
        const preprocessingResult = this.queryPreprocessor.preprocessQueryWithMetadata(query);
        console.log(`[Context] 🔍 Query preprocessing: ${preprocessingResult.reasoning}`);
        console.log(`[Context] 🔍 Generated ${preprocessingResult.expandedTerms.length} query variants`);
        if (preprocessingResult.detectedPatterns.length > 0) {
            console.log(`[Context] 🔍 Detected patterns: ${preprocessingResult.detectedPatterns.join(', ')}`);
        }

        // Enhanced search with query variants
        const useMultipleVariants = preprocessingResult.expandedTerms.length > 2 && preprocessingResult.detectedPatterns.length > 0;

        let searchQueries: string[];
        if (useMultipleVariants) {
            // Use top 3 most promising variants for multi-query search
            searchQueries = this.selectTopSearchQueries(preprocessingResult, 3);
            console.log(`[Context] 🔍 Using multi-query search with ${searchQueries.length} variants`);
        } else {
            // Use single best query
            searchQueries = [this.selectBestSearchQuery(preprocessingResult)];
        }

        const primarySearchQuery = searchQueries[0];

        const collectionName = this.getCollectionName(codebasePath);
        console.log(`[Context] 🔍 Using collection: ${collectionName}`);

        // Check if collection exists and has data
        const hasCollection = await this.vectorDatabase.hasCollection(collectionName);
        if (!hasCollection) {
            console.log(`[Context] ⚠️  Collection '${collectionName}' does not exist. Please index the codebase first.`);
            return [];
        }

        if (isHybrid === true) {
            try {
                // Check collection stats to see if it has data
                const stats = await this.vectorDatabase.query(collectionName, '', ['id'], 1);
                console.log(`[Context] 🔍 Collection '${collectionName}' exists and appears to have data`);
            } catch (error) {
                console.log(`[Context] ⚠️  Collection '${collectionName}' exists but may be empty or not properly indexed:`, error);
            }

            // 1. Generate query vector
            console.log(`[Context] 🔍 Generating embeddings for query: "${primarySearchQuery}"`);
            const queryEmbedding: EmbeddingVector = await this.embedding.embed(primarySearchQuery);
            console.log(`[Context] ✅ Generated embedding vector with dimension: ${queryEmbedding.vector.length}`);
            console.log(`[Context] 🔍 First 5 embedding values: [${queryEmbedding.vector.slice(0, 5).join(', ')}]`);

            // 2. Prepare hybrid search requests
            const searchRequests: HybridSearchRequest[] = [
                {
                    data: queryEmbedding.vector,
                    anns_field: "vector",
                    param: { "nprobe": 10 },
                    limit: topK
                },
                {
                    data: primarySearchQuery,
                    anns_field: "sparse_vector",
                    param: { "drop_ratio_search": 0.2 },
                    limit: topK
                }
            ];

            console.log(`[Context] 🔍 Search request 1 (dense): anns_field="${searchRequests[0].anns_field}", vector_dim=${queryEmbedding.vector.length}, limit=${searchRequests[0].limit}`);
            console.log(`[Context] 🔍 Search request 2 (sparse): anns_field="${searchRequests[1].anns_field}", query_text="${primarySearchQuery}", limit=${searchRequests[1].limit}`);

            // 3. Execute hybrid search - get more results if cross-encoder reranking is enabled
            const searchLimit = this.reranker?.isEnabled() ? Math.min(topK * 2, 50) : topK;
            console.log(`[Context] 🔍 Executing hybrid search with RRF reranking (limit: ${searchLimit})...`);

            // Update search requests with higher limits if reranking is enabled
            const adjustedSearchRequests = searchRequests.map(req => ({
                ...req,
                limit: searchLimit
            }));

            const searchResults: HybridSearchResult[] = await this.vectorDatabase.hybridSearch(
                collectionName,
                adjustedSearchRequests,
                {
                    rerank: {
                        strategy: 'rrf',
                        params: { k: 100 }
                    },
                    limit: searchLimit,
                    filterExpr
                }
            );

            console.log(`[Context] 🔍 Raw hybrid search results count: ${searchResults.length}`);

            // 4. Apply cross-encoder reranking if enabled (after Milvus RRF reranking)
            let finalSearchResults: HybridSearchResult[] | VectorSearchResult[] = searchResults;
            if (this.reranker?.isEnabled() && searchResults.length > 0) {
                console.log(`[Context] 🔄 Applying cross-encoder reranking to ${searchResults.length} hybrid results...`);
                try {
                    await this.reranker.initialize(); // Lazy initialization

                    // Convert HybridSearchResult[] to VectorSearchResult[] for reranker
                    const vectorResults: VectorSearchResult[] = searchResults.map(result => ({
                        document: result.document,
                        score: result.score
                    }));

                    const rerankedResults = await this.reranker.rerank(primarySearchQuery, vectorResults, topK);
                    finalSearchResults = rerankedResults;
                    console.log(`[Context] ✅ Cross-encoder reranking completed: ${searchResults.length} → ${finalSearchResults.length} results`);
                } catch (error: any) {
                    console.warn(`[Context] ⚠️  Cross-encoder reranking failed, using RRF results:`, error.message);
                    finalSearchResults = searchResults.slice(0, topK);
                }
            } else {
                finalSearchResults = searchResults.slice(0, topK);
            }

            // 5. Convert to semantic search result format
            const results: SemanticSearchResult[] = finalSearchResults.map(result => ({
                content: result.document.content,
                relativePath: result.document.relativePath,
                startLine: result.document.startLine,
                endLine: result.document.endLine,
                language: result.document.metadata.language || 'unknown',
                score: result.score
            }));

            console.log(`[Context] ✅ Found ${results.length} relevant hybrid results`);
            if (results.length > 0) {
                console.log(`[Context] 🔍 Top result score: ${results[0].score}, path: ${results[0].relativePath}`);
            }

            return results;
        } else {
            // Regular semantic search
            // 1. Generate query vector
            const queryEmbedding: EmbeddingVector = await this.embedding.embed(primarySearchQuery);

            // 2. Search in vector database - get more results if reranking is enabled
            const searchLimit = this.reranker?.isEnabled() ? Math.min(topK * 2, 50) : topK;
            const searchResults: VectorSearchResult[] = await this.vectorDatabase.search(
                collectionName,
                queryEmbedding.vector,
                { topK: searchLimit, threshold, filterExpr }
            );

            // 3. Apply reranking if enabled
            let finalSearchResults = searchResults;
            if (this.reranker?.isEnabled() && searchResults.length > 0) {
                console.log(`[Context] 🔄 Applying reranking to ${searchResults.length} results...`);
                try {
                    await this.reranker.initialize(); // Lazy initialization
                    finalSearchResults = await this.reranker.rerank(primarySearchQuery, searchResults, topK);
                    console.log(`[Context] ✅ Reranking completed: ${searchResults.length} → ${finalSearchResults.length} results`);
                } catch (error: any) {
                    console.warn(`[Context] ⚠️  Reranking failed, using original results:`, error.message);
                    finalSearchResults = searchResults.slice(0, topK);
                }
            } else {
                finalSearchResults = searchResults.slice(0, topK);
            }

            // 4. Convert to semantic search result format
            const results: SemanticSearchResult[] = finalSearchResults.map(result => ({
                content: result.document.content,
                relativePath: result.document.relativePath,
                startLine: result.document.startLine,
                endLine: result.document.endLine,
                language: result.document.metadata.language || 'unknown',
                score: result.score
            }));

            console.log(`[Context] ✅ Found ${results.length} relevant results`);
            return results;
        }
    }

    /**
     * Semantic search with Pseudo-Relevance Feedback (PRF) for enhanced query expansion
     *
     * Performs two-pass retrieval:
     * 1. Initial search with original/preprocessed query
     * 2. PRF term extraction from top results
     * 3. Second search with expanded query for improved relevance
     *
     * @param codebasePath Codebase path to search
     * @param query Search query string
     * @param topK Maximum number of results to return
     * @param threshold Similarity threshold
     * @param filterExpr Optional filter expression
     * @returns Enhanced semantic search results
     */
    async semanticSearchWithPRF(
        codebasePath: string,
        query: string,
        topK: number = 5,
        threshold: number = 0.5,
        filterExpr?: string
    ): Promise<SemanticSearchResult[]> {
        if (!this.prfEngine) {
            console.log(`[Context] ⚠️  PRF engine not initialized, falling back to regular semantic search`);
            return await this.semanticSearch(codebasePath, query, topK, threshold, filterExpr);
        }

        console.log(`[Context] 🚀 Executing PRF-enhanced semantic search: "${query}" in ${codebasePath}`);
        const startTime = Date.now();

        try {
            // PASS 1: Initial retrieval for pseudo-relevant documents
            console.log(`[Context] 📡 Pass 1: Initial retrieval for PRF analysis`);
            const initialTopK = Math.max(this.prfEngine.getStats().totalQueries === 0 ? 15 : 12, topK * 2);
            const pseudoRelevantResults = await this.semanticSearch(
                codebasePath,
                query,
                initialTopK,
                threshold * 0.8, // Lower threshold for more candidate documents
                filterExpr
            );

            if (pseudoRelevantResults.length === 0) {
                console.log(`[Context] ⚠️  No pseudo-relevant documents found, returning empty results`);
                return [];
            }

            console.log(`[Context] 📊 Found ${pseudoRelevantResults.length} pseudo-relevant documents for PRF analysis`);

            // PRF: Extract expansion terms from pseudo-relevant documents
            console.log(`[Context] 🔍 Extracting expansion terms using TF-IDF analysis...`);
            const prfResult = await this.prfEngine.expandQuery(query, pseudoRelevantResults);

            console.log(`[Context] ✨ PRF Results: ${prfResult.reasoning}`);
            if (prfResult.expansionTerms.length > 0) {
                const topTerms = prfResult.expansionTerms.slice(0, 3).map(t => `${t.term}(${t.score.toFixed(2)})`);
                console.log(`[Context] 🎯 Top expansion terms: ${topTerms.join(', ')}`);
            }

            // Check if we got meaningful expansion
            if (prfResult.expandedQuery === prfResult.originalQuery || prfResult.expansionTerms.length === 0) {
                console.log(`[Context] ℹ️  No meaningful query expansion, using original results`);
                return pseudoRelevantResults.slice(0, topK);
            }

            // PASS 2: Enhanced retrieval with expanded query
            console.log(`[Context] 🎯 Pass 2: Enhanced search with expanded query: "${prfResult.expandedQuery}"`);
            const enhancedResults = await this.semanticSearch(
                codebasePath,
                prfResult.expandedQuery,
                topK,
                threshold,
                filterExpr
            );

            // Merge and deduplicate results, prioritizing enhanced search results
            const mergedResults = this.mergeSearchResults(
                enhancedResults,
                pseudoRelevantResults.slice(0, topK),
                topK
            );

            const totalTime = Date.now() - startTime;
            console.log(`[Context] ✅ PRF search completed in ${totalTime}ms: ${mergedResults.length} results (${prfResult.expansionTerms.length} expansion terms)`);

            return mergedResults;

        } catch (error) {
            console.error(`[Context] ❌ PRF search failed:`, error);
            console.log(`[Context] 🔄 Falling back to regular semantic search`);
            return await this.semanticSearch(codebasePath, query, topK, threshold, filterExpr);
        }
    }

    /**
     * Merge and deduplicate search results from PRF passes
     * Prioritizes enhanced results while avoiding duplicates
     */
    private mergeSearchResults(
        enhancedResults: SemanticSearchResult[],
        originalResults: SemanticSearchResult[],
        topK: number
    ): SemanticSearchResult[] {
        const seen = new Set<string>();
        const merged: SemanticSearchResult[] = [];

        // Add enhanced results first (higher priority)
        for (const result of enhancedResults) {
            const key = `${result.relativePath}:${result.startLine}:${result.endLine}`;
            if (!seen.has(key) && merged.length < topK) {
                seen.add(key);
                merged.push(result);
            }
        }

        // Fill remaining slots with original results
        for (const result of originalResults) {
            const key = `${result.relativePath}:${result.startLine}:${result.endLine}`;
            if (!seen.has(key) && merged.length < topK) {
                seen.add(key);
                merged.push(result);
            }
        }

        return merged;
    }

    /**
     * Check if index exists for codebase
     * @param codebasePath Codebase path to check
     * @returns Whether index exists
     */
    async hasIndex(codebasePath: string): Promise<boolean> {
        const collectionName = this.getCollectionName(codebasePath);
        return await this.vectorDatabase.hasCollection(collectionName);
    }

    /**
     * Clear index
     * @param codebasePath Codebase path to clear index for
     * @param progressCallback Optional progress callback function
     */
    async clearIndex(
        codebasePath: string,
        progressCallback?: (progress: { phase: string; current: number; total: number; percentage: number }) => void
    ): Promise<void> {
        console.log(`[Context] 🧹 Cleaning index data for ${codebasePath}...`);

        progressCallback?.({ phase: 'Checking existing index...', current: 0, total: 100, percentage: 0 });

        const collectionName = this.getCollectionName(codebasePath);
        const collectionExists = await this.vectorDatabase.hasCollection(collectionName);

        progressCallback?.({ phase: 'Removing index data...', current: 50, total: 100, percentage: 50 });

        if (collectionExists) {
            await this.vectorDatabase.dropCollection(collectionName);
        }

        // Delete snapshot file
        await FileSynchronizer.deleteSnapshot(codebasePath);

        progressCallback?.({ phase: 'Index cleared', current: 100, total: 100, percentage: 100 });
        console.log('[Context] ✅ Index data cleaned');
    }

    /**
     * Update ignore patterns (merges with default patterns and existing patterns)
     * @param ignorePatterns Array of ignore patterns to add to defaults
     */
    updateIgnorePatterns(ignorePatterns: string[]): void {
        // Merge with default patterns and any existing custom patterns, avoiding duplicates
        const mergedPatterns = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];
        const uniquePatterns: string[] = [];
        const patternSet = new Set(mergedPatterns);
        patternSet.forEach(pattern => uniquePatterns.push(pattern));
        this.ignorePatterns = uniquePatterns;
        console.log(`[Context] 🚫 Updated ignore patterns: ${ignorePatterns.length} new + ${DEFAULT_IGNORE_PATTERNS.length} default = ${this.ignorePatterns.length} total patterns`);
    }

    /**
     * Add custom ignore patterns (from MCP or other sources) without replacing existing ones
     * @param customPatterns Array of custom ignore patterns to add
     */
    addCustomIgnorePatterns(customPatterns: string[]): void {
        if (customPatterns.length === 0) return;

        // Merge current patterns with new custom patterns, avoiding duplicates
        const mergedPatterns = [...this.ignorePatterns, ...customPatterns];
        const uniquePatterns: string[] = [];
        const patternSet = new Set(mergedPatterns);
        patternSet.forEach(pattern => uniquePatterns.push(pattern));
        this.ignorePatterns = uniquePatterns;
        console.log(`[Context] 🚫 Added ${customPatterns.length} custom ignore patterns. Total: ${this.ignorePatterns.length} patterns`);
    }

    /**
     * Reset ignore patterns to defaults only
     */
    resetIgnorePatternsToDefaults(): void {
        this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];
        console.log(`[Context] 🔄 Reset ignore patterns to defaults: ${this.ignorePatterns.length} patterns`);
    }

    /**
     * Update embedding instance
     * @param embedding New embedding instance
     */
    updateEmbedding(embedding: Embedding): void {
        this.embedding = embedding;
        console.log(`[Context] 🔄 Updated embedding provider: ${embedding.getProvider()}`);
    }

    /**
     * Update vector database instance
     * @param vectorDatabase New vector database instance
     */
    updateVectorDatabase(vectorDatabase: VectorDatabase): void {
        this.vectorDatabase = vectorDatabase;
        console.log(`[Context] 🔄 Updated vector database`);
    }

    /**
     * Update splitter instance
     * @param splitter New splitter instance
     */
    updateSplitter(splitter: Splitter): void {
        this.codeSplitter = splitter;
        console.log(`[Context] 🔄 Updated splitter instance`);
    }

    /**
     * Prepare vector collection
     */
    private async prepareCollection(codebasePath: string, forceReindex: boolean = false): Promise<void> {
        const isHybrid = this.getIsHybrid();
        const collectionType = isHybrid === true ? 'hybrid vector' : 'vector';
        console.log(`[Context] 🔧 Preparing ${collectionType} collection for codebase: ${codebasePath}${forceReindex ? ' (FORCE REINDEX)' : ''}`);
        const collectionName = this.getCollectionName(codebasePath);

        // Check if collection already exists
        const collectionExists = await this.vectorDatabase.hasCollection(collectionName);

        if (collectionExists && !forceReindex) {
            console.log(`📋 Collection ${collectionName} already exists, skipping creation`);
            return;
        }

        if (collectionExists && forceReindex) {
            console.log(`[Context] 🗑️  Dropping existing collection ${collectionName} for force reindex...`);
            await this.vectorDatabase.dropCollection(collectionName);
            console.log(`[Context] ✅ Collection ${collectionName} dropped successfully`);
        }

        console.log(`[Context] 🔍 Detecting embedding dimension for ${this.embedding.getProvider()} provider...`);
        const dimension = await this.embedding.detectDimension();
        console.log(`[Context] 📏 Detected dimension: ${dimension} for ${this.embedding.getProvider()}`);
        const dirName = path.basename(codebasePath);

        if (isHybrid === true) {
            await this.vectorDatabase.createHybridCollection(collectionName, dimension, `Hybrid Index for ${dirName}`);
        } else {
            await this.vectorDatabase.createCollection(collectionName, dimension, `Index for ${dirName}`);
        }

        console.log(`[Context] ✅ Collection ${collectionName} created successfully (dimension: ${dimension})`);
    }

    /**
     * Recursively get all code files in the codebase
     */
    private async getCodeFiles(codebasePath: string): Promise<string[]> {
        const files: string[] = [];
        const normalizedPath = path.resolve(codebasePath);
        const fileStats = { total: 0, ignored: 0, unsupported: 0, included: 0 };
        const ignoredByPattern = new Map<string, number>();


        const traverseDirectory = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                fileStats.total++;

                // Check if path matches ignore patterns using project-specific patterns
                const matchedPattern = this.getMatchedIgnorePattern(fullPath, codebasePath, normalizedPath);
                if (matchedPattern) {
                    fileStats.ignored++;
                    const count = ignoredByPattern.get(matchedPattern) || 0;
                    ignoredByPattern.set(matchedPattern, count + 1);
                    continue;
                }

                if (entry.isDirectory()) {
                    await traverseDirectory(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);

                    if (this.supportedExtensions.includes(ext)) {
                        files.push(fullPath);
                        fileStats.included++;
                    } else {
                        fileStats.unsupported++;
                    }
                }
            }
        };

        await traverseDirectory(codebasePath);

        // Log comprehensive discovery statistics
        console.log(`\n[FILE-DISCOVERY] 📊 Discovery Summary:`);
        console.log(`  Total files/dirs encountered: ${fileStats.total}`);
        console.log(`  Files ignored by patterns: ${fileStats.ignored}`);
        console.log(`  Files with unsupported extensions: ${fileStats.unsupported}`);
        console.log(`  Files included for indexing: ${fileStats.included}`);

        // Log ignore pattern effectiveness
        if (ignoredByPattern.size > 0) {
            console.log(`\n[FILE-DISCOVERY] 🚫 Top ignore patterns used:`);
            const sortedIgnorePatterns = Array.from(ignoredByPattern.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            sortedIgnorePatterns.forEach(([pattern, count]) => {
                console.log(`  ${pattern}: ${count} files/dirs ignored`);
            });
        }

        return files;
    }

    /**
 * Process a list of files with streaming chunk processing
 * @param filePaths Array of file paths to process
 * @param codebasePath Base path for the codebase
 * @param onFileProcessed Callback called when each file is processed
 * @returns Object with processed file count and total chunk count
 */
    private async processFileList(
        filePaths: string[],
        codebasePath: string,
        onFileProcessed?: (filePath: string, fileIndex: number, totalFiles: number) => void
    ): Promise<{ processedFiles: number; totalChunks: number; status: 'completed' | 'limit_reached' }> {
        const isHybrid = this.getIsHybrid();
        const EMBEDDING_BATCH_SIZE = Math.max(1, parseInt(envManager.get('EMBEDDING_BATCH_SIZE') || '100', 10));
        const CHUNK_LIMIT = 450000;
        console.log(`[Context] 🔧 Using EMBEDDING_BATCH_SIZE: ${EMBEDDING_BATCH_SIZE}`);

        let chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }> = [];
        let processedFiles = 0;
        let totalChunks = 0;
        let limitReached = false;

        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];

            try {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const language = this.getLanguageFromExtension(path.extname(filePath));
                const chunks = await this.codeSplitter.split(content, language, filePath);

                // Log files with many chunks or large content
                if (chunks.length > 50) {
                    console.warn(`[Context] ⚠️  File ${filePath} generated ${chunks.length} chunks (${Math.round(content.length / 1024)}KB)`);
                } else if (content.length > 100000) {
                    console.log(`📄 Large file ${filePath}: ${Math.round(content.length / 1024)}KB -> ${chunks.length} chunks`);
                }

                // Add chunks to buffer
                for (const chunk of chunks) {
                    chunkBuffer.push({ chunk, codebasePath });
                    totalChunks++;

                    // Process batch when buffer reaches EMBEDDING_BATCH_SIZE
                    if (chunkBuffer.length >= EMBEDDING_BATCH_SIZE) {
                        try {
                            await this.processChunkBuffer(chunkBuffer);
                        } catch (error) {
                            const searchType = isHybrid === true ? 'hybrid' : 'regular';
                            console.error(`[Context] ❌ Failed to process chunk batch for ${searchType}:`, error);
                            if (error instanceof Error) {
                                console.error('[Context] Stack trace:', error.stack);
                            }
                        } finally {
                            chunkBuffer = []; // Always clear buffer, even on failure
                        }
                    }

                    // Check if chunk limit is reached
                    if (totalChunks >= CHUNK_LIMIT) {
                        console.warn(`[Context] ⚠️  Chunk limit of ${CHUNK_LIMIT} reached. Stopping indexing.`);
                        limitReached = true;
                        break; // Exit the inner loop (over chunks)
                    }
                }

                processedFiles++;
                onFileProcessed?.(filePath, i + 1, filePaths.length);

                if (limitReached) {
                    break; // Exit the outer loop (over files)
                }

            } catch (error) {
                console.warn(`[Context] ⚠️  Skipping file ${filePath}: ${error}`);
            }
        }

        // Process any remaining chunks in the buffer
        if (chunkBuffer.length > 0) {
            const searchType = isHybrid === true ? 'hybrid' : 'regular';
            console.log(`📝 Processing final batch of ${chunkBuffer.length} chunks for ${searchType}`);
            try {
                await this.processChunkBuffer(chunkBuffer);
            } catch (error) {
                console.error(`[Context] ❌ Failed to process final chunk batch for ${searchType}:`, error);
                if (error instanceof Error) {
                    console.error('[Context] Stack trace:', error.stack);
                }
            }
        }

        return {
            processedFiles,
            totalChunks,
            status: limitReached ? 'limit_reached' : 'completed'
        };
    }

    /**
 * Process accumulated chunk buffer
 */
    private async processChunkBuffer(chunkBuffer: Array<{ chunk: CodeChunk; codebasePath: string }>): Promise<void> {
        if (chunkBuffer.length === 0) return;

        // Extract chunks and ensure they all have the same codebasePath
        const chunks = chunkBuffer.map(item => item.chunk);
        const codebasePath = chunkBuffer[0].codebasePath;

        // Estimate tokens (rough estimation: 1 token ≈ 4 characters)
        const estimatedTokens = chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.content.length / 4), 0);

        const isHybrid = this.getIsHybrid();
        const searchType = isHybrid === true ? 'hybrid' : 'regular';
        console.log(`[Context] 🔄 Processing batch of ${chunks.length} chunks (~${estimatedTokens} tokens) for ${searchType}`);
        await this.processChunkBatch(chunks, codebasePath);
    }

    /**
     * Get cached embeddings or generate new ones
     * @param chunkContents Array of chunk content strings
     * @returns Array of embedding vectors
     */
    private async getCachedOrGenerateEmbeddings(chunkContents: string[]): Promise<EmbeddingVector[]> {
        if (!this.embeddingCache.isAvailable()) {
            // Cache not available, use regular embedding generation
            return await this.embedding.embedBatch(chunkContents);
        }

        // Generate content hashes for all chunks
        const contentHashes = chunkContents.map(content => EmbeddingCache.getContentHash(content));

        // Check cache for existing embeddings
        const cachedEmbeddings = this.embeddingCache.getMany(contentHashes);

        const results: EmbeddingVector[] = [];
        const uncachedContents: string[] = [];
        const uncachedIndices: number[] = [];

        // Separate cached from uncached chunks
        for (let i = 0; i < chunkContents.length; i++) {
            const hash = contentHashes[i];
            const cached = cachedEmbeddings.get(hash);

            if (cached) {
                results[i] = { vector: cached, dimension: cached.length };
            } else {
                uncachedContents.push(chunkContents[i]);
                uncachedIndices.push(i);
            }
        }

        // Generate embeddings for uncached chunks
        if (uncachedContents.length > 0) {
            console.log(`[Context] 🔄 Cache miss for ${uncachedContents.length}/${chunkContents.length} chunks, generating embeddings...`);
            const newEmbeddings = await this.embedding.embedBatch(uncachedContents);

            // Store new embeddings in cache
            const embeddingsToCache = new Map<string, number[]>();
            for (let i = 0; i < uncachedContents.length; i++) {
                const originalIndex = uncachedIndices[i];
                const embedding = newEmbeddings[i];
                results[originalIndex] = embedding;

                // Add to cache
                const hash = EmbeddingCache.getContentHash(uncachedContents[i]);
                embeddingsToCache.set(hash, embedding.vector);
            }

            // Batch store to cache
            this.embeddingCache.setMany(embeddingsToCache);
        } else {
            console.log(`[Context] ✅ Cache hit for all ${chunkContents.length} chunks`);
        }

        return results;
    }

    /**
     * Process a batch of chunks
     */
    private async processChunkBatch(chunks: CodeChunk[], codebasePath: string): Promise<void> {
        const isHybrid = this.getIsHybrid();

        try {
            console.log(`[DEBUG-PROCESS] Starting processChunkBatch with ${chunks.length} chunks, isHybrid=${isHybrid}`);

            // Generate embedding vectors using cache-aware logic
            const chunkContents = chunks.map(chunk => chunk.content);
            const embeddings = await this.getCachedOrGenerateEmbeddings(chunkContents);

            console.log(`[DEBUG-PROCESS] Retrieved ${embeddings.length} embeddings`);

            if (isHybrid === true) {
                console.log(`[DEBUG-PROCESS] Creating hybrid documents for ${chunks.length} chunks with ${embeddings.length} embeddings`);

                // Create hybrid vector documents
                const documents: VectorDocument[] = chunks.map((chunk, index) => {
                    if (!chunk.metadata.filePath) {
                        throw new Error(`Missing filePath in chunk metadata at index ${index}`);
                    }

                    const relativePath = path.relative(codebasePath, chunk.metadata.filePath);
                    const fileExtension = path.extname(chunk.metadata.filePath);
                    const { filePath, startLine, endLine, ...restMetadata } = chunk.metadata;

                    return {
                        id: this.generateId(relativePath, chunk.metadata.startLine || 0, chunk.metadata.endLine || 0, chunk.content),
                        content: chunk.content, // Full text content for BM25 and storage
                        vector: embeddings[index].vector, // Dense vector
                        relativePath,
                        startLine: chunk.metadata.startLine || 0,
                        endLine: chunk.metadata.endLine || 0,
                        fileExtension,
                        metadata: {
                            ...restMetadata,
                            codebasePath,
                            language: chunk.metadata.language || 'unknown',
                            chunkIndex: index
                        }
                    };
                });

                // Store to vector database
                console.log(`[DEBUG-PROCESS] About to call insertHybrid with collection: ${this.getCollectionName(codebasePath)}`);
                await this.vectorDatabase.insertHybrid(this.getCollectionName(codebasePath), documents);
                console.log(`[DEBUG-PROCESS] insertHybrid completed successfully`);
            } else {
                // Create regular vector documents
                const documents: VectorDocument[] = chunks.map((chunk, index) => {
                    if (!chunk.metadata.filePath) {
                        throw new Error(`Missing filePath in chunk metadata at index ${index}`);
                    }

                    const relativePath = path.relative(codebasePath, chunk.metadata.filePath);
                    const fileExtension = path.extname(chunk.metadata.filePath);
                    const { filePath, startLine, endLine, ...restMetadata } = chunk.metadata;

                    return {
                        id: this.generateId(relativePath, chunk.metadata.startLine || 0, chunk.metadata.endLine || 0, chunk.content),
                        vector: embeddings[index].vector,
                        content: chunk.content,
                        relativePath,
                        startLine: chunk.metadata.startLine || 0,
                        endLine: chunk.metadata.endLine || 0,
                        fileExtension,
                        metadata: {
                            ...restMetadata,
                            codebasePath,
                            language: chunk.metadata.language || 'unknown',
                            chunkIndex: index
                        }
                    };
                });

                // Store to vector database
                await this.vectorDatabase.insert(this.getCollectionName(codebasePath), documents);
            }
        } catch (error) {
            console.error(`[DEBUG-PROCESS] Error in processChunkBatch:`, error);
            throw error; // Re-throw to maintain existing error handling
        }
    }

    /**
     * Get programming language based on file extension
     */
    private getLanguageFromExtension(ext: string): string {
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.m': 'objective-c',
            '.mm': 'objective-c',
            '.ipynb': 'jupyter'
        };
        return languageMap[ext] || 'text';
    }

    /**
     * Generate unique ID based on chunk content and location
     * @param relativePath Relative path to the file
     * @param startLine Start line number
     * @param endLine End line number
     * @param content Chunk content
     * @returns Hash-based unique ID
     */
    private generateId(relativePath: string, startLine: number, endLine: number, content: string): string {
        const combinedString = `${relativePath}:${startLine}:${endLine}:${content}`;
        const hash = crypto.createHash('sha256').update(combinedString, 'utf-8').digest('hex');
        return `chunk_${hash.substring(0, 16)}`;
    }

    /**
     * Read ignore patterns from file (e.g., .gitignore)
     * @param filePath Path to the ignore file
     * @returns Array of ignore patterns
     */
    static async getIgnorePatternsFromFile(filePath: string): Promise<string[]> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')); // Filter out empty lines and comments
        } catch (error) {
            console.warn(`[Context] ⚠️  Could not read ignore file ${filePath}: ${error}`);
            return [];
        }
    }

    /**
     * Load ignore patterns from various ignore files in the codebase
     * This method preserves any existing custom patterns that were added before
     * @param codebasePath Path to the codebase
     */
    private async loadIgnorePatterns(codebasePath: string): Promise<void> {
        const normalizedPath = path.resolve(codebasePath);

        console.log(`[IGNORE-PATTERNS] 📁 Loading ignore patterns for: ${normalizedPath}`);

        try {
            let fileBasedPatterns: string[] = [];
            const patternSources: string[] = [];

            // Load all .xxxignore files in codebase directory
            const ignoreFiles = await this.findIgnoreFiles(codebasePath);
            for (const ignoreFile of ignoreFiles) {
                const patterns = await this.loadIgnoreFile(ignoreFile, path.basename(ignoreFile));
                if (patterns.length > 0) {
                    fileBasedPatterns.push(...patterns);
                    patternSources.push(`${path.basename(ignoreFile)} (${patterns.length} patterns)`);
                }
            }

            // Load global ~/.context/.contextignore
            const globalIgnorePatterns = await this.loadGlobalIgnoreFile();
            if (globalIgnorePatterns.length > 0) {
                fileBasedPatterns.push(...globalIgnorePatterns);

                // Store project-specific patterns (base patterns + file-based patterns)
                patternSources.push(`global .contextignore (${globalIgnorePatterns.length} patterns)`);
            }

            // Load custom ignore patterns from environment
            const envIgnorePatterns = this.getCustomIgnorePatternsFromEnv();
            if (envIgnorePatterns.length > 0) {
                fileBasedPatterns.push(...envIgnorePatterns);
                patternSources.push(`environment variables (${envIgnorePatterns.length} patterns)`);
            }

            // Load any custom ignore patterns added via MCP
            if (this.ignorePatterns.length > DEFAULT_IGNORE_PATTERNS.length) {
                const mcpCustomPatterns = this.ignorePatterns.filter(p => !DEFAULT_IGNORE_PATTERNS.includes(p));
                if (mcpCustomPatterns.length > 0) {
                    fileBasedPatterns.push(...mcpCustomPatterns);
                    patternSources.push(`MCP custom patterns (${mcpCustomPatterns.length} patterns)`);
                }
            }

            // Combine all patterns (defaults + loaded patterns)
            const projectPatterns = [
                ...DEFAULT_IGNORE_PATTERNS,
                ...fileBasedPatterns
            ];

            // Remove duplicates and store
            const uniqueProjectPatterns = [...new Set(projectPatterns)];
            this.projectIgnorePatterns.set(normalizedPath, uniqueProjectPatterns);

            // Create single ignore handler for all patterns
            const ignoreHandler = ignore().add(uniqueProjectPatterns);
            this.projectIgnoreHandlers.set(normalizedPath, ignoreHandler);

            // Enhanced logging
            console.log(`[IGNORE-PATTERNS] 📊 Pattern loading summary:`);
            console.log(`  Default patterns: ${DEFAULT_IGNORE_PATTERNS.length}`);
            console.log(`  Additional patterns: ${fileBasedPatterns.length}`);
            console.log(`  Pattern sources: ${patternSources.length > 0 ? patternSources.join(', ') : 'none'}`);
            console.log(`  Total unique patterns: ${uniqueProjectPatterns.length}`);
        } catch (error) {
            console.warn(`[Context] ⚠️ Failed to load ignore patterns for ${normalizedPath}: ${error}`);
            // Store default patterns on error
            this.projectIgnorePatterns.set(normalizedPath, [...DEFAULT_IGNORE_PATTERNS]);
        }
    }

    /**
     * Find all .xxxignore files in the codebase directory
     * @param codebasePath Path to the codebase
     * @returns Array of ignore file paths
     */
    private async findIgnoreFiles(codebasePath: string): Promise<string[]> {
        try {
            const entries = await fs.promises.readdir(codebasePath, { withFileTypes: true });
            const ignoreFiles: string[] = [];

            for (const entry of entries) {
                if (entry.isFile() &&
                    entry.name.startsWith('.') &&
                    entry.name.endsWith('ignore')) {
                    ignoreFiles.push(path.join(codebasePath, entry.name));
                }
            }

            if (ignoreFiles.length > 0) {
                console.log(`📄 Found ignore files: ${ignoreFiles.map(f => path.basename(f)).join(', ')}`);
            }

            return ignoreFiles;
        } catch (error) {
            console.warn(`[Context] ⚠️ Failed to scan for ignore files: ${error}`);
            return [];
        }
    }

    /**
     * Load global ignore file from ~/.context/.contextignore
     * @returns Array of ignore patterns
     */
    private async loadGlobalIgnoreFile(): Promise<string[]> {
        try {
            const homeDir = require('os').homedir();
            const globalIgnorePath = path.join(homeDir, '.context', '.contextignore');
            return await this.loadIgnoreFile(globalIgnorePath, 'global .contextignore');
        } catch (error) {
            // Global ignore file is optional, don't log warnings
            return [];
        }
    }

    /**
     * Load ignore patterns from a specific ignore file
     * @param filePath Path to the ignore file
     * @param fileName Display name for logging
     * @returns Array of ignore patterns
     */
    private async loadIgnoreFile(filePath: string, fileName: string): Promise<string[]> {
        try {
            await fs.promises.access(filePath);
            console.log(`📄 Found ${fileName} file at: ${filePath}`);

            const ignorePatterns = await Context.getIgnorePatternsFromFile(filePath);

            if (ignorePatterns.length > 0) {
                console.log(`[Context] 🚫 Loaded ${ignorePatterns.length} ignore patterns from ${fileName}`);
                return ignorePatterns;
            } else {
                console.log(`📄 ${fileName} file found but no valid patterns detected`);
                return [];
            }
        } catch (error) {
            if (fileName.includes('global')) {
                console.log(`📄 No ${fileName} file found`);
            }
            return [];
        }
    }

    /**
     * Check if a path matches any ignore pattern
     * @param filePath Path to check
     * @param basePath Base path for relative pattern matching
     * @returns True if path should be ignored
     */
    public matchesIgnorePattern(filePath: string, basePath: string, projectPath?: string): boolean {
        return this.getMatchedIgnorePattern(filePath, basePath, projectPath) !== null;
    }

    /**
     * Get the first ignore pattern that matches a path
     * @param filePath Path to check
     * @param basePath Base path for relative pattern matching
     * @param projectPath Project path for getting project-specific patterns
     * @returns The matching pattern or null if no match
     */
    private getMatchedIgnorePattern(filePath: string, basePath: string, projectPath?: string): string | null {
        const relativePath = path.relative(basePath, filePath);
        const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

        // Use project-specific ignore handler if available
        const resolvedPath = projectPath ? path.resolve(projectPath) : null;
        const ignoreHandler = resolvedPath ?
            this.projectIgnoreHandlers.get(resolvedPath) :
            ignore().add(this.ignorePatterns);

        if (!ignoreHandler) {
            return null;
        }

        if (ignoreHandler.ignores(normalizedPath)) {
            // Find which pattern matched (for logging)
            const allPatterns = resolvedPath ?
                this.projectIgnorePatterns.get(resolvedPath) || [] :
                this.ignorePatterns;

            // Find which pattern matched
            for (const pattern of allPatterns) {
                const testHandler = ignore().add([pattern]);
                if (testHandler.ignores(normalizedPath)) {
                    return pattern;
                }
            }
            return 'unknown-pattern';
        }

        return null;
    }


    /**
     * Get custom extensions from environment variables
     * Supports CUSTOM_EXTENSIONS as comma-separated list
     * @returns Array of custom extensions
     */
    private getCustomExtensionsFromEnv(): string[] {
        const envExtensions = envManager.get('CUSTOM_EXTENSIONS');
        if (!envExtensions) {
            return [];
        }

        try {
            const extensions = envExtensions
                .split(',')
                .map(ext => ext.trim())
                .filter(ext => ext.length > 0)
                .map(ext => ext.startsWith('.') ? ext : `.${ext}`); // Ensure extensions start with dot

            return extensions;
        } catch (error) {
            console.warn(`[Context] ⚠️  Failed to parse CUSTOM_EXTENSIONS: ${error}`);
            return [];
        }
    }

    /**
     * Get custom ignore patterns from environment variables
     * Supports CUSTOM_IGNORE_PATTERNS as comma-separated list
     * @returns Array of custom ignore patterns
     */
    private getCustomIgnorePatternsFromEnv(): string[] {
        const envIgnorePatterns = envManager.get('CUSTOM_IGNORE_PATTERNS');
        if (!envIgnorePatterns) {
            return [];
        }

        try {
            const patterns = envIgnorePatterns
                .split(',')
                .map(pattern => pattern.trim())
                .filter(pattern => pattern.length > 0);

            return patterns;
        } catch (error) {
            console.warn(`[Context] ⚠️  Failed to parse CUSTOM_IGNORE_PATTERNS: ${error}`);
            return [];
        }
    }

    /**
     * Add custom extensions (from MCP or other sources) without replacing existing ones
     * @param customExtensions Array of custom extensions to add
     */
    addCustomExtensions(customExtensions: string[]): void {
        if (customExtensions.length === 0) return;

        // Ensure extensions start with dot
        const normalizedExtensions = customExtensions.map(ext =>
            ext.startsWith('.') ? ext : `.${ext}`
        );

        // Merge current extensions with new custom extensions, avoiding duplicates
        const mergedExtensions = [...this.supportedExtensions, ...normalizedExtensions];
        const uniqueExtensions: string[] = [...new Set(mergedExtensions)];
        this.supportedExtensions = uniqueExtensions;
        console.log(`[Context] 📎 Added ${customExtensions.length} custom extensions. Total: ${this.supportedExtensions.length} extensions`);
    }

    /**
     * Get current splitter information
     */
    getSplitterInfo(): { type: string; hasBuiltinFallback: boolean; supportedLanguages?: string[] } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            return {
                type: 'ast',
                hasBuiltinFallback: true,
                supportedLanguages: AstCodeSplitter.getSupportedLanguages()
            };
        } else {
            return {
                type: 'langchain',
                hasBuiltinFallback: false
            };
        }
    }

    /**
     * Check if current splitter supports a specific language
     * @param language Programming language
     */
    isLanguageSupported(language: string): boolean {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            return AstCodeSplitter.isLanguageSupported(language);
        }

        // LangChain splitter supports most languages
        return true;
    }

    /**
     * Get which strategy would be used for a specific language
     * @param language Programming language
     */
    getSplitterStrategyForLanguage(language: string): { strategy: 'ast' | 'langchain'; reason: string } {
        const splitterName = this.codeSplitter.constructor.name;

        if (splitterName === 'AstCodeSplitter') {
            const { AstCodeSplitter } = require('./splitter/ast-splitter');
            const isSupported = AstCodeSplitter.isLanguageSupported(language);

            return {
                strategy: isSupported ? 'ast' : 'langchain',
                reason: isSupported
                    ? 'Language supported by AST parser'
                    : 'Language not supported by AST, will fallback to LangChain'
            };
        } else {
            return {
                strategy: 'langchain',
                reason: 'Using LangChain splitter directly'
            };
        }
    }
}
