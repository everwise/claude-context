# Query Preprocessing Module

The Query Preprocessing module provides intelligent query enhancement capabilities for code search, designed to improve search relevance by expanding, normalizing, and enriching user queries before they are processed by the semantic search engine.

## Overview

The `SimpleQueryPreprocessor` transforms natural language and code-related queries into enhanced variants that are more likely to find relevant code matches. It addresses common search challenges such as:

- Programming abbreviation expansion (js → javascript)
- Natural language to technical term mapping (error handling → try catch finally)
- Code case conventions (camelCase → camel Case)
- Programming language and filename detection
- Implementation-focused query enhancement

## Features

### 🔤 **Abbreviation Expansion**
Expands common programming abbreviations to their full forms:
```typescript
"js function" → ["js function", "javascript function"]
"py script" → ["py script", "python script"]  
"db connection" → ["db connection", "database connection"]
```

### 🧠 **Conceptual Mapping**
Maps natural language concepts to technical terms:
```typescript
"error handling" → ["error handling", "try except finally", "raise Exception", "catch error"]
"authentication" → ["authentication", "auth token", "jwt", "oauth", "login_required"]
```

### 📝 **Case Splitting**
Handles different naming conventions used in code:
```typescript
"getUserData" → ["getUserData", "get User Data"]
"snake_case_var" → ["snake_case_var", "snake case var"]
```

### 🗂️ **Language & File Detection**
Identifies programming languages and filenames for enhanced filtering:
```typescript
"main.py javascript" → Detects: filename:main.py, language:python, language:javascript
```

### 🎯 **Implementation Focus**
Enhances queries that seek code implementations:
```typescript
"how to handle errors" → ["how to handle errors", "how to handle errors function class method implementation"]
```

## Usage

### Basic Usage

```typescript
import { SimpleQueryPreprocessor } from '@everwise/claude-context-core';

const preprocessor = new SimpleQueryPreprocessor();

// Simple preprocessing - get query variants
const variants = preprocessor.preprocessQuery('js authentication');
console.log(variants);
// Output: ["js authentication", "javascript authentication", "js auth token", ...]

// Full preprocessing with metadata
const result = preprocessor.preprocessQueryWithMetadata('error handling in main.py');
console.log(result);
// Output:
// {
//   originalQuery: "error handling in main.py",
//   normalizedQuery: "error handling in main.py", 
//   expandedTerms: ["error handling in main.py", "try except finally", ...],
//   detectedPatterns: ["filename:main.py", "language:python"],
//   preprocessingConfidence: 0.8,
//   reasoning: "Generated 5 query variants; Detected patterns: filename:main.py, language:python"
// }
```

### Configuration Options

```typescript
import { SimpleQueryPreprocessor, QueryPreprocessorConfig } from '@everwise/claude-context-core';

const config: QueryPreprocessorConfig = {
  enableAbbreviationExpansion: true,    // Enable js→javascript expansion
  enableConceptualMapping: true,        // Enable concept→technical terms mapping
  enableCaseSplitting: true,           // Enable camelCase→camel Case splitting
  enableFilenameDetection: true,       // Enable filename pattern detection
  enableLanguageDetection: true,       // Enable programming language detection
  enableImplementationFocus: true,     // Enable implementation-seeking enhancements
  maxVariants: 20                      // Maximum query variants to generate
};

const preprocessor = new SimpleQueryPreprocessor(config);
```

### Integration with Context

The preprocessor is automatically integrated into the `Context` class and used during semantic search:

```typescript
import { Context, MilvusVectorDatabase, OpenAIEmbedding } from '@everwise/claude-context-core';

const context = new Context({
  embedding: new OpenAIEmbedding({ apiKey: 'your-key' }),
  vectorDatabase: new MilvusVectorDatabase({ address: 'localhost:19530' }),
  queryPreprocessor: {
    enableAbbreviationExpansion: true,
    maxVariants: 15
  }
});

// Query preprocessing happens automatically during search
const results = await context.semanticSearch('/path/to/codebase', 'js error handling');
```

## API Reference

### SimpleQueryPreprocessor

#### Constructor
```typescript
constructor(config?: QueryPreprocessorConfig)
```

#### Methods

##### `preprocessQuery(query: string): string[]`
Preprocesses a query and returns an array of enhanced query variants.

**Parameters:**
- `query: string` - The original search query

**Returns:**
- `string[]` - Array of deduplicated query variants

