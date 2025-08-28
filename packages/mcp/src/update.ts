import { spawn } from 'child_process';
import { envManager } from '@everwise/claude-context-core';

export interface UpdateConfig {
    enabled: boolean;
    checkInterval: number; // milliseconds
    source: 'github-packages' | 'github-releases';
    packageName: string;
    currentVersion: string;
}

export interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseNotes?: string;
    publishedAt?: string;
}

export class AutoUpdater {
    private config: UpdateConfig;
    private updateCheckTimer?: NodeJS.Timeout;
    private lastUpdateCheck = 0;
    private readonly CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

    constructor(config: UpdateConfig) {
        this.config = config;
    }


    /**
     * Check if updates are available from GitHub Packages
     */
    async checkForUpdates(): Promise<UpdateInfo> {
        console.log('[UPDATE] Checking for updates...');
        
        try {
            if (this.config.source === 'github-packages') {
                return await this.checkGitHubPackages();
            } else {
                return await this.checkGitHubReleases();
            }
        } catch (error) {
            console.warn('[UPDATE] Failed to check for updates:', error instanceof Error ? error.message : String(error));
            return {
                currentVersion: this.config.currentVersion,
                latestVersion: this.config.currentVersion,
                updateAvailable: false
            };
        }
    }

    /**
     * Check GitHub Packages registry for latest version
     */
    private async checkGitHubPackages(): Promise<UpdateInfo> {
        // Extract org and package name from @everwise/claude-context-mcp
        const [, org, packageName] = this.config.packageName.match(/@([^/]+)\/(.+)/) || [];
        if (!org || !packageName) {
            throw new Error(`Invalid package name format: ${this.config.packageName}`);
        }

        const apiUrl = `https://api.github.com/orgs/${org}/packages/npm/${packageName.replace('/', '%2F')}/versions`;
        
        // Prepare headers with optional authentication
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'claude-context-mcp'
        };

        // Add GitHub token if available for higher rate limits (5000/hr vs 60/hr)
        const githubToken = envManager.get('GITHUB_TOKEN') || envManager.get('GH_TOKEN');
        if (githubToken) {
            headers['Authorization'] = `Bearer ${githubToken}`;
        }

        const response = await fetch(apiUrl, { headers });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const versions = await response.json();
        if (!Array.isArray(versions) || versions.length === 0) {
            throw new Error('No versions found in GitHub Packages');
        }

        // Get the latest version (first in the array)
        const latestVersion = versions[0]?.name;
        if (!latestVersion) {
            throw new Error('Latest version not found');
        }

