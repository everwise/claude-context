import { envManager, RerankingProvider, DEFAULT_PRF_CONFIG } from '@everwise/claude-context-core';
import { VERSION } from './version.js';

export interface ContextMcpConfig {
    name: string;
    version: string;
    // Embedding provider configuration
    embeddingProvider: 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama';
    embeddingModel: string;
    // Provider-specific API keys
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    voyageaiApiKey?: string;
    geminiApiKey?: string;
    // Ollama configuration
    ollamaModel?: string;
    ollamaHost?: string;
    // Reranking configuration
    rerankingProvider: RerankingProvider;
    rerankingModel: string;
    rerankingEnabled: boolean;
    // PRF configuration
    prfEnabled: boolean;
    prfTopK: number;
    prfExpansionTerms: number;
    prfMinTermFreq: number;
    prfOriginalWeight: number;
    prfCodeTokens: boolean;
    prfMinTermLength: number;
    prfStopWords: string[];
    // Vector database configuration
    milvusAddress?: string; // Optional, can be auto-resolved from token
    milvusToken?: string;
    // Auto-update configuration
    autoUpdateEnabled: boolean;
    autoUpdateInterval: number; // milliseconds
    autoUpdateSource: 'github-packages' | 'github-releases';
}

// Legacy format (v1) - for backward compatibility
export interface CodebaseSnapshotV1 {
    indexedCodebases: string[];
    indexingCodebases: string[] | Record<string, number>;  // Array (legacy) or Map of codebase path to progress percentage
    lastUpdated: string;
}

// New format (v2) - structured with codebase information

// Base interface for common fields
interface CodebaseInfoBase {
    lastUpdated: string;
}

// Indexing state - when indexing is in progress
export interface CodebaseInfoIndexing extends CodebaseInfoBase {
    status: 'indexing';
    indexingPercentage: number;  // Current progress percentage
}

// Indexed state - when indexing completed successfully
export interface CodebaseInfoIndexed extends CodebaseInfoBase {
    status: 'indexed';
    indexedFiles: number;        // Number of files indexed
    totalChunks: number;         // Total number of chunks generated
    indexStatus: 'completed' | 'limit_reached';  // Status from indexing result
}

// Index failed state - when indexing failed
export interface CodebaseInfoIndexFailed extends CodebaseInfoBase {
    status: 'indexfailed';
    errorMessage: string;        // Error message from the failure
    lastAttemptedPercentage?: number;  // Progress when failure occurred
}

// Union type for all codebase information states
export type CodebaseInfo = CodebaseInfoIndexing | CodebaseInfoIndexed | CodebaseInfoIndexFailed;

export interface CodebaseSnapshotV2 {
    formatVersion: 'v2';
    codebases: Record<string, CodebaseInfo>;  // codebasePath -> CodebaseInfo
    lastUpdated: string;
}

// Union type for all supported formats
export type CodebaseSnapshot = CodebaseSnapshotV1 | CodebaseSnapshotV2;

// Helper function to get default model for each provider
export function getDefaultModelForProvider(provider: string): string {
    switch (provider) {
        case 'OpenAI':
            return 'text-embedding-3-small';
        case 'VoyageAI':
            return 'voyage-code-3';
        case 'Gemini':
            return 'gemini-embedding-001';
        case 'Ollama':
            return 'nomic-embed-text';
        default:
            return 'text-embedding-3-small';
    }
}

// Helper function to get default reranking model for each provider
export function getDefaultRerankingModelForProvider(provider: RerankingProvider): string {
    switch (provider) {
        case RerankingProvider.HuggingFace:
            return 'jinaai/jina-reranker-v2-base-multilingual';
        case RerankingProvider.Disabled:
            return '';
        default:
            return 'jinaai/jina-reranker-v2-base-multilingual';
    }
}

