import * as fs from "fs";
import * as path from "path";
import { Context } from "@everwise/claude-context-core";
import { SnapshotManager } from "./snapshot.js";
import { ensureAbsolutePath } from "./utils.js";

export class UpdateFilesHandler {
    private context: Context;
    private snapshotManager: SnapshotManager;

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;
    }

    public async handleUpdateFiles(args: any) {
        const { codebasePath, paths } = args;

        try {
            // Force absolute path resolution for codebase
            const absoluteCodebasePath = ensureAbsolutePath(codebasePath);

            // Validate codebase path exists
            if (!fs.existsSync(absoluteCodebasePath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Codebase path '${absoluteCodebasePath}' does not exist.`
                        }
                    ],
                    isError: true
                };
            }

            // Check if it's a directory
            const stat = fs.statSync(absoluteCodebasePath);
            if (!stat.isDirectory()) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Codebase path '${absoluteCodebasePath}' is not a directory`
                        }
                    ],
                    isError: true
                };
            }

            // Check if the codebase is indexed
            const indexedCodebases = this.snapshotManager.getIndexedCodebases();
            if (!indexedCodebases.includes(absoluteCodebasePath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: Codebase '${absoluteCodebasePath}' is not indexed. Please use the index_codebase tool to index it first.`
                        }
                    ],
                    isError: true
                };
            }

            // Convert paths to array format
            const pathsArray = Array.isArray(paths) ? paths : [paths];
            const resolvedFiles: string[] = [];

            // Resolve each path and collect files
            for (const inputPath of pathsArray) {
                const absolutePath = path.isAbsolute(inputPath)
                    ? inputPath
                    : path.resolve(absoluteCodebasePath, inputPath);

                if (!fs.existsSync(absolutePath)) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error: Path '${absolutePath}' does not exist.`
                            }
                        ],
                        isError: true
                    };
                }

                const pathStat = fs.statSync(absolutePath);
                if (pathStat.isFile()) {
                    // Check if file is supported
                    const ext = path.extname(absolutePath);
                    if (this.context.getSupportedExtensions().includes(ext)) {
                        resolvedFiles.push(absolutePath);
                    }
                } else if (pathStat.isDirectory()) {
                    // Get all supported files in directory
                    const directoryFiles = await this.getCodeFilesInDirectory(
                        absolutePath,
                        absoluteCodebasePath
                    );
                    resolvedFiles.push(...directoryFiles);
                }
            }

            if (resolvedFiles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "No supported files found to update."
                        }
                    ]
                };
            }

            console.log(
                `[UPDATE-FILES] Updating ${resolvedFiles.length} files in codebase: ${absoluteCodebasePath}`
            );

            // Remove old chunks for these files by clearing and re-indexing the specific files
            // We'll use the approach of temporarily modifying files to trigger re-indexing
            const originalModTimes = new Map<string, Date>();

            // Record original modification times
            for (const filePath of resolvedFiles) {
                const stats = fs.statSync(filePath);
                originalModTimes.set(filePath, stats.mtime);
            }

            try {
                // Touch files to make them appear modified (temporarily)
                const futureTime = new Date(Date.now() + 1000); // 1 second in the future
                for (const filePath of resolvedFiles) {
                    fs.utimesSync(filePath, futureTime, futureTime);
                }

                // Use reindexByChange to process only the "modified" files
                const result = await this.context.reindexByChange(
                    absoluteCodebasePath,
                    progress => {
                        console.log(
                            `[UPDATE-FILES] ${progress.phase} (${progress.percentage}%)`
                        );
                    }
                );

                const resultText = `Successfully updated ${result.modified} modified files in codebase '${absoluteCodebasePath}'`;

                return {
                    content: [
                        {
                            type: "text",
                            text: resultText
                        }
                    ]
                };
            } finally {
                // Restore original modification times
                for (const [filePath, originalTime] of originalModTimes) {
                    try {
                        const stats = fs.statSync(filePath);
                        fs.utimesSync(filePath, stats.atime, originalTime);
                    } catch (error) {
                        console.warn(
                            `[UPDATE-FILES] Could not restore modification time for ${filePath}:`,
                            error
                        );
                    }
                }
            }
        } catch (error: any) {
            const errorMsg = `Failed to update files: ${error.message}`;
            console.error(`[UPDATE-FILES] ${errorMsg}`);
            return {
                content: [
                    {
                        type: "text",
                        text: errorMsg
                    }
                ],
                isError: true
            };
        }
    }

    private async getCodeFilesInDirectory(
        dirPath: string,
        codebasePath: string
    ): Promise<string[]> {
        const files: string[] = [];
        const ignorePatterns = this.context.getIgnorePatterns();
        const supportedExtensions = this.context.getSupportedExtensions();

        const traverseDirectory = async (currentPath: string) => {
            const entries = await fs.promises.readdir(currentPath, {
                withFileTypes: true
            });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                // Basic ignore pattern checking (simplified since matchesIgnorePattern is private)
                const relativePath = path.relative(codebasePath, fullPath);
                const normalizedPath = relativePath.replace(/\\/g, "/");

                let shouldIgnore = false;
                for (const pattern of ignorePatterns) {
                    if (this.isPatternMatch(normalizedPath, pattern)) {
                        shouldIgnore = true;
                        break;
                    }
                }

                if (shouldIgnore) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await traverseDirectory(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (supportedExtensions.includes(ext)) {
                        files.push(fullPath);
                    }
                }
            }
        };

        await traverseDirectory(dirPath);
        return files;
    }

    // Simplified pattern matching (copied from Context class logic)
    private isPatternMatch(filePath: string, pattern: string): boolean {
        // Convert glob pattern to regex
        const regexPattern = pattern
            .replace(/\./g, "\\.")
            .replace(/\*\*/g, ".*")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, "[^/]");

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(filePath);
    }
}
