import * as path from "path";

/**
 * Truncate content to specified length
 */
export function truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
        return content;
    }
    return content.substring(0, maxLength) + '...';
}

/**
 * Ensure path is absolute. If relative path is provided, resolve it properly.
 */
export function ensureAbsolutePath(inputPath: string): string {
    // If already absolute, return as is
    if (path.isAbsolute(inputPath)) {
        return inputPath;
    }

    // For relative paths, resolve to absolute path
    const resolved = path.resolve(inputPath);
    return resolved;
}

/**
 * Find the parent indexed project for a given path.
 * If the path is a subdirectory of any indexed project, return the project root.
 * Otherwise, return null.
 */
export function findParentIndexedProject(
    inputPath: string,
    indexedCodebases: string[]
): string | null {
    const absolutePath = ensureAbsolutePath(inputPath);

    // First check if this exact path is already indexed
    if (indexedCodebases.includes(absolutePath)) {
        return absolutePath;
    }

    // Check if this path is a subdirectory of any indexed project
    for (const indexedPath of indexedCodebases) {
        // Normalize paths for comparison
        const normalizedIndexedPath = path.resolve(indexedPath);
        const normalizedInputPath = path.resolve(absolutePath);

        // Check if inputPath is within indexedPath
        const relativePath = path.relative(normalizedIndexedPath, normalizedInputPath);

        // If relative path doesn't start with '..' then inputPath is within indexedPath
        if (!relativePath.startsWith('..') && relativePath !== '') {
            console.log(`[PATH-RESOLUTION] Found parent project: ${normalizedIndexedPath} for subdirectory: ${normalizedInputPath}`);
            return normalizedIndexedPath;
        }
    }

    return null;
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = ensureAbsolutePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
}