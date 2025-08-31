import { Context } from "@everwise/claude-context-core";
import { ContextMcpConfig } from "./config.js";

export function logSplitterInfo(config: ContextMcpConfig, context: Context): void {
    console.log(`[SPLITTER] ✅ Successfully initialized code splitter`);
    console.log(`[SPLITTER] Configuration - ChunkSize: ${config.splitterChunkSize}, ChunkOverlap: ${config.splitterChunkOverlap}`);

    // Get detailed splitter information from Context
    const splitterInfo = context.getSplitterInfo();
    
    if (splitterInfo.type === 'ast') {
        console.log(`[SPLITTER] Type: AST Splitter (syntax-aware with automatic fallback)`);
        
        if (splitterInfo.supportedLanguages) {
            const languages = splitterInfo.supportedLanguages;
            console.log(`[SPLITTER] Supported Languages (${languages.length}): ${languages.join(', ')}`);
        }
        
        if (splitterInfo.hasBuiltinFallback) {
            console.log(`[SPLITTER] Fallback: ✅ Automatic LangChain fallback for unsupported languages`);
        }
    } else {
        console.log(`[SPLITTER] Type: LangChain Splitter (character-based)`);
        console.log(`[SPLITTER] Language Support: ✅ All programming languages supported`);
    }
}