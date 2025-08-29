import { PRFEngine } from '../prf-engine';
import { SemanticSearchResult } from '../../types';

/**
 * Simple smoke test for PRF engine functionality
 * Tests basic term extraction and query expansion
 */
describe('PRF Engine - Smoke Test', () => {
    let prfEngine: PRFEngine;

    beforeEach(() => {
        prfEngine = new PRFEngine({
            enabled: true,
            topK: 7,
            expansionTerms: 5,
            minTermFreq: 1,
            originalWeight: 0.7,
            codeTokens: true,
            minTermLength: 3,
            stopWords: new Set(['the', 'and', 'or', 'is', 'are', 'was', 'were'])
        });
    });

    test('should extract expansion terms from code search results', async () => {
        const mockSearchResults: SemanticSearchResult[] = [
            {
                content: 'async function handleError(error: Error) { try { console.log(error.message); } catch (e) { throw e; } }',
                relativePath: 'src/error-handler.ts',
                startLine: 10,
                endLine: 15,
                language: 'typescript',
                score: 0.9
            },
            {
                content: 'function processException(exception: Exception) { log.error(exception); handleException(exception); }',
                relativePath: 'src/exception-processor.ts', 
                startLine: 20,
                endLine: 25,
                language: 'typescript',
                score: 0.85
            },
            {
                content: 'class ErrorLogger { public logError(error: Error): void { this.logger.error(error.stack); } }',
                relativePath: 'src/logger.ts',
                startLine: 5,
                endLine: 10, 
                language: 'typescript',
                score: 0.8
            }
        ];

        const result = await prfEngine.expandQuery('error handling', mockSearchResults);

        // Validate basic result structure
        expect(result).toBeDefined();
        expect(result.originalQuery).toBe('error handling');
        expect(result.expandedQuery).toBeDefined();
        expect(result.expansionTerms).toBeDefined();
        expect(result.documentsAnalyzed).toBe(3);
        expect(result.reasoning).toContain('Analyzed 3 pseudo-relevant documents');
        expect(result.processingTimeMs).toBeGreaterThan(0);

        // Check if meaningful expansion occurred
        if (result.expansionTerms.length > 0) {
            expect(result.expandedQuery).not.toBe(result.originalQuery);
            console.log('Expansion terms found:', result.expansionTerms.map(t => t.term));
            console.log('Expanded query:', result.expandedQuery);
        }
    });

    test('should handle empty search results gracefully', async () => {
        const result = await prfEngine.expandQuery('test query', []);
        
        expect(result.originalQuery).toBe('test query');
        expect(result.expandedQuery).toBe('test query');
        expect(result.expansionTerms).toHaveLength(0);
        expect(result.documentsAnalyzed).toBe(0);
        expect(result.reasoning).toContain('No search results provided');
    });

    test('should handle insufficient documents', async () => {
        const mockResults: SemanticSearchResult[] = [
            {
                content: 'function test() { return true; }',
                relativePath: 'test.ts',
                startLine: 1,
                endLine: 3,
                language: 'typescript', 
                score: 0.9
            }
        ];

        const result = await prfEngine.expandQuery('test query', mockResults);
        
        // Should fallback gracefully
        expect(result.originalQuery).toBe('test query');
        expect(result.reasoning).toContain('Insufficient documents');
    });

    test('should track statistics correctly', () => {
        const initialStats = prfEngine.getStats();
        expect(initialStats.totalQueries).toBe(0);
        expect(initialStats.avgProcessingTime).toBe(0);
        expect(initialStats.successRate).toBe(0);
    });

    test('should reset statistics', () => {
        prfEngine.resetStats();
        const stats = prfEngine.getStats();
        expect(stats.totalQueries).toBe(0);
        expect(stats.avgProcessingTime).toBe(0);
        expect(stats.successRate).toBe(0);
    });
});