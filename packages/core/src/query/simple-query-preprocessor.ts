import {
    PreprocessingResult,
    QueryPreprocessorConfig,
    AbbreviationMap,
    ConceptMap,
    LanguagePatternMap,
} from './types';

/**
 * Lightweight query preprocessor with high-impact code and conceptual transformations.
 *
 * This class provides essential query preprocessing capabilities optimized for code search,
 * including abbreviation expansion, conceptual mapping, case splitting, and language detection.
 *
 * Features:
 * - Programming abbreviation expansion (js -> javascript, py -> python)
 * - Conceptual mapping (natural language to technical terms)
 * - Case splitting (camelCase -> camel Case, snake_case -> snake case)
 * - Filename and language detection
 * - Implementation-focused query variants
 */
export class SimpleQueryPreprocessor {
    private readonly coreAbbreviations: AbbreviationMap;
    private readonly conceptMap: ConceptMap;
    private readonly languagePatterns: LanguagePatternMap;
    private readonly filenamePatterns: RegExp[];
    private readonly camelCasePattern: RegExp;
    private readonly config: Required<QueryPreprocessorConfig>;

    constructor(config: QueryPreprocessorConfig = {}) {
        // Apply default configuration
        this.config = {
            enableAbbreviationExpansion: true,
            enableConceptualMapping: true,
            enableCaseSplitting: true,
            enableFilenameDetection: true,
            enableLanguageDetection: true,
            enableImplementationFocus: true,
            maxVariants: 20,
            ...config,
        };

        // Core programming abbreviations
        this.coreAbbreviations = {
            js: 'javascript',
            ts: 'typescript',
            py: 'python',
            fn: 'function',
            var: 'variable',
            api: 'API',
            db: 'database',
            auth: 'authentication',
            async: 'asynchronous',
            config: 'configuration',
            util: 'utility',
            req: 'request',
            res: 'response',
            err: 'error',
            ctx: 'context',
        };

        // Conceptual mappings from natural language to technical terms
        this.conceptMap = {
            'error handling': ['try except finally', 'raise Exception', 'error log', 'catch error'],
            'database connection': [
                'db.connect',
                'create_engine',
                'connection pool',
                'sessionmaker',
                'db.session',
                'db.engine',
                'db.query',
                'db.execute',
                'db.commit',
                'db.rollback',
                'db.close',
            ],
            configuration: ['load_config', 'settings.toml', 'os.environ.get', 'app.config'],
            authentication: ['auth token', 'jwt', 'oauth', 'login_required', 'password'],
            'async processing': ['async def', 'await', 'asyncio', 'celery task', 'message queue'],
            'file system': ['os.path.join', 'os.path.exists', 'os.makedirs', 'os.listdir'],
            logging: ['logging.info', 'logging.error', 'logging.warning', 'logging.debug'],
            'data processing': ['pandas', 'numpy', 'scipy', 'scikit-learn', 'scikit-image'],
            'web development': ['flask', 'django', 'fastapi', 'react', 'vue', 'angular'],
            'machine learning': ['tensorflow', 'pytorch', 'scikit-learn', 'keras', 'torchvision'],
            'data visualization': ['matplotlib', 'seaborn', 'plotly', 'bokeh', 'altair'],
            'data analysis': ['pandas', 'numpy', 'scipy', 'scikit-learn', 'scikit-image'],
            testing: ['pytest', 'unittest', 'mock', 'coverage', 'test_case'],
            security: ['encryption', 'hashing', 'authentication', 'authorization', 'access control'],
            'performance optimization': ['profiling', 'caching', 'batch processing', 'parallel processing'],
            'database optimization': ['indexing', 'query optimization', 'database schema design', 'database tuning'],
        };

        // Programming language detection patterns (using word boundaries for better matching)
        this.languagePatterns = {
            python: ['python', '\\bpy\\b', '\\.py\\b', '\\bdef\\s+', '\\bimport\\s+', '\\bfrom\\s+', '\\bclass\\s+', '__init__'],
            javascript: ['javascript', '\\bjs\\b', '\\.js\\b', '\\bfunction\\b', '\\bconst\\s+', '\\blet\\s+', '\\bvar\\s+', '=>'],
            typescript: ['typescript', '\\bts\\b', '\\.ts\\b', '\\binterface\\b', '\\btype\\s+', '\\benum\\b', '\\bnamespace\\b'],
            java: ['\\bjava\\b', '\\.java\\b', 'public class', '\\bprivate\\s+', '\\bpublic\\s+', '\\bstatic\\s+'],
            cpp: ['c\\+\\+', '\\bcpp\\b', '\\.cpp\\b', '\\.h\\b', '#include', 'std::', '\\bclass\\s+', '\\bnamespace\\b'],
            go: ['golang', '\\bgo\\b', '\\.go\\b', '\\bfunc\\s+', '\\bpackage\\s+', '\\bimport\\s+', '\\bstruct\\b'],
            rust: ['\\brust\\b', '\\brs\\b', '\\.rs\\b', '\\bfn\\s+', '\\bpub\\s+', '\\bstruct\\b', '\\bimpl\\b', '\\buse\\s+'],
            php: ['\\bphp\\b', '\\.php\\b', '<\\?php', '\\bfunction\\b', '\\bclass\\b', '\\$\\w+'],
            ruby: ['\\bruby\\b', '\\brb\\b', '\\.rb\\b', '\\bdef\\s+', '\\bclass\\s+', '\\bmodule\\b', '\\brequire\\b'],
            swift: ['\\bswift\\b', '\\.swift\\b', '\\bfunc\\s+', '\\bclass\\s+', '\\bstruct\\b', '\\bvar\\s+', '\\blet\\s+'],
            kotlin: ['\\bkotlin\\b', '\\bkt\\b', '\\.kt\\b', '\\bfun\\s+', '\\bclass\\s+', '\\bval\\s+', '\\bvar\\s+'],
            scala: ['\\bscala\\b', '\\.scala\\b', '\\bdef\\s+', '\\bclass\\s+', '\\bobject\\b', '\\btrait\\b'],
            csharp: ['c#', 'csharp', '\\.cs\\b', 'public class', '\\bprivate\\s+', '\\bpublic\\s+', '\\busing\\s+'],
        };

        // Filename detection patterns
        this.filenamePatterns = [
            // Full path with directories (e.g., src/components/Button.tsx)
            /([\w-]+(?:\/[\w.-]+)+\.(py|js|ts|tsx|jsx|java|cpp|c|h|cs|rb|go|php|swift|kt|rs|scala|sh|bash|yaml|yml|json|md|txt))\b/g,
            // Single directory/filename.ext pattern (e.g., src/main.py)
            /\b([\w-]+\/[\w.-]+\.(py|js|ts|tsx|jsx|java|cpp|c|h|cs|rb|go|php|swift|kt|rs|scala|sh|bash|yaml|yml|json|md|txt))\b/g,
            // Standard filename.ext pattern (e.g., main.py)
            /\b([\w.-]+\.(py|js|ts|tsx|jsx|java|cpp|c|h|cs|rb|go|php|swift|kt|rs|scala|sh|bash|yaml|yml|json|md|txt))\b/g,
        ];

        // Pattern for detecting camelCase
        this.camelCasePattern = /([a-z])([A-Z])/g;
    }

