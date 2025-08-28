import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type PackageJson = { version: string };
const { version } = require('../package.json') as PackageJson;

export const VERSION = version;