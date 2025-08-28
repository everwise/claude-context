#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Increment version script
 * Updates semantic version in main package.json and propagates to all sub-packages
 * Usage: node scripts/version.js [major|minor|patch]
 * Default: patch
 */

const PACKAGE_PATHS = [
  '.',
  './examples/basic-usage',
  './packages/core',
  './packages/chrome-extension',
  './packages/mcp',
  './packages/vscode-extension'
];

function incrementVersion(version, type = 'patch') {
  const [major, minor, patch] = version.split('.').map(Number);
  
  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

function updatePackageJson(packagePath, newVersion) {
  const fullPath = path.resolve(packagePath, 'package.json');
  
  if (!fs.existsSync(fullPath)) {
    console.warn(`Warning: package.json not found at ${fullPath}`);
    return false;
  }
  
  try {
    const packageData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const oldVersion = packageData.version;
    packageData.version = newVersion;
    
    fs.writeFileSync(fullPath, JSON.stringify(packageData, null, 2) + '\n');
    console.log(`Updated ${packagePath}/package.json: ${oldVersion} → ${newVersion}`);
    return true;
  } catch (error) {
    console.error(`Error updating ${fullPath}:`, error.message);
    return false;
  }
}

function main() {
  const versionType = process.argv[2] || 'patch';
  
  if (!['major', 'minor', 'patch'].includes(versionType)) {
    console.error('Error: Version type must be one of: major, minor, patch');
    process.exit(1);
  }
  
  // Read current version from main package.json
  const mainPackagePath = path.resolve('.', 'package.json');
  if (!fs.existsSync(mainPackagePath)) {
    console.error('Error: Main package.json not found');
    process.exit(1);
  }
  
  let mainPackage;
  try {
    mainPackage = JSON.parse(fs.readFileSync(mainPackagePath, 'utf8'));
  } catch (error) {
    console.error('Error reading main package.json:', error.message);
    process.exit(1);
  }
  
  const currentVersion = mainPackage.version;
  const newVersion = incrementVersion(currentVersion, versionType);
  
  console.log(`Incrementing version (${versionType}): ${currentVersion} → ${newVersion}`);
  console.log('');
  
  // Update all package.json files
  let successCount = 0;
  for (const packagePath of PACKAGE_PATHS) {
    if (updatePackageJson(packagePath, newVersion)) {
      successCount++;
    }
  }
  
  console.log('');
  console.log(`Successfully updated ${successCount}/${PACKAGE_PATHS.length} package.json files`);
  
  if (successCount < PACKAGE_PATHS.length) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}