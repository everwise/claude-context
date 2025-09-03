import Parser from 'tree-sitter';
import { Splitter, CodeChunk } from './index';
import { LangChainCodeSplitter } from './langchain-splitter';

// Language parsers
const JavaScript = require('tree-sitter-javascript');
const { typescript: TypeScript, tsx: TSX } = require('tree-sitter-typescript');
const Python = require('tree-sitter-python');
const Java = require('tree-sitter-java');
const Cpp = require('tree-sitter-cpp');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const CSharp = require('tree-sitter-c-sharp');
const Ruby = require('tree-sitter-ruby');
const Scala = require('tree-sitter-scala');

// Node types that represent logical code units
const SPLITTABLE_NODE_TYPES = {
    javascript: ['import_statement', 'function_declaration', 'class_declaration', 'method_definition', 'export_statement', 'variable_declaration', 'lexical_declaration', 'arrow_function', 'export_declaration'],
    typescript: ['import_statement', 'function_declaration', 'class_declaration', 'method_definition', 'export_statement', 'interface_declaration', 'type_alias_declaration', 'variable_declaration', 'lexical_declaration', 'arrow_function', 'export_declaration'],
    tsx: ['import_statement', 'function_declaration', 'class_declaration', 'method_definition', 'export_statement', 'interface_declaration', 'type_alias_declaration', 'variable_declaration', 'lexical_declaration', 'arrow_function', 'export_declaration'],
    python: ['function_definition', 'class_definition', 'decorated_definition', 'async_function_definition', 'import_statement', 'import_from_statement', 'future_import_statement', 'assignment', 'assignment_expression'],
    java: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration', 'import_declaration', 'package_declaration', 'field_declaration', 'local_variable_declaration'],
    cpp: ['function_definition', 'class_specifier', 'namespace_definition', 'declaration'],
    go: ['function_declaration', 'method_declaration', 'type_declaration', 'var_declaration', 'const_declaration', 'import_declaration'],
    rust: ['function_item', 'impl_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item', 'use_declaration', 'static_item', 'const_item'],
    csharp: ['method_declaration', 'class_declaration', 'interface_declaration', 'struct_declaration', 'enum_declaration'],
    ruby: ['method', 'class', 'module', 'def', 'singleton_method'],
    scala: ['method_declaration', 'class_declaration', 'interface_declaration', 'constructor_declaration']
};

export class AstCodeSplitter implements Splitter {
    private chunkSize: number = 2500;
    private chunkOverlap: number = 0;
    private parser: Parser;
    private langchainFallback: any; // LangChainCodeSplitter for fallback

    constructor(chunkSize?: number, chunkOverlap?: number, enableChunkOverlap?: boolean) {
        if (chunkSize) this.chunkSize = chunkSize;
        if (chunkOverlap && !!enableChunkOverlap) this.chunkOverlap = chunkOverlap;
        this.parser = new Parser();

        // Initialize fallback splitter
        this.langchainFallback = new LangChainCodeSplitter(chunkSize, chunkOverlap);
    }

    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        // Check if language is supported by AST splitter
        const langConfig = this.getLanguageConfig(language);
        if (!langConfig) {
            console.log(`📝 Language ${language} not supported by AST, using LangChain splitter for: ${filePath || 'unknown'}`);
            return await this.langchainFallback.split(code, language, filePath);
        }

