import * as fs from "fs";
import { Context, FileSynchronizer, envManager } from "@everwise/claude-context-core";
import { SnapshotManager } from "./snapshot.js";

const SYNC_REINDEX_INTERVAL_MINUTES = 3;
const SYNC_COOLDOWN_MINUTES =  2;
const SYNC_TIMEOUT_MINUTES = 15;

export class SyncManager {
    private context: Context;
    private snapshotManager: SnapshotManager;
    private isSyncing: boolean = false;
    private claimedCodebases: string[] = [];

    constructor(context: Context, snapshotManager: SnapshotManager) {
        this.context = context;
        this.snapshotManager = snapshotManager;

        // Handle graceful shutdown
        process.on('SIGTERM', () => this.handleGracefulShutdown());
        process.on('SIGINT', () => this.handleGracefulShutdown());
    }

    private handleGracefulShutdown(): void {
        console.log('[SYNC-DEBUG] Graceful shutdown - releasing unclaimed codebases');
        if (this.claimedCodebases.length > 0) {
            this.snapshotManager.releaseUnclaimedCodebases(this.claimedCodebases);
        }
        process.exit(0);
    }

    public async handleSyncIndex(): Promise<void> {
        const syncStartTime = Date.now();
        console.log(`[SYNC-DEBUG] handleSyncIndex() called at ${new Date().toISOString()}`);

        // Get sync coordination settings from environment
        const cooldownMinutes = parseInt(envManager.get('SYNC_COOLDOWN_MINUTES') || String(SYNC_COOLDOWN_MINUTES), 10);
        const timeoutMinutes = parseInt(envManager.get('SYNC_TIMEOUT_MINUTES') || String(SYNC_TIMEOUT_MINUTES), 10);

        console.log(`[SYNC-DEBUG] Using sync coordination: cooldown=${cooldownMinutes}min, timeout=${timeoutMinutes}min`);

        const indexedCodebases = this.snapshotManager.getIndexedCodebases();

        if (indexedCodebases.length === 0) {
            console.log('[SYNC-DEBUG] No codebases indexed. Skipping sync.');
            return;
        }

        console.log(`[SYNC-DEBUG] Found ${indexedCodebases.length} indexed codebases:`, indexedCodebases);

        if (this.isSyncing) {
            console.log('[SYNC-DEBUG] Index sync already in progress. Skipping.');
            return;
        }

        this.isSyncing = true;
        console.log(`[SYNC-DEBUG] Starting index sync for all ${indexedCodebases.length} codebases...`);

        try {
            let totalStats = { added: 0, removed: 0, modified: 0 };
            let syncedCount = 0;

            // Reload snapshot once, then filter eligible codebases without additional reloads
            console.log(`[SYNC-DEBUG] Reloading snapshot for eligibility filtering`);
            this.snapshotManager.reloadFromDisk();

            console.log(`[SYNC-DEBUG] Filtering eligible codebases for sync`);
            const eligibleCodebases = indexedCodebases.filter(codebasePath =>
                this.snapshotManager.shouldSync(codebasePath, cooldownMinutes, timeoutMinutes, true)
            ); // skipReload=true

            console.log(`[SYNC-DEBUG] Found ${eligibleCodebases.length}/${indexedCodebases.length} eligible codebases`);

            if (eligibleCodebases.length === 0) {
                console.log('[SYNC-DEBUG] No eligible codebases for sync.');
                return;
            }

            // Claim all eligible codebases at once
            this.claimedCodebases = this.snapshotManager.claimCodebasesForSync(eligibleCodebases);

            if (this.claimedCodebases.length === 0) {
                console.log('[SYNC-DEBUG] No codebases claimed (all may be claimed by other instances).');
                return;
            }

            console.log(`[SYNC-DEBUG] Successfully claimed ${this.claimedCodebases.length} codebases for sync`);

            for (let i = 0; i < this.claimedCodebases.length; i++) {
                const codebasePath = this.claimedCodebases[i];
                const codebaseStartTime = Date.now();

                console.log(`[SYNC-DEBUG] [${i + 1}/${this.claimedCodebases.length}] Starting sync for codebase: '${codebasePath}'`);

                // Check if codebase path still exists
                if (!fs.existsSync(codebasePath)) {
                    console.warn(`[SYNC-DEBUG] Codebase path '${codebasePath}' no longer exists. Skipping sync.`);
                    this.snapshotManager.completeSync(codebasePath);
                    continue;
                }

                try {
                    console.log(`[SYNC-DEBUG] Calling context.reindexByChange() for '${codebasePath}'`);
                    const stats = await this.context.reindexByChange(codebasePath);
                    const codebaseElapsed = Date.now() - codebaseStartTime;

                    console.log(`[SYNC-DEBUG] Reindex stats for '${codebasePath}':`, JSON.stringify(stats, null, 2));
                    console.log(`[SYNC-DEBUG] Codebase sync completed in ${codebaseElapsed}ms`);

                    // Accumulate total stats
                    totalStats.added += stats.added;
                    totalStats.removed += stats.removed;
                    totalStats.modified += stats.modified;
                    syncedCount++;

                    if (stats.added > 0 || stats.removed > 0 || stats.modified > 0) {
                        console.log(`[SYNC] Sync complete for '${codebasePath}'. Added: ${stats.added}, Removed: ${stats.removed}, Modified: ${stats.modified} (${codebaseElapsed}ms)`);
                    } else {
                        console.log(`[SYNC] No changes detected for '${codebasePath}' (${codebaseElapsed}ms)`);
                    }

                    // Mark sync as completed
                    this.snapshotManager.completeSync(codebasePath);

                } catch (error: any) {
                    const codebaseElapsed = Date.now() - codebaseStartTime;
                    console.error(`[SYNC-DEBUG] Error syncing codebase '${codebasePath}' after ${codebaseElapsed}ms:`, error);
                    console.error(`[SYNC-DEBUG] Error stack:`, error.stack);

                    if (error.message.includes('Failed to query Milvus')) {
                        // Collection maybe deleted manually, delete the snapshot file
                        await FileSynchronizer.deleteSnapshot(codebasePath);
                    }

                    // Log additional error details
                    if (error.code) {
                        console.error(`[SYNC-DEBUG] Error code: ${error.code}`);
                    }
                    if (error.errno) {
                        console.error(`[SYNC-DEBUG] Error errno: ${error.errno}`);
                    }

                    // Mark sync as completed even on error to clear sync state
                    this.snapshotManager.completeSync(codebasePath);

                    // Continue with next codebase even if one fails
                }
            }

            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] Total sync stats across all codebases: Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
            console.log(`[SYNC-DEBUG] Index sync completed for ${syncedCount}/${this.claimedCodebases.length} codebases in ${totalElapsed}ms`);
            console.log(`[SYNC] Index sync completed for ${syncedCount}/${this.claimedCodebases.length} codebases. Total changes - Added: ${totalStats.added}, Removed: ${totalStats.removed}, Modified: ${totalStats.modified}`);
        } catch (error: any) {
            const totalElapsed = Date.now() - syncStartTime;
            console.error(`[SYNC-DEBUG] Error during index sync after ${totalElapsed}ms:`, error);
            console.error(`[SYNC-DEBUG] Error stack:`, error.stack);
        } finally {
            // Release any unclaimed codebases
            if (this.claimedCodebases.length > 0) {
                this.snapshotManager.releaseUnclaimedCodebases(this.claimedCodebases);
                this.claimedCodebases = [];
            }

            this.isSyncing = false;
            const totalElapsed = Date.now() - syncStartTime;
            console.log(`[SYNC-DEBUG] handleSyncIndex() finished at ${new Date().toISOString()}, total duration: ${totalElapsed}ms`);
        }
    }

    public startBackgroundSync(): void {
        console.log('[SYNC-DEBUG] startBackgroundSync() called');

        // Execute initial sync immediately after a short delay to let server initialize
        console.log('[SYNC-DEBUG] Scheduling initial sync in 5 seconds...');
        setTimeout(async () => {
            console.log('[SYNC-DEBUG] Executing initial sync after server startup');
            try {
                await this.handleSyncIndex();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage.includes('Failed to query collection')) {
                    console.log('[SYNC-DEBUG] Collection not yet established, this is expected for new cluster users. Will retry on next sync cycle.');
                } else {
                    console.error('[SYNC-DEBUG] Initial sync failed with unexpected error:', error);
                    throw error;
                }
            }
        }, 5000); // Initial sync after 5 seconds

        // Get sync coordination settings from environment
        const reindexIntervalMinutes = parseInt(envManager.get('SYNC_REINDEX_INTERVAL_MINUTES') || String(SYNC_REINDEX_INTERVAL_MINUTES), 10);

        // Periodically check for file changes and update the index
        console.log(`[SYNC-DEBUG] Setting up periodic sync every ${reindexIntervalMinutes} minutes (${reindexIntervalMinutes * 60 * 1000}ms)`);
        const syncInterval = setInterval(() => {
            console.log('[SYNC-DEBUG] Executing scheduled periodic sync');
            this.handleSyncIndex();
        }, reindexIntervalMinutes * 60 * 1000); // every 5 minutes

        console.log('[SYNC-DEBUG] Background sync setup complete. Interval ID:', syncInterval);
    }
}