    /**
     * Preprocess query with essential high-impact transformations
     *
     * @param query - Original search query
     * @returns Array of deduplicated query variants
     */
    public preprocessQuery(query: string): string[] {
        if (!query || !query.trim()) {
            return [query];
        }

        const trimmedQuery = query.trim();
        const variants = new Set<string>([trimmedQuery]);
        const queryLower = trimmedQuery.toLowerCase();

        // 1. Abbreviation expansion
        if (this.config.enableAbbreviationExpansion) {
            this.expandAbbreviations(trimmedQuery, queryLower, variants);
        }

        // 2. Conceptual expansion
        if (this.config.enableConceptualMapping) {
            this.expandConcepts(trimmedQuery, queryLower, variants);
        }

        // 3. Case splitting (camelCase and snake_case)
        if (this.config.enableCaseSplitting) {
            this.splitCases(trimmedQuery, variants);
        }

        // 4. Language detection and enhancement
        if (this.config.enableLanguageDetection) {
            this.enhanceWithLanguages(trimmedQuery, variants);
        }

        // 5. Filename detection and enhancement
        if (this.config.enableFilenameDetection) {
            this.enhanceWithFilenames(trimmedQuery, variants);
        }

        // 6. Implementation-focused variants
        if (this.config.enableImplementationFocus) {
            this.addImplementationFocus(trimmedQuery, variants);
        }

        // Limit variants to configured maximum
        const variantArray = Array.from(variants);
        return variantArray.slice(0, this.config.maxVariants);
    }

    /**
     * Create a full preprocessing result with metadata
     *
     * @param query - Original search query
     * @returns Complete preprocessing result with confidence and reasoning
     */
    public preprocessQueryWithMetadata(query: string): PreprocessingResult {
        if (!query || !query.trim()) {
            return {
                originalQuery: query,
                normalizedQuery: query,
                expandedTerms: [query],
                detectedPatterns: [],
                reasoning: 'Empty query requires no preprocessing',
            };
        }

        const trimmedQuery = query.trim();
        const expandedTerms = this.preprocessQuery(query);

        // Detect patterns
        const detectedPatterns: string[] = [];
        const detectedFilenames = this.detectFilenames(query);
        const detectedLanguages = this.detectLanguages(query);

        if (detectedFilenames.length > 0) {
            detectedPatterns.push(...detectedFilenames.map(f => `filename:${f}`));
        }
        if (detectedLanguages.length > 0) {
            detectedPatterns.push(...detectedLanguages.map(l => `language:${l}`));
        }

        // Generate reasoning
        const reasoning = this.generateReasoning(query, expandedTerms, detectedPatterns);

        return {
            originalQuery: query,
            normalizedQuery: trimmedQuery,
            expandedTerms,
            detectedPatterns,
            reasoning,
        };
    }