// Helper function to get embedding model with provider-specific environment variable priority
export function getEmbeddingModelForProvider(provider: string): string {
    switch (provider) {
        case 'Ollama':
            // For Ollama, prioritize OLLAMA_MODEL over EMBEDDING_MODEL for backward compatibility
            const ollamaModel = envManager.get('OLLAMA_MODEL') || envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 Ollama model selection: OLLAMA_MODEL=${envManager.get('OLLAMA_MODEL') || 'NOT SET'}, EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${ollamaModel}`);
            return ollamaModel;
        case 'OpenAI':
        case 'VoyageAI':
        case 'Gemini':
        default:
            // For all other providers, use EMBEDDING_MODEL or default
            const selectedModel = envManager.get('EMBEDDING_MODEL') || getDefaultModelForProvider(provider);
            console.log(`[DEBUG] 🎯 ${provider} model selection: EMBEDDING_MODEL=${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}, selected=${selectedModel}`);
            return selectedModel;
    }
}

// Helper function to get reranking model with environment variable priority
export function getRerankingModelForProvider(provider: RerankingProvider): string {
    switch (provider) {
        case RerankingProvider.HuggingFace:
            const selectedModel = envManager.get('RERANKING_MODEL') || getDefaultRerankingModelForProvider(provider);
            console.log(
                `[DEBUG] 🎯 ${provider} reranking model selection: RERANKING_MODEL=${
                    envManager.get('RERANKING_MODEL') || 'NOT SET'
                }, selected=${selectedModel}`
            );
            return selectedModel;
        case RerankingProvider.Disabled:
        default:
            return getDefaultRerankingModelForProvider(provider);
    }
}

// Helper function to get PRF configuration with environment variable priority
export function getPRFConfig(): {
    enabled: boolean;
    topK: number;
    expansionTerms: number;
    minTermFreq: number;
    originalWeight: number;
    codeTokens: boolean;
    minTermLength: number;
    stopWords: string[];
} {
    const enabled = envManager.get('PRF_ENABLED')?.toLowerCase() === 'true';
    const topK = parseInt(envManager.get('PRF_TOP_K') || DEFAULT_PRF_CONFIG.topK.toString(), 10);
    const expansionTerms = parseInt(envManager.get('PRF_EXPANSION_TERMS') || DEFAULT_PRF_CONFIG.expansionTerms.toString(), 10);
    const minTermFreq = parseInt(envManager.get('PRF_MIN_TERM_FREQ') || DEFAULT_PRF_CONFIG.minTermFreq.toString(), 10);
    const originalWeight = parseFloat(envManager.get('PRF_ORIGINAL_WEIGHT') || DEFAULT_PRF_CONFIG.originalWeight.toString());
    const codeTokens = envManager.get('PRF_CODE_TOKENS')?.toLowerCase() !== 'false'; // Default true from DEFAULT_PRF_CONFIG
    const minTermLength = parseInt(envManager.get('PRF_MIN_TERM_LENGTH') || DEFAULT_PRF_CONFIG.minTermLength.toString(), 10);
    
    // Use default stop words from core config, convert Set to array for serialization
    const defaultStopWords = Array.from(DEFAULT_PRF_CONFIG.stopWords);
    const stopWords = envManager.get('PRF_STOP_WORDS')?.split(',').map(w => w.trim()) || defaultStopWords;
    
    console.log(
        `[DEBUG] 🎯 PRF configuration: PRF_ENABLED=${
            envManager.get('PRF_ENABLED') || 'NOT SET'
        }, enabled=${enabled}, topK=${topK}, expansionTerms=${expansionTerms}, minTermFreq=${minTermFreq}, originalWeight=${originalWeight}, codeTokens=${codeTokens}, minTermLength=${minTermLength}`
    );
    
    return {
        enabled,
        topK,
        expansionTerms,
        minTermFreq,
        originalWeight,
        codeTokens,
        minTermLength,
        stopWords
    };
}

export function createMcpConfig(): ContextMcpConfig {
    // Debug: Print all environment variables related to Context
    console.log(`[DEBUG] 🔍 Environment Variables Debug:`);
    console.log(`[DEBUG]   EMBEDDING_PROVIDER: ${envManager.get('EMBEDDING_PROVIDER') || 'NOT SET'}`);
    console.log(`[DEBUG]   EMBEDDING_MODEL: ${envManager.get('EMBEDDING_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   OLLAMA_MODEL: ${envManager.get('OLLAMA_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   GEMINI_API_KEY: ${envManager.get('GEMINI_API_KEY') ? 'SET (length: ' + envManager.get('GEMINI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   OPENAI_API_KEY: ${envManager.get('OPENAI_API_KEY') ? 'SET (length: ' + envManager.get('OPENAI_API_KEY')!.length + ')' : 'NOT SET'}`);
    console.log(`[DEBUG]   RERANKING_PROVIDER: ${envManager.get('RERANKING_PROVIDER') || 'NOT SET'}`);
    console.log(`[DEBUG]   RERANKING_MODEL: ${envManager.get('RERANKING_MODEL') || 'NOT SET'}`);
    console.log(`[DEBUG]   RERANKING_ENABLED: ${envManager.get('RERANKING_ENABLED') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_ENABLED: ${envManager.get('PRF_ENABLED') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_TOP_K: ${envManager.get('PRF_TOP_K') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_EXPANSION_TERMS: ${envManager.get('PRF_EXPANSION_TERMS') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_MIN_TERM_FREQ: ${envManager.get('PRF_MIN_TERM_FREQ') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_ORIGINAL_WEIGHT: ${envManager.get('PRF_ORIGINAL_WEIGHT') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_CODE_TOKENS: ${envManager.get('PRF_CODE_TOKENS') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_MIN_TERM_LENGTH: ${envManager.get('PRF_MIN_TERM_LENGTH') || 'NOT SET'}`);
    console.log(`[DEBUG]   PRF_STOP_WORDS: ${envManager.get('PRF_STOP_WORDS') || 'NOT SET'}`);
    console.log(`[DEBUG]   MILVUS_ADDRESS: ${envManager.get('MILVUS_ADDRESS') || 'NOT SET'}`);
    console.log(`[DEBUG]   AUTO_UPDATE: ${envManager.get('AUTO_UPDATE') || 'NOT SET'}`);
    console.log(`[DEBUG]   UPDATE_CHECK_INTERVAL: ${envManager.get('UPDATE_CHECK_INTERVAL') || 'NOT SET'}`);
    console.log(`[DEBUG]   UPDATE_SOURCE: ${envManager.get('UPDATE_SOURCE') || 'NOT SET'}`);
    console.log(`[DEBUG]   NODE_ENV: ${envManager.get('NODE_ENV') || 'NOT SET'}`);

    const prfConfig = getPRFConfig();
    const config: ContextMcpConfig = {
        name: envManager.get('MCP_SERVER_NAME') || "Context MCP Server",
        version: envManager.get('MCP_SERVER_VERSION') || VERSION,
        // Embedding provider configuration
        embeddingProvider: (envManager.get('EMBEDDING_PROVIDER') as 'OpenAI' | 'VoyageAI' | 'Gemini' | 'Ollama') || 'OpenAI',
        embeddingModel: getEmbeddingModelForProvider(envManager.get('EMBEDDING_PROVIDER') || 'OpenAI'),
        // Provider-specific API keys
        openaiApiKey: envManager.get('OPENAI_API_KEY'),
        openaiBaseUrl: envManager.get('OPENAI_BASE_URL'),
        voyageaiApiKey: envManager.get('VOYAGEAI_API_KEY'),
        geminiApiKey: envManager.get('GEMINI_API_KEY'),
        // Ollama configuration
        ollamaModel: envManager.get('OLLAMA_MODEL'),
        ollamaHost: envManager.get('OLLAMA_HOST'),
        // Reranking configuration
        rerankingProvider: (envManager.get('RERANKING_PROVIDER') as RerankingProvider) || RerankingProvider.Disabled,
        rerankingModel: getRerankingModelForProvider((envManager.get('RERANKING_PROVIDER') as RerankingProvider) || RerankingProvider.Disabled),
        rerankingEnabled:
            envManager.get('RERANKING_ENABLED')?.toLowerCase() === 'true' ||
            envManager.get('RERANKING_PROVIDER') === RerankingProvider.HuggingFace,
        // PRF configuration
        prfEnabled: prfConfig.enabled,
        prfTopK: prfConfig.topK,
        prfExpansionTerms: prfConfig.expansionTerms,
        prfMinTermFreq: prfConfig.minTermFreq,
        prfOriginalWeight: prfConfig.originalWeight,
        prfCodeTokens: prfConfig.codeTokens,
        prfMinTermLength: prfConfig.minTermLength,
        prfStopWords: prfConfig.stopWords,
        // Vector database configuration - address can be auto-resolved from token
        milvusAddress: envManager.get('MILVUS_ADDRESS'), // Optional, can be resolved from token
        milvusToken: envManager.get('MILVUS_TOKEN'),
        // Auto-update configuration
        autoUpdateEnabled: envManager.get('AUTO_UPDATE') !== 'false', // Enabled by default, opt-out
        autoUpdateInterval: parseInt(envManager.get('UPDATE_CHECK_INTERVAL') || '3600000', 10), // Default: 1 hour
        autoUpdateSource: (envManager.get('UPDATE_SOURCE') as 'github-packages' | 'github-releases') || 'github-packages'
    };

    return config;
}

export function logConfigurationSummary(config: ContextMcpConfig): void {
    // Log configuration summary before starting server
    console.log(`[MCP] 🚀 Starting Context MCP Server`);
    console.log(`[MCP] Configuration Summary:`);
    console.log(`[MCP]   Server: ${config.name} v${config.version}`);
    console.log(`[MCP]   Embedding Provider: ${config.embeddingProvider}`);
    console.log(`[MCP]   Embedding Model: ${config.embeddingModel}`);
    console.log(
        `[MCP]   Reranking: ${
            config.rerankingEnabled
                ? `✅ Enabled (${config.rerankingProvider}: ${config.rerankingModel})`
                : '❌ Disabled'
        }`
    );
    console.log(
        `[MCP]   PRF: ${
            config.prfEnabled
                ? `✅ Enabled (topK=${config.prfTopK}, expansionTerms=${config.prfExpansionTerms}, minTermFreq=${config.prfMinTermFreq}, originalWeight=${config.prfOriginalWeight}, codeTokens=${config.prfCodeTokens}, minTermLength=${config.prfMinTermLength})`
                : '❌ Disabled'
        }`
    );
    console.log(`[MCP]   Milvus Address: ${config.milvusAddress || (config.milvusToken ? '[Auto-resolve from token]' : '[Not configured]')}`);
    console.log(
        `[MCP]   Auto-Update: ${
            config.autoUpdateEnabled
                ? `✅ Enabled (${config.autoUpdateSource}, every ${config.autoUpdateInterval / 1000 / 60} min)`
                : '❌ Disabled'
        }`
    );

    // Log provider-specific configuration without exposing sensitive data
    switch (config.embeddingProvider) {
        case 'OpenAI':
            console.log(`[MCP]   OpenAI API Key: ${config.openaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            if (config.openaiBaseUrl) {
                console.log(`[MCP]   OpenAI Base URL: ${config.openaiBaseUrl}`);
            }
            break;
        case 'VoyageAI':
            console.log(`[MCP]   VoyageAI API Key: ${config.voyageaiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Gemini':
            console.log(`[MCP]   Gemini API Key: ${config.geminiApiKey ? '✅ Configured' : '❌ Missing'}`);
            break;
        case 'Ollama':
            console.log(`[MCP]   Ollama Host: ${config.ollamaHost || 'http://127.0.0.1:11434'}`);
            console.log(`[MCP]   Ollama Model: ${config.embeddingModel}`);
            break;
    }

    console.log(`[MCP] 🔧 Initializing server components...`);
}

export function showHelpMessage(): void {
    console.log(`
Context MCP Server

Usage: bunx @everwise/claude-context-mcp@latest [options]

Options:
  --help, -h                          Show this help message

Environment Variables:
  MCP_SERVER_NAME         Server name
  MCP_SERVER_VERSION      Server version

  Embedding Provider Configuration:
  EMBEDDING_PROVIDER      Embedding provider: OpenAI, VoyageAI, Gemini, Ollama (default: OpenAI)
  EMBEDDING_MODEL         Embedding model name (works for all providers)

  Provider-specific API Keys:
  OPENAI_API_KEY          OpenAI API key (required for OpenAI provider)
  OPENAI_BASE_URL         OpenAI API base URL (optional, for custom endpoints)
  VOYAGEAI_API_KEY        VoyageAI API key (required for VoyageAI provider)
  GEMINI_API_KEY          Google AI API key (required for Gemini provider)

  Ollama Configuration:
  OLLAMA_HOST             Ollama server host (default: http://127.0.0.1:11434)
  OLLAMA_MODEL            Ollama model name (alternative to EMBEDDING_MODEL for Ollama)

  Reranking Configuration (requires @huggingface/transformers):
  RERANKING_PROVIDER      Reranking provider: HuggingFace, Disabled (default: Disabled)
  RERANKING_MODEL         Reranking model name (default: jinaai/jina-reranker-v2-base-multilingual)
  RERANKING_ENABLED       Enable reranking: true, false (default: false, auto-enabled if RERANKING_PROVIDER=HuggingFace)

  📦 To install reranking dependencies:
    npm install @huggingface/transformers  (or pnpm add @huggingface/transformers)

  PRF (Pseudo-Relevance Feedback) Configuration:
  PRF_ENABLED             Enable PRF query expansion: true, false (default: false)
  PRF_TOP_K               Number of pseudo-relevant documents to analyze (default: 7, recommended: 5-10)
  PRF_EXPANSION_TERMS     Number of expansion terms to add to query (default: 8, recommended: 5-10)
  PRF_MIN_TERM_FREQ       Minimum term frequency threshold (default: 2)
  PRF_ORIGINAL_WEIGHT     Original query weight in interpolation (default: 0.7, recommended: 0.6-0.8)
  PRF_CODE_TOKENS         Enable code-aware tokenization: true, false (default: true)
  PRF_MIN_TERM_LENGTH     Minimum term length to consider (default: 3)
  PRF_STOP_WORDS          Custom stop words (comma-separated, optional)

  Vector Database Configuration:
  MILVUS_ADDRESS          Milvus address (optional, can be auto-resolved from token)
  MILVUS_TOKEN            Milvus token (optional, used for authentication and address resolution)

  Auto-Update Configuration:
  AUTO_UPDATE             Enable/disable auto-updates: true, false (default: true)
  UPDATE_CHECK_INTERVAL   Update check interval in milliseconds (default: 3600000 = 1 hour)
  UPDATE_SOURCE           Update source: github-packages, github-releases (default: github-packages)

Examples:
  # Start MCP server with OpenAI (default) and explicit Milvus address
  OPENAI_API_KEY=sk-xxx MILVUS_ADDRESS=localhost:19530 bunx @everwise/claude-context-mcp@latest

  # Start MCP server with OpenAI and specific model
  OPENAI_API_KEY=sk-xxx EMBEDDING_MODEL=text-embedding-3-large MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with VoyageAI and specific model
  EMBEDDING_PROVIDER=VoyageAI VOYAGEAI_API_KEY=pa-xxx EMBEDDING_MODEL=voyage-3-large MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with Gemini and specific model
  EMBEDDING_PROVIDER=Gemini GEMINI_API_KEY=xxx EMBEDDING_MODEL=gemini-embedding-001 MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with Ollama and specific model (using OLLAMA_MODEL)
  EMBEDDING_PROVIDER=Ollama OLLAMA_MODEL=mxbai-embed-large MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with Ollama and specific model (using EMBEDDING_MODEL)
  EMBEDDING_PROVIDER=Ollama EMBEDDING_MODEL=nomic-embed-text MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with HuggingFace reranking enabled
  OPENAI_API_KEY=sk-xxx RERANKING_PROVIDER=HuggingFace MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with custom reranking model
  OPENAI_API_KEY=sk-xxx RERANKING_PROVIDER=HuggingFace RERANKING_MODEL=jinaai/jina-reranker-v2-base-multilingual MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with PRF enabled
  OPENAI_API_KEY=sk-xxx PRF_ENABLED=true MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with custom PRF configuration
  OPENAI_API_KEY=sk-xxx PRF_ENABLED=true PRF_TOP_K=5 PRF_EXPANSION_TERMS=10 PRF_ORIGINAL_WEIGHT=0.8 MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with both reranking and PRF enabled
  OPENAI_API_KEY=sk-xxx RERANKING_PROVIDER=HuggingFace PRF_ENABLED=true MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest

  # Start MCP server with auto-updates disabled
  OPENAI_API_KEY=sk-xxx AUTO_UPDATE=false MILVUS_TOKEN=your-token bunx @everwise/claude-context-mcp@latest
        `);
}