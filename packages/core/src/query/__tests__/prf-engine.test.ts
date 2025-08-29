import { PRFEngine, PRFResult, PRFMetrics } from '../prf-engine';
import { TfIdf } from '../../utils/tf-idf';
import { SemanticSearchResult } from '../../types';

/**
 * Test-Driven Development (TDD) Tests for PRF (Pseudo-Relevance Feedback) Engine
 * 
 * Following TDD methodology: Write tests first, run to confirm failures, then implement.
 * 
 * Research-backed requirements tested:
 * - Use 7-10 pseudo-relevant documents (topK)
 * - Extract 5-10 expansion terms 
 * - Filter terms: min length 3, not stop words, not in original query
 * - RM3 interpolation with original query weight 0.6-0.8
 * - Handle code-specific tokenization (camelCase, snake_case)
 * - Track performance metrics (processing time, success rate)
 */

describe('PRFEngine', () => {
    let prfEngine: PRFEngine;
    let mockSemanticResults: SemanticSearchResult[];

    beforeEach(() => {
        prfEngine = new PRFEngine();
        
        // Create realistic code search results for testing
        mockSemanticResults = [
            {
                content: `try {
                    const result = await fetchData();
                    handleSuccess(result);
                } catch (error) {
                    console.error('Failed to fetch:', error);
                    throw new CustomError('Fetch failed');
                }`,
                relativePath: 'src/utils/errorHandler.ts',
                startLine: 10,
                endLine: 18,
                language: 'typescript',
                score: 0.95
            },
            {
                content: `function validateInput(data) {
                    if (!data) {
                        throw new ValidationError('Input required');
                    }
                    try {
                        return sanitizeData(data);
                    } catch (err) {
                        logError(err);
                        return null;
                    }
                }`,
                relativePath: 'src/validation/validator.js',
                startLine: 5,
                endLine: 15,
                language: 'javascript',
                score: 0.88
            },
            {
                content: `class DatabaseConnection {
                    private connection: Connection;
                    private pool: ConnectionPool;
                    
                    async connect(): Promise<void> {
                        try {
                            this.connection = await this.pool.getConnection();
                        } catch (connectError) {
                            throw new ConnectionError('DB connection failed');
                        }
                    }
                }`,
                relativePath: 'src/database/connection.ts',
                startLine: 1,
                endLine: 13,
                language: 'typescript',
                score: 0.82
            },
            {
                content: `interface UserProfile {
                    id: string;
                    name: string;
                    email: string;
                    preferences: UserPreferences;
                }
                
                type UserPreferences = {
                    theme: 'light' | 'dark';
                    notifications: boolean;
                };`,
                relativePath: 'src/types/user.ts',
                startLine: 1,
                endLine: 11,
                language: 'typescript',
                score: 0.75
            },
            {
                content: `def handle_exception(func):
                    def wrapper(*args, **kwargs):
                        try:
                            return func(*args, **kwargs)
                        except Exception as e:
                            logger.error(f"Error in {func.__name__}: {e}")
                            raise
                    return wrapper`,
                relativePath: 'src/decorators/error_handler.py',
                startLine: 8,
                endLine: 16,
                language: 'python',
                score: 0.72
            },
            {
                content: `export const API_CONFIG = {
                    baseURL: process.env.API_BASE_URL,
                    timeout: 5000,
                    retryAttempts: 3,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                };`,
                relativePath: 'src/config/api.ts',
                startLine: 1,
                endLine: 8,
                language: 'typescript',
                score: 0.68
            },
            {
                content: `const errorMessages = {
                    VALIDATION_FAILED: 'Input validation failed',
                    CONNECTION_TIMEOUT: 'Database connection timeout',
                    UNAUTHORIZED: 'User not authorized',
                    NOT_FOUND: 'Resource not found'
                };`,
                relativePath: 'src/constants/errors.js',
                startLine: 1,
                endLine: 6,
                language: 'javascript',
                score: 0.65
            },
            {
                content: `class ErrorLogger {
                    static log(error: Error, context?: string): void {
                        const timestamp = new Date().toISOString();
                        console.error(\`[\${timestamp}] \${context || 'Unknown'}: \${error.message}\`);
                    }
                }`,
                relativePath: 'src/logging/errorLogger.ts',
                startLine: 3,
                endLine: 8,
                language: 'typescript',
                score: 0.60
            },
            {
                content: `async function retryOperation(operation: () => Promise<any>, maxAttempts: number = 3): Promise<any> {
                    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                        try {
                            return await operation();
                        } catch (error) {
                            if (attempt === maxAttempts) throw error;
                            await delay(attempt * 1000);
                        }
                    }
                }`,
                relativePath: 'src/utils/retry.ts',
                startLine: 12,
                endLine: 22,
                language: 'typescript',
                score: 0.58
            },
            {
                content: `export interface ApiResponse<T> {
                    data: T;
                    success: boolean;
                    error?: string;
                    timestamp: number;
                }`,
                relativePath: 'src/types/api.ts',
                startLine: 15,
                endLine: 20,
                language: 'typescript',
                score: 0.55
            }
        ];
    });

    describe('constructor', () => {
        it('should create PRF engine instance', () => {
            expect(prfEngine).toBeInstanceOf(PRFEngine);
        });

        it('should accept configuration options', () => {
            const config = {
                topK: 8,
                maxExpansionTerms: 7,
                originalQueryWeight: 0.7,
                minTermLength: 4
            };
            
            const configuredEngine = new PRFEngine(config);
            expect(configuredEngine).toBeInstanceOf(PRFEngine);
        });

        it('should use default configuration when none provided', () => {
            const defaultEngine = new PRFEngine();
            expect(defaultEngine).toBeInstanceOf(PRFEngine);
        });
    });

    describe('expandQuery', () => {
        describe('basic functionality', () => {
            it('should expand query using pseudo-relevant documents', async () => {
                const originalQuery = 'error handling';
                
                const result = await prfEngine.expandQuery(originalQuery, mockSemanticResults);
                
                expect(result).toBeDefined();
                expect(result.originalQuery).toBe(originalQuery);
                expect(result.expandedQuery).toBeDefined();
                expect(result.expandedQuery).not.toBe(originalQuery);
                expect(result.expansionTerms).toBeDefined();
                expect(Array.isArray(result.expansionTerms)).toBe(true);
            });

            it('should return PRF result with all required properties', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                expect(result).toEqual(expect.objectContaining({
                    originalQuery: expect.any(String),
                    expandedQuery: expect.any(String),
                    expansionTerms: expect.any(Array),
                    reasoning: expect.any(String),
                    metrics: expect.objectContaining({
                        processingTimeMs: expect.any(Number),
                        documentsProcessed: expect.any(Number),
                        termsExtracted: expect.any(Number),
                        termsFiltered: expect.any(Number),
                        expansionTermsSelected: expect.any(Number)
                    })
                }));
            });

            it('should use research-backed number of pseudo-relevant documents (7-10)', async () => {
                const result = await prfEngine.expandQuery('database connection', mockSemanticResults);
                
                expect(result.metrics.documentsProcessed).toBeGreaterThanOrEqual(7);
                expect(result.metrics.documentsProcessed).toBeLessThanOrEqual(10);
            });

            it('should select appropriate number of expansion terms (5-10)', async () => {
                const result = await prfEngine.expandQuery('typescript interface', mockSemanticResults);
                
                expect(result.expansionTerms.length).toBeGreaterThanOrEqual(5);
                expect(result.expansionTerms.length).toBeLessThanOrEqual(10);
                expect(result.metrics.expansionTermsSelected).toBe(result.expansionTerms.length);
            });
        });

        describe('term extraction and TF-IDF analysis', () => {
            it('should extract terms using TF-IDF analysis from pseudo-relevant documents', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // Should extract code-relevant terms
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                expect(result.expansionTerms.length).toBeGreaterThan(0);
                expect(result.metrics.termsExtracted).toBeGreaterThan(result.expansionTerms.length);
            });

            it('should rank terms by TF-IDF score', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // Terms should be ranked - no direct way to test ordering without implementation details
                // But we can verify that high-quality terms are selected
                expect(result.expansionTerms.length).toBeGreaterThan(0);
                expect(result.reasoning).toContain('ranked');
            });

            it('should handle code-specific term extraction for error handling queries', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // Should find code-related error handling terms
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const expectedTerms = ['try', 'catch', 'throw', 'exception', 'error'];
                const foundRelevantTerms = expectedTerms.some(term => expansionTermsStr.includes(term));
                
                expect(foundRelevantTerms).toBe(true);
            });

            it('should handle code-specific term extraction for database queries', async () => {
                const result = await prfEngine.expandQuery('database connection', mockSemanticResults);
                
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const expectedTerms = ['connection', 'database', 'pool', 'connect'];
                const foundRelevantTerms = expectedTerms.some(term => expansionTermsStr.includes(term));
                
                expect(foundRelevantTerms).toBe(true);
            });

            it('should handle code-specific term extraction for interface queries', async () => {
                const result = await prfEngine.expandQuery('typescript interface', mockSemanticResults);
                
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const expectedTerms = ['interface', 'type', 'definition', 'typescript'];
                const foundRelevantTerms = expectedTerms.some(term => expansionTermsStr.includes(term));
                
                expect(foundRelevantTerms).toBe(true);
            });
        });

        describe('term filtering', () => {
            it('should filter terms by minimum length (3+ characters)', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // All expansion terms should be at least 3 characters
                result.expansionTerms.forEach(term => {
                    expect(term.length).toBeGreaterThanOrEqual(3);
                });
            });

            it('should filter out stop words', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                const commonStopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
                const hasStopWords = result.expansionTerms.some(term => 
                    commonStopWords.includes(term.toLowerCase())
                );
                
                expect(hasStopWords).toBe(false);
            });

            it('should filter out original query terms', async () => {
                const originalQuery = 'error handling';
                const result = await prfEngine.expandQuery(originalQuery, mockSemanticResults);
                
                const originalTerms = originalQuery.toLowerCase().split(' ');
                const hasOriginalTerms = result.expansionTerms.some(term =>
                    originalTerms.includes(term.toLowerCase())
                );
                
                expect(hasOriginalTerms).toBe(false);
            });

            it('should filter terms by frequency threshold', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // Should filter out very rare terms (appears only once) and very common terms
                expect(result.metrics.termsFiltered).toBeGreaterThan(0);
                expect(result.metrics.termsExtracted).toBeGreaterThan(result.metrics.expansionTermsSelected);
            });

            it('should provide reasoning about filtering decisions', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                expect(result.reasoning).toContain('filtered');
                expect(result.reasoning).toMatch(/\d+ terms? (were )?filtered/i);
            });
        });

        describe('code-specific tokenization', () => {
            it('should handle camelCase splitting in code content', async () => {
                const camelCaseResults = [
                    {
                        content: `const getUserData = () => { return fetchUserProfile(); }`,
                        relativePath: 'src/user/userData.ts',
                        startLine: 1,
                        endLine: 1,
                        language: 'typescript',
                        score: 0.9
                    },
                    {
                        content: `function handleErrorResponse(errorData) { logErrorMessage(errorData); }`,
                        relativePath: 'src/error/handler.js',
                        startLine: 5,
                        endLine: 5,
                        language: 'javascript',
                        score: 0.8
                    }
                ];

                const result = await prfEngine.expandQuery('user data', camelCaseResults);
                
                // Should split camelCase terms like getUserData -> get, user, data
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const expectedSplitTerms = ['user', 'data', 'get', 'profile', 'fetch'];
                const foundSplitTerms = expectedSplitTerms.some(term => expansionTermsStr.includes(term));
                
                expect(foundSplitTerms).toBe(true);
            });

            it('should handle snake_case splitting in code content', async () => {
                const snakeCaseResults = [
                    {
                        content: `def get_user_profile(): return fetch_user_data()`,
                        relativePath: 'src/user_service.py',
                        startLine: 10,
                        endLine: 10,
                        language: 'python',
                        score: 0.9
                    },
                    {
                        content: `const error_handler = require('./error_utils');`,
                        relativePath: 'src/error_handler.js',
                        startLine: 1,
                        endLine: 1,
                        language: 'javascript',
                        score: 0.8
                    }
                ];

                const result = await prfEngine.expandQuery('user profile', snakeCaseResults);
                
                // Should split snake_case terms like get_user_profile -> get, user, profile
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const expectedSplitTerms = ['user', 'profile', 'get', 'data', 'fetch'];
                const foundSplitTerms = expectedSplitTerms.some(term => expansionTermsStr.includes(term));
                
                expect(foundSplitTerms).toBe(true);
            });

            it('should handle mixed case conventions in code', async () => {
                const mixedCaseResults = [
                    {
                        content: `class UserDataManager { getUserProfile() { return this.fetch_user_data(); } }`,
                        relativePath: 'src/UserManager.ts',
                        startLine: 8,
                        endLine: 8,
                        language: 'typescript',
                        score: 0.9
                    }
                ];

                const result = await prfEngine.expandQuery('user management', mixedCaseResults);
                
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                expect(result.expansionTerms.length).toBeGreaterThan(0);
                // Should handle both camelCase and snake_case in same content
                expect(result.reasoning).toContain('tokenization');
            });
        });

        describe('RM3-style query expansion', () => {
            it('should perform RM3 interpolation with original query weight 0.6-0.8', async () => {
                const originalQuery = 'error handling';
                const result = await prfEngine.expandQuery(originalQuery, mockSemanticResults);
                
                // Expanded query should contain both original terms and expansion terms
                expect(result.expandedQuery).toContain('error');
                expect(result.expandedQuery).toContain('handling');
                
                // Should have more terms than original
                const originalTermCount = originalQuery.split(' ').length;
                const expandedTermCount = result.expandedQuery.split(' ').length;
                expect(expandedTermCount).toBeGreaterThan(originalTermCount);
                
                // Verify reasoning mentions interpolation
                expect(result.reasoning).toMatch(/interpolat|weight|RM3/i);
            });

            it('should preserve original query prominence in expanded query', async () => {
                const originalQuery = 'database connection';
                const result = await prfEngine.expandQuery(originalQuery, mockSemanticResults);
                
                // Original terms should appear early in expanded query (higher weight)
                const expandedTerms = result.expandedQuery.split(' ');
                const firstFewTerms = expandedTerms.slice(0, 4).join(' ').toLowerCase();
                
                expect(firstFewTerms).toContain('database');
                expect(firstFewTerms).toContain('connection');
            });

            it('should balance original and expansion terms appropriately', async () => {
                const result = await prfEngine.expandQuery('typescript interface', mockSemanticResults);
                
                const expandedTerms = result.expandedQuery.split(' ');
                const originalTerms = ['typescript', 'interface'];
                const expansionTerms = result.expansionTerms;
                
                // Should have reasonable balance - original terms weighted 0.6-0.8
                const originalTermsInExpanded = expandedTerms.filter(term => 
                    originalTerms.some(origTerm => term.toLowerCase().includes(origTerm.toLowerCase()))
                ).length;
                
                const expansionTermsInExpanded = expandedTerms.filter(term =>
                    expansionTerms.some(expTerm => term.toLowerCase().includes(expTerm.toLowerCase()))
                ).length;
                
                // Original terms should have significant presence but not dominate
                expect(originalTermsInExpanded).toBeGreaterThan(0);
                expect(expansionTermsInExpanded).toBeGreaterThan(0);
            });
        });

        describe('performance metrics', () => {
            it('should track processing time in milliseconds', async () => {
                const start = Date.now();
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                const end = Date.now();
                
                expect(result.metrics.processingTimeMs).toBeDefined();
                expect(result.metrics.processingTimeMs).toBeGreaterThan(0);
                expect(result.metrics.processingTimeMs).toBeLessThan(end - start + 100); // Allow some tolerance
            });

            it('should track number of documents processed', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                expect(result.metrics.documentsProcessed).toBeDefined();
                expect(result.metrics.documentsProcessed).toBeGreaterThan(0);
                expect(result.metrics.documentsProcessed).toBeLessThanOrEqual(mockSemanticResults.length);
            });

            it('should track terms extraction and filtering metrics', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                expect(result.metrics.termsExtracted).toBeDefined();
                expect(result.metrics.termsFiltered).toBeDefined();
                expect(result.metrics.expansionTermsSelected).toBeDefined();
                
                // Logical relationships
                expect(result.metrics.termsExtracted).toBeGreaterThanOrEqual(result.metrics.expansionTermsSelected);
                expect(result.metrics.termsFiltered).toBe(
                    result.metrics.termsExtracted - result.metrics.expansionTermsSelected
                );
            });

            it('should complete processing within reasonable time limits', async () => {
                const start = Date.now();
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                const elapsed = Date.now() - start;
                
                // Should complete within 5 seconds for 10 documents
                expect(elapsed).toBeLessThan(5000);
                expect(result.metrics.processingTimeMs).toBeLessThan(5000);
            });
        });

        describe('edge cases', () => {
            it('should handle empty search results gracefully', async () => {
                const result = await prfEngine.expandQuery('error handling', []);
                
                expect(result.originalQuery).toBe('error handling');
                expect(result.expandedQuery).toBe('error handling'); // Falls back to original
                expect(result.expansionTerms).toEqual([]);
                expect(result.metrics.documentsProcessed).toBe(0);
                expect(result.reasoning).toContain('No pseudo-relevant documents');
            });

            it('should handle insufficient documents (less than 7)', async () => {
                const insufficientResults = mockSemanticResults.slice(0, 3);
                const result = await prfEngine.expandQuery('error handling', insufficientResults);
                
                // Should process available documents but note insufficiency
                expect(result.metrics.documentsProcessed).toBe(3);
                expect(result.reasoning).toMatch(/insufficient|limited/i);
                expect(result.expandedQuery).toBeDefined();
            });

            it('should handle documents with no valid expansion terms', async () => {
                const noValidTermsResults = [
                    {
                        content: 'a b c d e f g h i j',
                        relativePath: 'test.txt',
                        startLine: 1,
                        endLine: 1,
                        language: 'text',
                        score: 0.5
                    }
                ];

                const result = await prfEngine.expandQuery('error handling', noValidTermsResults);
                
                expect(result.originalQuery).toBe('error handling');
                expect(result.expandedQuery).toBe('error handling'); // Falls back to original
                expect(result.expansionTerms).toEqual([]);
                expect(result.reasoning).toContain('no valid expansion terms');
            });

            it('should handle very short query terms', async () => {
                const result = await prfEngine.expandQuery('a b', mockSemanticResults);
                
                // Original very short terms should not prevent expansion
                expect(result.expandedQuery.length).toBeGreaterThan('a b'.length);
                expect(result.expansionTerms.length).toBeGreaterThan(0);
            });

            it('should handle queries that match all content', async () => {
                // Query that appears in many documents
                const result = await prfEngine.expandQuery('function', mockSemanticResults);
                
                expect(result.expandedQuery).toBeDefined();
                expect(result.metrics.documentsProcessed).toBeGreaterThan(0);
                // Should still find complementary terms
                expect(result.expansionTerms.length).toBeGreaterThan(0);
            });

            it('should handle single document input', async () => {
                const singleResult = [mockSemanticResults[0]];
                const result = await prfEngine.expandQuery('error handling', singleResult);
                
                expect(result.metrics.documentsProcessed).toBe(1);
                expect(result.reasoning).toMatch(/single document|limited/i);
                // Should still attempt expansion with available content
                expect(result.expandedQuery).toBeDefined();
            });
        });

        describe('integration with existing systems', () => {
            it('should work with SemanticSearchResult interface', async () => {
                // Verify compatibility with existing search result structure
                const semanticResult: SemanticSearchResult = {
                    content: 'test content with error handling',
                    relativePath: 'test.ts',
                    startLine: 1,
                    endLine: 5,
                    language: 'typescript',
                    score: 0.8
                };

                const result = await prfEngine.expandQuery('error handling', [semanticResult]);
                
                expect(result).toBeDefined();
                expect(result.metrics.documentsProcessed).toBe(1);
            });

            it('should handle various programming languages correctly', async () => {
                const multiLanguageResults = [
                    { ...mockSemanticResults[0], language: 'typescript' },
                    { ...mockSemanticResults[1], language: 'javascript' },
                    { ...mockSemanticResults[4], language: 'python' },
                ];

                const result = await prfEngine.expandQuery('error handling', multiLanguageResults);
                
                expect(result.metrics.documentsProcessed).toBe(3);
                // Should extract terms regardless of language
                expect(result.expansionTerms.length).toBeGreaterThan(0);
            });
        });

        describe('query expansion quality', () => {
            it('should produce semantically relevant expansion terms', async () => {
                const result = await prfEngine.expandQuery('error handling', mockSemanticResults);
                
                // Terms should be related to error handling domain
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const relevantTerms = ['try', 'catch', 'throw', 'exception', 'error', 'failed', 'validation'];
                const hasRelevantTerms = relevantTerms.some(term => expansionTermsStr.includes(term));
                
                expect(hasRelevantTerms).toBe(true);
                expect(result.reasoning).toMatch(/relevant|semantic|domain/i);
            });

            it('should improve query specificity without losing focus', async () => {
                const result = await prfEngine.expandQuery('database', mockSemanticResults);
                
                const originalTerms = result.originalQuery.split(' ').length;
                const expandedTerms = result.expandedQuery.split(' ').length;
                
                // Should be more specific but not overwhelmingly long
                expect(expandedTerms).toBeGreaterThan(originalTerms);
                expect(expandedTerms).toBeLessThan(originalTerms * 5); // Reasonable expansion factor
            });

            it('should maintain query coherence', async () => {
                const result = await prfEngine.expandQuery('typescript interface', mockSemanticResults);
                
                // Expanded query should still be coherent and focused
                expect(result.expandedQuery).toContain('typescript');
                expect(result.expandedQuery).toContain('interface');
                
                // Should not add completely unrelated terms
                const expansionTermsStr = result.expansionTerms.join(' ').toLowerCase();
                const unrelatedTerms = ['cooking', 'sports', 'weather', 'music'];
                const hasUnrelatedTerms = unrelatedTerms.some(term => expansionTermsStr.includes(term));
                
                expect(hasUnrelatedTerms).toBe(false);
            });
        });
    });

    describe('configuration options', () => {
        it('should respect custom topK limit', async () => {
            const customEngine = new PRFEngine({ topK: 5 });
            const result = await customEngine.expandQuery('error handling', mockSemanticResults);
            
            expect(result.metrics.documentsProcessed).toBeLessThanOrEqual(5);
        });

        it('should respect custom maxExpansionTerms limit', async () => {
            const customEngine = new PRFEngine({ maxExpansionTerms: 3 });
            const result = await customEngine.expandQuery('error handling', mockSemanticResults);
            
            expect(result.expansionTerms.length).toBeLessThanOrEqual(3);
            expect(result.metrics.expansionTermsSelected).toBeLessThanOrEqual(3);
        });

        it('should respect custom originalQueryWeight', async () => {
            const highWeightEngine = new PRFEngine({ originalQueryWeight: 0.9 });
            const result = await highWeightEngine.expandQuery('error handling', mockSemanticResults);
            
            // With high original weight, original terms should dominate
            const expandedTerms = result.expandedQuery.split(' ');
            const originalTermCount = expandedTerms.filter(term => 
                ['error', 'handling'].includes(term.toLowerCase())
            ).length;
            
            expect(originalTermCount).toBeGreaterThan(0);
            expect(result.reasoning).toMatch(/weight.*0\.9/);
        });

        it('should respect custom minTermLength', async () => {
            const customEngine = new PRFEngine({ minTermLength: 5 });
            const result = await customEngine.expandQuery('error handling', mockSemanticResults);
            
            // All expansion terms should be at least 5 characters
            result.expansionTerms.forEach(term => {
                expect(term.length).toBeGreaterThanOrEqual(5);
            });
        });
    });
});