        return {
            currentVersion: this.config.currentVersion,
            latestVersion,
            updateAvailable: this.isNewerVersion(latestVersion, this.config.currentVersion),
            publishedAt: versions[0]?.created_at
        };
    }

    /**
     * Check GitHub Releases for latest version
     */
    private async checkGitHubReleases(): Promise<UpdateInfo> {
        // Extract org and repo from package name
        const [, org] = this.config.packageName.match(/@([^/]+)\//) || [];
        const repoName = 'claude-context';
        
        if (!org) {
            throw new Error(`Cannot extract org from package name: ${this.config.packageName}`);
        }

        const apiUrl = `https://api.github.com/repos/${org}/${repoName}/releases/latest`;
        
        // Prepare headers with optional authentication
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'claude-context-mcp'
        };

        // Add GitHub token if available for higher rate limits (5000/hr vs 60/hr)
        const githubToken = envManager.get('GITHUB_TOKEN') || envManager.get('GH_TOKEN');
        if (githubToken) {
            headers['Authorization'] = `Bearer ${githubToken}`;
        }

        const response = await fetch(apiUrl, { headers });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const release = await response.json() as any;
        const latestVersion = release.tag_name?.replace(/^v/, '') || release.name;

        if (!latestVersion) {
            throw new Error('Latest version not found in GitHub releases');
        }

        return {
            currentVersion: this.config.currentVersion,
            latestVersion,
            updateAvailable: this.isNewerVersion(latestVersion, this.config.currentVersion),
            releaseNotes: release.body,
            publishedAt: release.published_at
        };
    }

    /**
     * Compare version strings to determine if update is needed
     */
    private isNewerVersion(latest: string, current: string): boolean {
        const parseVersion = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
        const latestParts = parseVersion(latest);
        const currentParts = parseVersion(current);

        for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
            const latestPart = latestParts[i] || 0;
            const currentPart = currentParts[i] || 0;
            
            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }
        
        return false;
    }

    /**
     * Perform self-update by spawning new process with latest version
     * @returns true if update process started successfully (process will exit), false if update failed
     */
    async performUpdate(updateInfo: UpdateInfo): Promise<boolean> {
        console.log(`[UPDATE] 🔄 Updating from ${updateInfo.currentVersion} to ${updateInfo.latestVersion}`);
        
        try {
            // Save current state before updating
            await this.saveState();

            // Validate and filter command line arguments to prevent injection
            const allowedArgPatterns = [
                /^--help$/,
                /^-h$/,
                /^--config=.+$/,
                /^--debug$/,
                /^--verbose$/
            ];
            
            const safeArgs = process.argv.slice(2).filter(arg => 
                allowedArgPatterns.some(pattern => pattern.test(arg))
            );

            // Create safe environment with only necessary variables
            const safeEnv: Record<string, string> = {
                NODE_ENV: process.env.NODE_ENV || 'production',
                PATH: process.env.PATH || '',
                HOME: process.env.HOME || '',
                SKIP_UPDATE_CHECK: 'true' // Prevent update loop
            };

            // Preserve embedding and MCP configuration if present
            const configVars = [
                'EMBEDDING_PROVIDER', 'EMBEDDING_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL',
                'VOYAGEAI_API_KEY', 'GEMINI_API_KEY', 'OLLAMA_MODEL', 'OLLAMA_HOST',
                'RERANKING_PROVIDER', 'RERANKING_MODEL', 'RERANKING_ENABLED',
                'MILVUS_ADDRESS', 'MILVUS_TOKEN', 'MCP_SERVER_NAME', 'MCP_SERVER_VERSION'
            ];
            
            configVars.forEach(varName => {
                if (process.env[varName]) {
                    safeEnv[varName] = process.env[varName]!;
                }
            });

            // Spawn new version with bunx, forcing fresh download
            const child = spawn('bunx', [
                '--bun', // Force fresh install, bypassing cache
                `${this.config.packageName}@latest`,
                ...safeArgs // Only include validated arguments
            ], {
                stdio: 'inherit',
                detached: true,
                env: safeEnv
            });

            // Detach child process so it continues after parent exits
            child.unref();

            console.log(`[UPDATE] ✅ Restarted with latest version ${updateInfo.latestVersion}`);
            
            // Gracefully exit current process
            process.exit(0);
            
        } catch (error) {
            console.error('[UPDATE] Failed to perform update:', error);
            console.warn('[UPDATE] Continuing with current version');
            return false;
        }
    }

    /**
     * Save current application state before updating
     */
    private async saveState(): Promise<void> {
        try {
            // This would be called by the main application to save any important state
            console.log('[UPDATE] Saving application state...');
            
            // For MCP servers, we might want to:
            // 1. Save any pending operations
            // 2. Flush logs
            // 3. Save configuration state
            // 4. Signal clients about restart
            
            // The actual implementation depends on what state needs to be preserved
            // This is a hook that the main application can override
        } catch (error) {
            console.warn('[UPDATE] Failed to save state, continuing with update:', error);
        }
    }

    /**
     * Start periodic update checking
     */
    startPeriodicChecks(): void {
        if (!this.config.enabled || this.updateCheckTimer) {
            return;
        }

        console.log(`[UPDATE] Starting periodic update checks every ${this.config.checkInterval / 1000 / 60} minutes`);
        
        // Use recursive scheduling to prevent overlapping async operations
        this.scheduleNextCheck();
    }

    /**
     * Schedule the next update check using recursive setTimeout to prevent memory leaks
     */
    private scheduleNextCheck(): void {
        if (!this.config.enabled) {
            return;
        }
        
        this.updateCheckTimer = setTimeout(async () => {
            try {
                await this.checkAndUpdateIfNeeded();
            } catch (error) {
                console.warn('[UPDATE] Periodic update check failed:', error);
            } finally {
                // Schedule next check after current one completes to prevent overlap
                if (this.config.enabled) {
                    this.scheduleNextCheck();
                }
            }
        }, this.config.checkInterval);

        // Don't block process exit
        this.updateCheckTimer.unref();
    }

    /**
     * Stop periodic update checking
     */
    stopPeriodicChecks(): void {
        if (this.updateCheckTimer) {
            clearTimeout(this.updateCheckTimer);
            this.updateCheckTimer = undefined;
            console.log('[UPDATE] Stopped periodic update checks');
        }
    }

    /**
     * Force the next update check to bypass cache
     */
    forceNextCheck(): void {
        this.lastUpdateCheck = 0;
        console.log('[UPDATE] Cache cleared, next update check will be forced');
    }

    /**
     * Check for updates and perform update if needed
     */
    async checkAndUpdateIfNeeded(): Promise<boolean> {
        // Skip if disabled or we're in a skip update cycle
        if (!this.config.enabled || process.env.SKIP_UPDATE_CHECK === 'true') {
            return false;
        }

        // Rate limit update checks
        const now = Date.now();
        if (now - this.lastUpdateCheck < this.CACHE_DURATION) {
            return false;
        }
        this.lastUpdateCheck = now;

        try {
            const updateInfo = await this.checkForUpdates();
            
            if (updateInfo.updateAvailable) {
                console.log(`[UPDATE] 🆕 New version available: ${updateInfo.latestVersion} (current: ${updateInfo.currentVersion})`);
                
                // Perform update automatically
                const updateStarted = await this.performUpdate(updateInfo);
                return updateStarted;
            } else {
                console.log(`[UPDATE] ✅ Running latest version: ${updateInfo.currentVersion}`);
                return false;
            }
        } catch (error) {
            console.warn('[UPDATE] Update check failed:', error);
            return false;
        }
    }

    /**
     * Check for updates on startup
     */
    async checkOnStartup(): Promise<void> {
        if (!this.config.enabled || process.env.SKIP_UPDATE_CHECK === 'true') {
            return;
        }

        console.log('[UPDATE] Performing startup update check...');
        
        try {
            await this.checkAndUpdateIfNeeded();
        } catch (error) {
            console.warn('[UPDATE] Startup update check failed, continuing with current version:', error);
        }
    }
}

/**
 * Create auto-updater instance with default configuration
 */
export function createAutoUpdater(packageName: string, currentVersion: string): AutoUpdater {
    const config: UpdateConfig = {
        enabled: process.env.AUTO_UPDATE !== 'false', // Enabled by default, opt-out
        checkInterval: parseInt(process.env.UPDATE_CHECK_INTERVAL || '3600000', 10), // Default: 1 hour
        source: (process.env.UPDATE_SOURCE as 'github-packages' | 'github-releases') || 'github-packages',
        packageName,
        currentVersion
    };

    return new AutoUpdater(config);
}