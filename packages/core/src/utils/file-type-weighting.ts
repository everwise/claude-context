/**
 * Determines if a file is a test/mock file based on path and extension patterns
 * @param relativePath The relative path of the file
 * @param fileExtension The file extension (e.g., '.ts', '.py')
 * @returns Weight multiplier (0.8 for test files, 1.0 for implementation files)
 */
export function getFileTypeWeight(relativePath: string, fileExtension: string): number {
    const testPatterns = new Map([
        // Python
        ['.py', [/\/test_/, /_test\.py$/, /\/tests\//, /\/conftest\.py$/]],
        
        // JavaScript/TypeScript  
        ['.js', [/\.test\.js$/, /\.spec\.js$/, /\/__tests__\//, /\/test\//]],
        ['.ts', [/\.test\.ts$/, /\.spec\.ts$/, /\/__tests__\//, /\/test\//]],
        ['.tsx', [/\.test\.tsx$/, /\.spec\.tsx$/, /\/__tests__\//, /\/test\//]],
        
        // Java
        ['.java', [/Test\.java$/, /Tests\.java$/, /\/src\/test\//]],
        
        // Go
        ['.go', [/_test\.go$/]],
        
        // Ruby
        ['.rb', [/_spec\.rb$/, /_test\.rb$/, /\/spec\//, /\/test\//]],
        
        // C#
        ['.cs', [/Test\.cs$/, /Tests\.cs$/, /\.Tests\./]],
        
        // Rust
        ['.rs', [/_test\.rs$/, /\/tests\//]],
        
        // PHP
        ['.php', [/Test\.php$/, /\/tests\//]]
    ]);

    // Check for mock/stub patterns (language-agnostic)
    const mockPatterns = [
        /\/mock/i,
        /\/mocks/i,
        /\/stubs/i,
        /\/fixtures/i,
        /mock-utils/i
    ];

    const patterns = testPatterns.get(fileExtension) || [];
    const isTestFile = patterns.some(pattern => relativePath.match(pattern));
    const isMockFile = mockPatterns.some(pattern => relativePath.match(pattern));
    
    return (isTestFile || isMockFile) ? 0.8 : 1.0;
}