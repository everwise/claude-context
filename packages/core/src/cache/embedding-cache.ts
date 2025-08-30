import Database, { type Database as DatabaseType } from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

export interface CachedEmbedding {
    contentHash: string;
    embedding: number[];
    dimension: number;
    createdAt: number;
}

export interface EmbeddingCacheStats {
    totalEntries: number;
    cacheSize: number; // Size in bytes
    oldestEntry: number; // Timestamp
    newestEntry: number; // Timestamp
}

/**
 * Content-addressable embedding cache using SQLite for safe concurrent access
 */
export class EmbeddingCache {
    private db: DatabaseType | null = null;
    private cachePath: string;
    private initialized = false;

    constructor() {
        this.cachePath = this.getCachePath();
    }

    /**
     * Get the cache database path following existing pattern
     */
    private getCachePath(): string {
        const homeDir = os.homedir();
        const cacheDir = path.join(homeDir, '.context', 'embeddings');
        return path.join(cacheDir, 'cache.db');
    }

    /**
     * Initialize the cache database
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            // Ensure cache directory exists
            const cacheDir = path.dirname(this.cachePath);
            await fs.ensureDir(cacheDir);

            // Initialize SQLite database
            this.db = new Database(this.cachePath);

            if (!this.db) {
                throw new Error('Failed to create SQLite database');
            }

            // Enable WAL mode for better concurrent access
            this.db.pragma('journal_mode = WAL');

            // Enable foreign keys
            this.db.pragma('foreign_keys = ON');

            // Create embeddings table if it doesn't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS embeddings (
                    content_hash TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    dimension INTEGER NOT NULL,
                    created_at INTEGER NOT NULL
                );
            `);

            // Create index for cleanup queries
            this.db.exec(`
                CREATE INDEX IF NOT EXISTS idx_created_at ON embeddings(created_at);
            `);

            this.initialized = true;
            console.log(`[EmbeddingCache] Initialized cache at ${this.cachePath}`);
        } catch (error) {
            console.error('[EmbeddingCache] Failed to initialize:', error);
            // Don't throw - system should work without cache
            this.db = null;
        }
    }

    /**
     * Generate content hash (matches file synchronizer pattern)
     */
    public static getContentHash(content: string): string {
        return crypto.createHash('sha256').update(content.trim(), 'utf-8').digest('hex');
    }

    /**
     * Get cached embedding for content hash
     */
    public get(contentHash: string): number[] | null {
        if (!this.db || !this.initialized) return null;

        try {
            const stmt = this.db.prepare('SELECT embedding, dimension FROM embeddings WHERE content_hash = ?');
            const row = stmt.get(contentHash) as { embedding: Buffer; dimension: number } | undefined;

            if (!row) return null;

            // Convert buffer back to number array
            const float32Array = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
            return Array.from(float32Array);
        } catch (error) {
            console.error('[EmbeddingCache] Error retrieving embedding:', error);
            return null;
        }
    }

    /**
     * Store embedding in cache
     */
    public set(contentHash: string, embedding: number[]): void {
        if (!this.db || !this.initialized) return;

        try {
            // Convert to binary format for efficient storage
            const float32Array = new Float32Array(embedding);
            const buffer = Buffer.from(float32Array.buffer);

            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO embeddings (content_hash, embedding, dimension, created_at)
                VALUES (?, ?, ?, ?)
            `);

            stmt.run(contentHash, buffer, embedding.length, Date.now());
        } catch (error) {
            console.error('[EmbeddingCache] Error storing embedding:', error);
            // Don't throw - cache failures shouldn't break indexing
        }
    }

    /**
     * Get multiple embeddings at once
     */
    public getMany(contentHashes: string[]): Map<string, number[]> {
        const result = new Map<string, number[]>();

        if (!this.db || !this.initialized || contentHashes.length === 0) {
            return result;
        }

        try {
            const placeholders = contentHashes.map(() => '?').join(',');
            const stmt = this.db.prepare(`
                SELECT content_hash, embedding, dimension
                FROM embeddings
                WHERE content_hash IN (${placeholders})
            `);

            const rows = stmt.all(...contentHashes) as Array<{
                content_hash: string;
                embedding: Buffer;
                dimension: number;
            }>;

            for (const row of rows) {
                const float32Array = new Float32Array(
                    row.embedding.buffer,
                    row.embedding.byteOffset,
                    row.embedding.byteLength / 4
                );
                result.set(row.content_hash, Array.from(float32Array));
            }
        } catch (error) {
            console.error('[EmbeddingCache] Error retrieving multiple embeddings:', error);
        }

        return result;
    }

    /**
     * Store multiple embeddings at once
     */
    public setMany(embeddings: Map<string, number[]>): void {
        if (!this.db || !this.initialized || embeddings.size === 0) return;

        try {
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO embeddings (content_hash, embedding, dimension, created_at)
                VALUES (?, ?, ?, ?)
            `);

            const now = Date.now();
            const transaction = this.db.transaction(() => {
                const embeddingEntries = Array.from(embeddings.entries());
                for (const [contentHash, embedding] of embeddingEntries) {
                    const float32Array = new Float32Array(embedding);
                    const buffer = Buffer.from(float32Array.buffer);
                    stmt.run(contentHash, buffer, embedding.length, now);
                }
            });

            transaction();
        } catch (error) {
            console.error('[EmbeddingCache] Error storing multiple embeddings:', error);
        }
    }

    /**
     * Get cache statistics
     */
    public getStats(): EmbeddingCacheStats | null {
        if (!this.db || !this.initialized) return null;

        try {
            const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM embeddings');
            const sizeStmt = this.db.prepare('SELECT SUM(LENGTH(embedding)) as size FROM embeddings');
            const rangeStmt = this.db.prepare('SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM embeddings');

            const countResult = countStmt.get() as { count: number };
            const sizeResult = sizeStmt.get() as { size: number | null };
            const rangeResult = rangeStmt.get() as { oldest: number | null; newest: number | null };

            return {
                totalEntries: countResult.count,
                cacheSize: sizeResult.size || 0,
                oldestEntry: rangeResult.oldest || 0,
                newestEntry: rangeResult.newest || 0
            };
        } catch (error) {
            console.error('[EmbeddingCache] Error getting stats:', error);
            return null;
        }
    }

    /**
     * Clean up old cache entries
     */
    public cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
        if (!this.db || !this.initialized) return 0;

        try {
            const cutoffTime = Date.now() - maxAgeMs;
            const stmt = this.db.prepare('DELETE FROM embeddings WHERE created_at < ?');
            const result = stmt.run(cutoffTime);

            if (result.changes > 0) {
                console.log(`[EmbeddingCache] Cleaned up ${result.changes} old cache entries`);
            }

            return result.changes;
        } catch (error) {
            console.error('[EmbeddingCache] Error during cleanup:', error);
            return 0;
        }
    }

    /**
     * Close the database connection
     */
    public close(): void {
        if (this.db) {
            try {
                this.db.close();
                this.db = null;
                this.initialized = false;
                console.log('[EmbeddingCache] Database closed');
            } catch (error) {
                console.error('[EmbeddingCache] Error closing database:', error);
            }
        }
    }

    /**
     * Check if cache is available and initialized
     */
    public isAvailable(): boolean {
        return this.initialized && this.db !== null;
    }
}