##### `preprocessQueryWithMetadata(query: string): PreprocessingResult`
Preprocesses a query and returns detailed metadata about the processing.

**Parameters:**
- `query: string` - The original search query

**Returns:**
- `PreprocessingResult` - Complete preprocessing result with confidence and reasoning

##### `detectFilenames(query: string): string[]`
Detects potential filenames in a query.

##### `detectLanguages(query: string): string[]`  
Detects programming languages mentioned in a query.

### Types

#### `QueryPreprocessorConfig`
```typescript
interface QueryPreprocessorConfig {
  enableAbbreviationExpansion?: boolean;    // Default: true
  enableConceptualMapping?: boolean;        // Default: true  
  enableCaseSplitting?: boolean;           // Default: true
  enableFilenameDetection?: boolean;       // Default: true
  enableLanguageDetection?: boolean;       // Default: true
  enableImplementationFocus?: boolean;     // Default: true
  maxVariants?: number;                    // Default: 20
}
```

#### `PreprocessingResult`
```typescript
interface PreprocessingResult {
  originalQuery: string;              // Original input query
  normalizedQuery: string;            // Normalized query with basic cleaning
  expandedTerms: string[];           // List of expanded terms and variants
  detectedPatterns: string[];        // Detected patterns (filenames, languages, etc.)
  preprocessingConfidence: number;   // Confidence score (0-1)
  reasoning: string;                 // Human-readable reasoning
}
```

## Supported Languages

The preprocessor currently detects and handles these programming languages:
- Python, JavaScript, TypeScript, Java, C++, Go, Rust
- PHP, Ruby, Swift, Kotlin, Scala, C#

## Supported Abbreviations

Common programming abbreviations that are expanded:
- `js` → `javascript`
- `ts` → `typescript`  
- `py` → `python`
- `fn` → `function`
- `var` → `variable`
- `api` → `API`
- `db` → `database`
- `auth` → `authentication`
- `async` → `asynchronous`
- `config` → `configuration`
- `util` → `utility`
- `req` → `request`
- `res` → `response`
- `err` → `error`
- `ctx` → `context`

## Conceptual Mappings

Natural language concepts mapped to technical terms:
- **Error Handling** → try except finally, raise Exception, error log, catch error
- **Database Connection** → db.connect, create_engine, connection pool, sessionmaker
- **Authentication** → auth token, jwt, oauth, login_required, password
- **Async Processing** → async def, await, asyncio, celery task, message queue
- **File System** → os.path.join, os.path.exists, os.makedirs, os.listdir
- **Testing** → pytest, unittest, mock, coverage, test_case
- **Security** → encryption, hashing, authentication, authorization, access control

## Performance

The preprocessor is designed for high performance:
- **Processing Speed**: ~100 queries processed in <1000ms
- **Memory Efficient**: Uses Set-based deduplication for O(1) duplicate removal
- **Configurable Limits**: `maxVariants` prevents runaway processing
- **Pre-compiled Patterns**: All regex patterns compiled once at initialization

## Testing

Run the comprehensive test suite:

```bash
npx jest src/query/__tests__/simple-query-preprocessor.test.ts
```

The test suite includes:
- 54 comprehensive tests covering all functionality
- Edge case handling (null, undefined, unicode, special characters)
- Performance benchmarks
- Configuration option validation
- Pattern detection accuracy tests

## Examples

### Code Search Scenarios

```typescript
const preprocessor = new SimpleQueryPreprocessor();

// Scenario 1: Finding JavaScript functions
const variants1 = preprocessor.preprocessQuery('js user validation');
// Result: Enhanced with "javascript user validation", language detection

// Scenario 2: Error handling patterns  
const result2 = preprocessor.preprocessQueryWithMetadata('error handling');
// Result: Maps to try/catch patterns, implementation-focused variants

// Scenario 3: File-specific searches
const variants3 = preprocessor.preprocessQuery('authentication in auth.py');
// Result: Detects filename, adds technical auth terms, Python language hints

// Scenario 4: Implementation queries
const variants4 = preprocessor.preprocessQuery('how to implement caching');
// Result: Adds implementation-focused terms like "function class method"
```

## Integration Notes

When integrated into the claude-context system, the preprocessor:
1. **Automatically activates** during `semanticSearch()` calls
2. **Logs preprocessing results** for visibility and debugging
3. **Uses normalized queries** for embedding generation and sparse search
4. **Maintains original query context** for result relevance

The preprocessing adds minimal latency (~1-5ms per query) while significantly improving search relevance for code-related queries.