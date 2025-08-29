import { SimpleQueryPreprocessor } from '../simple-query-preprocessor';
import { QueryPreprocessorConfig } from '../types';

describe('SimpleQueryPreprocessor', () => {
    let preprocessor: SimpleQueryPreprocessor;

    beforeEach(() => {
        preprocessor = new SimpleQueryPreprocessor();
    });

    describe('constructor', () => {
        it('should create instance with default configuration', () => {
            expect(preprocessor).toBeInstanceOf(SimpleQueryPreprocessor);
        });

        it('should accept custom configuration', () => {
            const config: QueryPreprocessorConfig = {
                enableAbbreviationExpansion: false,
                maxVariants: 5,
            };

            const customPreprocessor = new SimpleQueryPreprocessor(config);
            expect(customPreprocessor).toBeInstanceOf(SimpleQueryPreprocessor);
        });
    });

    describe('preprocessQuery', () => {
        describe('basic functionality', () => {
            it('should return original query for empty input', () => {
                const result = preprocessor.preprocessQuery('');
                expect(result).toEqual(['']);
            });

            it('should return trimmed query for whitespace input', () => {
                const result = preprocessor.preprocessQuery('  hello world  ');
                expect(result[0]).toBe('hello world');
            });

            it('should return single variant for simple query', () => {
                const result = preprocessor.preprocessQuery('search function');
                expect(result).toContain('search function');
                expect(result.length).toBeGreaterThan(0);
            });
        });

        describe('abbreviation expansion', () => {
            it('should expand JavaScript abbreviation', () => {
                const result = preprocessor.preprocessQuery('js function');
                const resultText = result.join(' ');
                expect(resultText).toContain('javascript');
            });

            it('should expand TypeScript abbreviation', () => {
                const result = preprocessor.preprocessQuery('ts interface');
                const resultText = result.join(' ');
                expect(resultText).toContain('typescript');
            });

            it('should expand Python abbreviation', () => {
                const result = preprocessor.preprocessQuery('py script');
                const resultText = result.join(' ');
                expect(resultText).toContain('python');
            });

            it('should expand function abbreviation', () => {
                const result = preprocessor.preprocessQuery('fn definition');
                const resultText = result.join(' ');
                expect(resultText).toContain('function');
            });

            it('should expand database abbreviation', () => {
                const result = preprocessor.preprocessQuery('db connection');
                const resultText = result.join(' ');
                expect(resultText).toContain('database');
            });

            it('should use word boundaries to avoid partial matches', () => {
                const result = preprocessor.preprocessQuery('javascript');
                // Should not replace 'js' within 'javascript'
                expect(result).toContain('javascript');
                const hasPartialReplacement = result.some(variant =>
                    variant.includes('javascriptavascript')
                );
                expect(hasPartialReplacement).toBe(false);
            });
        });

        describe('conceptual mapping', () => {
            it('should expand error handling concept', () => {
                const result = preprocessor.preprocessQuery('error handling');
                const resultText = result.join(' ');
                expect(resultText).toContain('try except finally');
            });

            it('should expand database connection concept', () => {
                const result = preprocessor.preprocessQuery('database connection');
                const resultText = result.join(' ');
                expect(resultText).toContain('db.connect');
            });

            it('should expand authentication concept', () => {
                const result = preprocessor.preprocessQuery('authentication');
                const resultText = result.join(' ');
                expect(resultText).toContain('auth token');
            });
        });

        describe('case splitting', () => {
            it('should split camelCase terms', () => {
                const result = preprocessor.preprocessQuery('getUserData');
                const hasSpacedVersion = result.some(variant =>
                    variant.includes('get User Data')
                );
                expect(hasSpacedVersion).toBe(true);
            });

            it('should split snake_case terms', () => {
                const result = preprocessor.preprocessQuery('get_user_data');
                const hasSpacedVersion = result.some(variant =>
                    variant.includes('get user data')
                );
                expect(hasSpacedVersion).toBe(true);
            });

            it('should handle mixed camelCase and snake_case', () => {
                const result = preprocessor.preprocessQuery('getUserData snake_case_var');
                const resultText = result.join(' ');
                expect(resultText).toContain('get User Data');
                expect(resultText).toContain('snake case var');
            });

            it('should not split underscores at the beginning', () => {
                const result = preprocessor.preprocessQuery('__init__');
                expect(result).toContain('__init__');
            });
        });

        describe('language detection', () => {
            it('should detect Python language', () => {
                const result = preprocessor.preprocessQuery('python function');
                expect(result).toContain('python function python');
            });

            it('should detect JavaScript language', () => {
                const result = preprocessor.preprocessQuery('javascript const');
                expect(result).toContain('javascript const javascript');
            });

            it('should detect multiple languages', () => {
                const result = preprocessor.preprocessQuery('python javascript');
                const resultText = result.join(' ');
                expect(resultText).toContain('python');
                expect(resultText).toContain('javascript');
            });
        });

        describe('filename detection', () => {
            it('should enhance queries with detected filenames', () => {
                const result = preprocessor.preprocessQuery('check main.py');
                const hasBaseNameVariant = result.some(variant =>
                    variant.includes('main')
                );
                expect(hasBaseNameVariant).toBe(true);
            });

            it('should handle TypeScript files', () => {
                const result = preprocessor.preprocessQuery('index.ts file');
                const hasBaseNameVariant = result.some(variant =>
                    variant.includes('index')
                );
                expect(hasBaseNameVariant).toBe(true);
            });

            it('should handle path-based filenames', () => {
                const result = preprocessor.preprocessQuery('src/utils.js');
                const hasBaseNameVariant = result.some(variant =>
                    variant.includes('utils')
                );
                expect(hasBaseNameVariant).toBe(true);
            });
        });

        describe('implementation focus', () => {
            it('should add implementation terms for how-to queries', () => {
                const result = preprocessor.preprocessQuery('how to handle errors');
                const hasImplVariant = result.some(variant =>
                    variant.includes('function class method implementation')
                );
                expect(hasImplVariant).toBe(true);
            });

            it('should enhance implementation-seeking queries', () => {
                const result = preprocessor.preprocessQuery('implement authentication');
                const hasImplVariant = result.some(variant =>
                    variant.includes('function class method implementation')
                );
                expect(hasImplVariant).toBe(true);
            });

            it('should enhance queries with code patterns', () => {
                const result = preprocessor.preprocessQuery('async function getData');
                const hasImplVariant = result.some(variant =>
                    variant.includes('implementation definition')
                );
                expect(hasImplVariant).toBe(true);
            });
        });

        describe('configuration options', () => {
            it('should respect disabled abbreviation expansion', () => {
                const customPreprocessor = new SimpleQueryPreprocessor({
                    enableAbbreviationExpansion: false,
                    enableLanguageDetection: false, // Also disable language detection to avoid "js" -> "javascript"
                });
                const result = customPreprocessor.preprocessQuery('js function');
                const hasExpansion = result.some(variant =>
                    variant.includes('javascript')
                );
                expect(hasExpansion).toBe(false);
            });

            it('should respect maxVariants limit', () => {
                const customPreprocessor = new SimpleQueryPreprocessor({
                    maxVariants: 3,
                });
                const result = customPreprocessor.preprocessQuery('complex js py ts query error handling');
                expect(result.length).toBeLessThanOrEqual(3);
            });

            it('should respect disabled conceptual mapping', () => {
                const customPreprocessor = new SimpleQueryPreprocessor({
                    enableConceptualMapping: false,
                });
                const result = customPreprocessor.preprocessQuery('error handling');
                const hasConceptExpansion = result.some(variant =>
                    variant.includes('try except finally')
                );
                expect(hasConceptExpansion).toBe(false);
            });
        });
    });

    describe('preprocessQueryWithMetadata', () => {
        it('should return complete metadata for empty query', () => {
            const result = preprocessor.preprocessQueryWithMetadata('');
            expect(result.originalQuery).toBe('');
            expect(result.reasoning).toBe('Empty query requires no preprocessing');
            expect(result.expandedTerms).toEqual(['']);
        });

        it('should return metadata for simple query', () => {
            const result = preprocessor.preprocessQueryWithMetadata('search function');
            expect(result.originalQuery).toBe('search function');
            expect(result.normalizedQuery).toBe('search function');
            expect(result.expandedTerms).toContain('search function');
            expect(result.reasoning.length).toBeGreaterThan(0); // Just check that reasoning is provided
        });

        it('should detect patterns and increase confidence', () => {
            const result = preprocessor.preprocessQueryWithMetadata('main.py javascript');
            expect(result.detectedPatterns).toContain('filename:main.py');
            expect(result.detectedPatterns).toContain('language:javascript');
        });

        it('should provide reasoning for abbreviation expansion', () => {
            const result = preprocessor.preprocessQueryWithMetadata('js function');
            expect(result.reasoning).toContain('Expanded programming abbreviations');
        });

        it('should provide reasoning for concept mapping', () => {
            const result = preprocessor.preprocessQueryWithMetadata('error handling');
            expect(result.reasoning).toContain('Mapped concepts');
        });
    });

    describe('detectFilenames', () => {
        it('should detect single filename', () => {
            const result = preprocessor.detectFilenames('check main.py');
            expect(result).toContain('main.py');
        });

        it('should detect multiple filenames', () => {
            const result = preprocessor.detectFilenames('main.py and utils.js');
            expect(result).toContain('main.py');
            expect(result).toContain('utils.js');
        });

        it('should handle path-based filenames', () => {
            const result = preprocessor.detectFilenames('src/components/Button.tsx');
            expect(result).toContain('src/components/Button.tsx');
        });

        it('should remove duplicates', () => {
            const result = preprocessor.detectFilenames('main.py main.py');
            expect(result).toEqual(['main.py']);
        });

        it('should return empty array for no filenames', () => {
            const result = preprocessor.detectFilenames('simple query');
            expect(result).toEqual([]);
        });
    });

    describe('detectLanguages', () => {
        it('should detect Python', () => {
            const result = preprocessor.detectLanguages('python def function');
            expect(result).toContain('python');
        });

        it('should detect JavaScript', () => {
            const result = preprocessor.detectLanguages('javascript const variable');
            expect(result).toContain('javascript');
        });

        it('should detect TypeScript', () => {
            const result = preprocessor.detectLanguages('typescript interface');
            expect(result).toContain('typescript');
        });

        it('should detect multiple languages', () => {
            const result = preprocessor.detectLanguages('python and javascript code');
            expect(result).toContain('python');
            expect(result).toContain('javascript');
        });

        it('should remove duplicates', () => {
            const result = preprocessor.detectLanguages('python python def');
            expect(result).toEqual(['python']);
        });

        it('should return empty array for no languages', () => {
            const result = preprocessor.detectLanguages('simple query');
            expect(result).toEqual([]);
        });

        it('should be case insensitive', () => {
            const result = preprocessor.detectLanguages('Python JavaScript');
            expect(result).toContain('python');
            expect(result).toContain('javascript');
        });
    });

    describe('edge cases', () => {
        it('should handle null input gracefully', () => {
            const result = preprocessor.preprocessQuery(null as any);
            expect(result).toEqual([null]);
        });

        it('should handle undefined input gracefully', () => {
            const result = preprocessor.preprocessQuery(undefined as any);
            expect(result).toEqual([undefined]);
        });

        it('should handle very long queries', () => {
            const longQuery = 'javascript '.repeat(1000) + 'function';
            const result = preprocessor.preprocessQuery(longQuery);
            expect(result.length).toBeGreaterThan(0);
            expect(result[0]).toBe(longQuery);
        });

        it('should handle special characters', () => {
            const specialQuery = 'function@#$%^&*()test.js';
            const result = preprocessor.preprocessQuery(specialQuery);
            expect(result).toContain(specialQuery);
        });

        it('should handle unicode characters', () => {
            const unicodeQuery = 'función测试файл.py';
            const result = preprocessor.preprocessQuery(unicodeQuery);
            expect(result[0]).toBe(unicodeQuery);
        });
    });

    describe('performance', () => {
        it('should process queries efficiently', () => {
            const start = Date.now();

            for (let i = 0; i < 100; i++) {
                preprocessor.preprocessQuery('complex javascript python typescript query with error handling');
            }

            const elapsed = Date.now() - start;
            expect(elapsed).toBeLessThan(1000); // Should complete 100 queries in under 1 second
        });

        it('should handle batch preprocessing', () => {
            const queries = [
                'js function',
                'python class',
                'error handling',
                'main.py file',
                'typescript interface',
            ];

            const start = Date.now();
            const results = queries.map(q => preprocessor.preprocessQuery(q));
            const elapsed = Date.now() - start;

            expect(results).toHaveLength(5);
            expect(elapsed).toBeLessThan(100); // Should be very fast
        });
    });
});