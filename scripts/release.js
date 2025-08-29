#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * Release script
 * Handles version updates, commits, and tagging for release
 * Usage: node scripts/release.js [major|minor|patch]
 * Default: patch
 * 
 * Steps:
 * 1. Run version script to update all package.json files
 * 2. Build all packages to ensure they compile
 * 3. Commit version changes
 * 4. Create and push Git tag
 * 5. Push commits
 * 
 * Note: Does NOT run publish commands - GitHub workflow handles that
 */

// Package paths that the version script modifies (keep in sync with scripts/version.js)
const PACKAGE_PATHS = [
    '.',
    './examples/basic-usage',
    './packages/core',
    './packages/chrome-extension',
    './packages/mcp',
    './packages/vscode-extension'
];

function runCommand(command, description) {
    console.log(`\n🔧 ${description}...`);
    console.log(`   Running: ${command}`);
    try {
        const result = execSync(command, { stdio: 'inherit', encoding: 'utf8' });
        console.log(`✅ ${description} completed`);
        return result;
    } catch (error) {
        console.error(`❌ ${description} failed:`, error.message);
        process.exit(1);
    }
}

function getCurrentVersion() {
    const mainPackagePath = path.resolve('.', 'package.json');
    if (!fs.existsSync(mainPackagePath)) {
        console.error('❌ Error: Main package.json not found');
        process.exit(1);
    }
    
    try {
        const mainPackage = JSON.parse(fs.readFileSync(mainPackagePath, 'utf8'));
        return mainPackage.version;
    } catch (error) {
        console.error('❌ Error reading main package.json:', error.message);
        process.exit(1);
    }
}

async function askToContinue(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(`${message} (y/N): `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

function getPackageJsonPaths() {
    return PACKAGE_PATHS.map(packagePath => 
        path.resolve(packagePath, 'package.json')
    ).filter(fullPath => fs.existsSync(fullPath));
}

async function checkWorkingDirectory() {
    try {
        const status = execSync('git status --porcelain', { encoding: 'utf8' });
        if (!status.trim()) {
            return; // Clean working directory
        }

        const packageJsonPaths = getPackageJsonPaths();
        const modifiedPackageJsons = [];
        
        // Check if any package.json files are already modified
        const lines = status.trim().split('\n');
        for (const line of lines) {
            const filePath = path.resolve(line.slice(3)); // Remove git status prefix
            if (packageJsonPaths.some(pkgPath => pkgPath === filePath)) {
                modifiedPackageJsons.push(filePath);
            }
        }
        
        if (modifiedPackageJsons.length > 0) {
            console.log('⚠️  Package.json files are already modified:');
            modifiedPackageJsons.forEach(file => {
                console.log(`   - ${path.relative('.', file)}`);
            });
            console.log('\nThese files contain version numbers that may conflict with the release process.');
            
            const shouldContinue = await askToContinue('Do you want to continue anyway?');
            if (!shouldContinue) {
                console.log('Release aborted. Please commit or stash package.json changes first.');
                process.exit(0);
            }
        }
        
        // Check for other uncommitted changes
        const otherChanges = lines.filter(line => {
            const filePath = path.resolve(line.slice(3));
            return !packageJsonPaths.some(pkgPath => pkgPath === filePath);
        });
        
        if (otherChanges.length > 0) {
            console.log('⚠️  Working directory has other uncommitted changes:');
            otherChanges.forEach(line => {
                console.log(`   ${line}`);
            });
            
            const shouldContinue = await askToContinue('Do you want to continue with the release?');
            if (!shouldContinue) {
                console.log('Release aborted. Please commit or stash changes first.');
                process.exit(0);
            }
        }
        
    } catch (error) {
        console.error('❌ Error checking git status:', error.message);
        process.exit(1);
    }
}

function checkCurrentBranch() {
    try {
        const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
        if (branch !== 'master' && branch !== 'main') {
            console.log(`⚠️  Current branch is '${branch}', not 'main' or 'master'`);
            console.log('Are you sure you want to release from this branch?');
            // Could add confirmation prompt here if needed
        }
        return branch;
    } catch (error) {
        console.error('❌ Error checking current branch:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('🚀 Starting Release Process');
    console.log('==============================');

    // Parse command line arguments
    const versionType = process.argv[2] || 'patch';
    
    if (!['major', 'minor', 'patch'].includes(versionType)) {
        console.error('❌ Error: Version type must be one of: major, minor, patch');
        process.exit(1);
    }

    // Pre-flight checks
    console.log('\n📋 Pre-flight checks...');
    await checkWorkingDirectory();
    const currentBranch = checkCurrentBranch();
    const oldVersion = getCurrentVersion();
    
    console.log(`   Current version: ${oldVersion}`);
    console.log(`   Version increment: ${versionType}`);
    console.log(`   Current branch: ${currentBranch}`);

    // Step 1: Update versions
    runCommand(
        `node scripts/version.js ${versionType}`,
        `Updating versions (${versionType})`
    );

    // Get new version for tagging
    const newVersion = getCurrentVersion();
    console.log(`\n📦 Version updated: ${oldVersion} → ${newVersion}`);

    // Step 2: Build all packages to ensure they compile
    runCommand('pnpm build', 'Building all packages');

    // Step 3: Commit version changes (only package.json files)
    const packageJsonPaths = getPackageJsonPaths();
    const relativePackagePaths = packageJsonPaths.map(p => path.relative('.', p));
    
    console.log(`\n📝 Adding only package.json files:`);
    relativePackagePaths.forEach(p => console.log(`   - ${p}`));
    
    runCommand(
        `git add ${relativePackagePaths.join(' ')}`,
        'Staging package.json changes'
    );
    runCommand(
        `git commit -m "chore: Bump package versions to ${newVersion}"`,
        'Committing version changes'
    );

    // Step 4: Create and push Git tag
    const tagName = `v${newVersion}`;
    runCommand(
        `git tag ${tagName}`,
        `Creating Git tag ${tagName}`
    );

    // Step 5: Push commits and tags
    runCommand(
        `git push origin ${currentBranch}`,
        `Pushing commits to ${currentBranch}`
    );
    runCommand(
        `git push origin ${tagName}`,
        `Pushing tag ${tagName}`
    );

    // Success message
    console.log('\n🎉 Release preparation completed successfully!');
    console.log('======================================');
    console.log(`✅ Version: ${oldVersion} → ${newVersion}`);
    console.log(`✅ Tag: ${tagName} created and pushed`);
    console.log(`✅ Commits pushed to ${currentBranch}`);
    console.log('\n📝 Next steps:');
    console.log('   - GitHub workflow should automatically publish packages');
    console.log('   - Monitor GitHub Actions for publication status');
    console.log(`   - Check published packages: https://github.com/everwise/claude-context/packages`);
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Release Script

Usage: node scripts/release.js [major|minor|patch]

Options:
  major    Increment major version (1.0.0 → 2.0.0)
  minor    Increment minor version (1.0.0 → 1.1.0)
  patch    Increment patch version (1.0.0 → 1.0.1) [default]

Examples:
  node scripts/release.js patch     # 0.1.11 → 0.1.12
  node scripts/release.js minor     # 0.1.11 → 0.2.0
  node scripts/release.js major     # 0.1.11 → 1.0.0

What it does:
  1. Updates all package.json versions
  2. Builds all packages to verify compilation
  3. Commits version changes
  4. Creates and pushes Git tag
  5. Pushes commits to origin

Note: Does NOT publish packages - GitHub workflow handles that automatically.
    `);
    process.exit(0);
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Release failed:', error.message);
        process.exit(1);
    });
}