    /**
     * Detect filenames in the query
     */
    public detectFilenames(query: string): string[] {
        const detectedFilenames: string[] = [];

        for (const pattern of this.filenamePatterns) {
            pattern.lastIndex = 0; // Reset regex state
            const matches = Array.from(query.matchAll(pattern));
            detectedFilenames.push(...matches.map(match => match[1]));
        }

        return Array.from(new Set(detectedFilenames));
    }

    /**
     * Detect programming languages mentioned in the query
     */
    public detectLanguages(query: string): string[] {
        const detectedLanguages: string[] = [];

        for (const [language, patterns] of Object.entries(this.languagePatterns)) {
            const hasMatch = patterns.some(pattern => {
                try {
                    // Create regex with case insensitive flag
                    const regex = new RegExp(pattern, 'i');
                    return regex.test(query);
                } catch {
                    // Fallback to simple includes for non-regex patterns
                    return query.toLowerCase().includes(pattern.toLowerCase());
                }
            });

            if (hasMatch) {
                detectedLanguages.push(language);
            }
        }

        return Array.from(new Set(detectedLanguages));
    }

    private expandAbbreviations(query: string, queryLower: string, variants: Set<string>): void {
        for (const [abbrev, fullForm] of Object.entries(this.coreAbbreviations)) {
            if (queryLower.includes(abbrev)) {
                // Use word boundary replacement to avoid partial matches
                const expandedQuery = query.replace(
                    new RegExp(`\\b${this.escapeRegex(abbrev)}\\b`, 'gi'),
                    fullForm
                );
                if (expandedQuery !== query) {
                    variants.add(expandedQuery);
                }
            }
        }
    }

    private expandConcepts(query: string, queryLower: string, variants: Set<string>): void {
        for (const [concept, technicalTerms] of Object.entries(this.conceptMap)) {
            if (queryLower.includes(concept)) {
                // Add technical terms as separate variants
                technicalTerms.forEach(term => variants.add(term));
                // Also add the concept itself
                variants.add(concept);
            }
        }
    }

    private splitCases(query: string, variants: Set<string>): void {
        const terms = query.split(/\s+/);

        for (const term of terms) {
            // Handle camelCase
            if (this.camelCasePattern.test(term)) {
                const spacedTerm = term.replace(this.camelCasePattern, '$1 $2');
                const newQuery = query.replace(term, spacedTerm);
                variants.add(newQuery);
            }

            // Handle snake_case
            if (term.includes('_') && !term.startsWith('_')) {
                const spacedTerm = term.split('_').join(' ');
                const newQuery = query.replace(term, spacedTerm);
                variants.add(newQuery);
            }
        }
    }

    private enhanceWithLanguages(query: string, variants: Set<string>): void {
        const detectedLanguages = this.detectLanguages(query);

        for (const language of detectedLanguages) {
            variants.add(`${query} ${language}`);
        }
    }

    private enhanceWithFilenames(query: string, variants: Set<string>): void {
        const detectedFiles = this.detectFilenames(query);

        for (const filename of detectedFiles) {
            // Add variants focused on the filename without extension for broader matching
            if (filename.includes('.')) {
                const baseName = filename.substring(0, filename.lastIndexOf('.'));
                variants.add(`${query} ${baseName}`);
            }
        }
    }

    private addImplementationFocus(query: string, variants: Set<string>): void {
        const queryLower = query.toLowerCase();

        // If query seems like it's looking for implementation, add boosting terms
        const implementationIndicators = ['how to', 'implement', 'create', 'build', 'write'];
        if (implementationIndicators.some(indicator => queryLower.includes(indicator))) {
            variants.add(`${query} function class method implementation`);
        }

        // If query contains specific code patterns, emphasize them
        const codePatternRegex = /\b(async|def|class|function)\s+\w+/;
        if (codePatternRegex.test(query)) {
            variants.add(`${query} implementation definition`);
        }
    }

    private hasAbbreviations(query: string): boolean {
        const queryLower = query.toLowerCase();
        return Object.keys(this.coreAbbreviations).some(abbrev =>
            queryLower.includes(abbrev)
        );
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private generateReasoning(
        query: string,
        expandedTerms: string[],
        detectedPatterns: string[]
    ): string {
        const reasons: string[] = [];

        if (expandedTerms.length > 1) {
            reasons.push(`Generated ${expandedTerms.length - 1} query variants`);
        }

        if (detectedPatterns.length > 0) {
            reasons.push(`Detected patterns: ${detectedPatterns.join(', ')}`);
        }

        if (this.hasAbbreviations(query)) {
            reasons.push('Expanded programming abbreviations');
        }

        const concepts = Object.keys(this.conceptMap).filter(concept =>
            query.toLowerCase().includes(concept)
        );
        if (concepts.length > 0) {
            reasons.push(`Mapped concepts: ${concepts.join(', ')}`);
        }

        return reasons.length > 0
            ? reasons.join('; ')
            : 'Basic query preprocessing applied';
    }
}