        try {
            console.log(`🌳 Using AST splitter for ${language} file: ${filePath || 'unknown'}`);

            this.parser.setLanguage(langConfig.parser);
            const tree = this.parser.parse(code);

            if (!tree.rootNode) {
                console.warn(`[ASTSplitter] ⚠️  Failed to parse AST for ${language}, falling back to LangChain: ${filePath || 'unknown'}`);
                return await this.langchainFallback.split(code, language, filePath);
            }

            // Extract chunks based on AST nodes
            const chunks = this.extractChunks(tree.rootNode, code, langConfig.nodeTypes, language, filePath);

            // If chunks are too large, split them further
            const refinedChunks = await this.refineChunks(chunks, code);

            return refinedChunks;
        } catch (error) {
            console.warn(`[ASTSplitter] ⚠️  AST splitter failed for ${language}, falling back to LangChain: ${error}`);
            return await this.langchainFallback.split(code, language, filePath);
        }
    }

    setChunkSize(chunkSize: number): void {
        this.chunkSize = chunkSize;
        this.langchainFallback.setChunkSize(chunkSize);
    }

    setChunkOverlap(chunkOverlap: number): void {
        this.chunkOverlap = chunkOverlap;
        this.langchainFallback.setChunkOverlap(chunkOverlap);
    }

    private getLanguageConfig(language: string): { parser: any; nodeTypes: string[] } | null {
        const langMap: Record<string, { parser: any; nodeTypes: string[] }> = {
            'javascript': { parser: JavaScript, nodeTypes: SPLITTABLE_NODE_TYPES.javascript },
            'js': { parser: JavaScript, nodeTypes: SPLITTABLE_NODE_TYPES.javascript },
            'typescript': { parser: TypeScript, nodeTypes: SPLITTABLE_NODE_TYPES.typescript },
            'ts': { parser: TypeScript, nodeTypes: SPLITTABLE_NODE_TYPES.typescript },
            'tsx': { parser: TSX, nodeTypes: SPLITTABLE_NODE_TYPES.tsx },
            'python': { parser: Python, nodeTypes: SPLITTABLE_NODE_TYPES.python },
            'py': { parser: Python, nodeTypes: SPLITTABLE_NODE_TYPES.python },
            'java': { parser: Java, nodeTypes: SPLITTABLE_NODE_TYPES.java },
            'cpp': { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
            'c++': { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
            'c': { parser: Cpp, nodeTypes: SPLITTABLE_NODE_TYPES.cpp },
            'go': { parser: Go, nodeTypes: SPLITTABLE_NODE_TYPES.go },
            'rust': { parser: Rust, nodeTypes: SPLITTABLE_NODE_TYPES.rust },
            'rs': { parser: Rust, nodeTypes: SPLITTABLE_NODE_TYPES.rust },
            'cs': { parser: CSharp, nodeTypes: SPLITTABLE_NODE_TYPES.csharp },
            'csharp': { parser: CSharp, nodeTypes: SPLITTABLE_NODE_TYPES.csharp },
            'ruby': { parser: Ruby, nodeTypes: SPLITTABLE_NODE_TYPES.ruby },
            'rb': { parser: Ruby, nodeTypes: SPLITTABLE_NODE_TYPES.ruby },
            'scala': { parser: Scala, nodeTypes: SPLITTABLE_NODE_TYPES.scala }
        };

        return langMap[language.toLowerCase()] || null;
    }

    private extractChunks(
        node: Parser.SyntaxNode,
        code: string,
        splittableTypes: string[],
        language: string,
        filePath?: string
    ): CodeChunk[] {
        const chunks: CodeChunk[] = [];
        const codeLines = code.split('\n');

        // Group consecutive imports at file start
        const { chunk: importChunk, processedNodes } = this.groupConsecutiveImports(node, code, language, filePath);
        if (importChunk) {
            chunks.push(importChunk);
        }

        const traverse = (currentNode: Parser.SyntaxNode) => {
            // Skip already processed import nodes
            if (processedNodes.has(currentNode)) return;

            // Check if this node type should be split into a chunk
            if (splittableTypes.includes(currentNode.type)) {
                const startLine = currentNode.startPosition.row + 1;
                const endLine = currentNode.endPosition.row + 1;
                const nodeText = code.slice(currentNode.startIndex, currentNode.endIndex);

                // Only create chunk if it has meaningful content
                if (nodeText.trim().length > 0) {
                    chunks.push({
                        content: nodeText,
                        metadata: {
                            startLine,
                            endLine,
                            language,
                            filePath,
                        }
                    });
                }
            }

            // Continue traversing child nodes
            for (const child of currentNode.children) {
                traverse(child);
            }
        };

        traverse(node);

        // If no meaningful chunks found, create a single chunk with the entire code
        if (chunks.length === 0) {
            chunks.push({
                content: code,
                metadata: {
                    startLine: 1,
                    endLine: codeLines.length,
                    language,
                    filePath,
                }
            });
        }

        return chunks;
    }

    private async refineChunks(chunks: CodeChunk[], originalCode: string): Promise<CodeChunk[]> {
        const refinedChunks: CodeChunk[] = [];

        for (const chunk of chunks) {
            if (chunk.content.length <= this.chunkSize) {
                refinedChunks.push(chunk);
            } else {
                // Split large chunks using character-based splitting
                const subChunks = this.splitLargeChunk(chunk);
                refinedChunks.push(...subChunks);
            }
        }

        return this.addOverlap(this.deduplicateChunks(refinedChunks));
    }

    private deduplicateChunks(chunks: CodeChunk[]): CodeChunk[] {
        const seenRanges = new Set<string>();
        const deduplicatedChunks: CodeChunk[] = [];

        for (const chunk of chunks) {
            const rangeKey = `${chunk.metadata.startLine}-${chunk.metadata.endLine}`;

            if (!seenRanges.has(rangeKey)) {
                seenRanges.add(rangeKey);
                deduplicatedChunks.push(chunk);
            } else {
                console.log(`[AST-DEDUPE] Removed duplicate chunk at lines ${rangeKey} from ${chunk.metadata.filePath}`);
            }
        }

        return deduplicatedChunks;
    }

    private splitLargeChunk(chunk: CodeChunk): CodeChunk[] {
        const lines = chunk.content.split('\n');
        const subChunks: CodeChunk[] = [];
        let currentChunk = '';
        let currentStartLine = chunk.metadata.startLine;
        let currentLineCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineWithNewline = i === lines.length - 1 ? line : line + '\n';

            if (currentChunk.length + lineWithNewline.length > this.chunkSize && currentChunk.length > 0) {
                // Create a sub-chunk
                subChunks.push({
                    content: currentChunk.trim(),
                    metadata: {
                        startLine: currentStartLine,
                        endLine: currentStartLine + currentLineCount - 1,
                        language: chunk.metadata.language,
                        filePath: chunk.metadata.filePath,
                    }
                });

                currentChunk = lineWithNewline;
                currentStartLine = chunk.metadata.startLine + i;
                currentLineCount = 1;
            } else {
                currentChunk += lineWithNewline;
                currentLineCount++;
            }
        }

        // Add the last sub-chunk
        if (currentChunk.trim().length > 0) {
            subChunks.push({
                content: currentChunk.trim(),
                metadata: {
                    startLine: currentStartLine,
                    endLine: currentStartLine + currentLineCount - 1,
                    language: chunk.metadata.language,
                    filePath: chunk.metadata.filePath,
                }
            });
        }

        return subChunks;
    }

    private addOverlap(chunks: CodeChunk[]): CodeChunk[] {
        if (chunks.length <= 1 || this.chunkOverlap <= 0) {
            return chunks;
        }

        const overlappedChunks: CodeChunk[] = [];

        for (let i = 0; i < chunks.length; i++) {
            let content = chunks[i].content;
            const metadata = { ...chunks[i].metadata };

            // Add overlap from previous chunk
            if (i > 0 && this.chunkOverlap > 0) {
                const prevChunk = chunks[i - 1];
                const overlapText = prevChunk.content.slice(-this.chunkOverlap);
                content = overlapText + '\n' + content;
                metadata.startLine = Math.max(1, metadata.startLine - this.getLineCount(overlapText));
            }

            overlappedChunks.push({
                content,
                metadata
            });
        }

        return overlappedChunks;
    }

    private getLineCount(text: string): number {
        return text.split('\n').length;
    }

    /**
     * Get list of languages supported by AST splitting
     */
    static getSupportedLanguages(): string[] {
        return [
            'javascript', 'js', 'typescript', 'ts', 'tsx', 'python', 'py',
            'java', 'cpp', 'c++', 'c', 'go', 'rust', 'rs', 'cs', 'csharp', 'ruby', 'rb', 'scala'
        ];
    }

    /**
     * Check if AST splitting is supported for the given language
     */
    static isLanguageSupported(language: string): boolean {
        return this.getSupportedLanguages().includes(language.toLowerCase());
    }

    private groupConsecutiveImports(
        rootNode: Parser.SyntaxNode,
        code: string,
        language: string,
        filePath?: string
    ): { chunk: CodeChunk | null, processedNodes: Set<Parser.SyntaxNode> } {
        const children = rootNode.children;
        const imports: Parser.SyntaxNode[] = [];

        // Find consecutive imports from start (skip only comments/whitespace)
        for (const child of children) {
            if (child.type === 'import_statement') {
                imports.push(child);
            } else if (child.type === 'comment' || this.isWhitespaceNode(child)) {
                continue; // Skip comments and whitespace
            } else {
                break; // Hit first real code - stop grouping
            }
        }

        if (imports.length <= 1) {
            return { chunk: null, processedNodes: new Set() };
        }

        const firstImport = imports[0];
        const lastImport = imports[imports.length - 1];

        return {
            chunk: {
                content: code.slice(firstImport.startIndex, lastImport.endIndex),
                metadata: {
                    startLine: firstImport.startPosition.row + 1,
                    endLine: lastImport.endPosition.row + 1,
                    language,
                    filePath,
                }
            },
            processedNodes: new Set(imports)
        };
    }

    private isWhitespaceNode(node: Parser.SyntaxNode): boolean {
        return node.type === '\n' || node.type === 'whitespace' || node.text?.trim() === '';
    }
}
