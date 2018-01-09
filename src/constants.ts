import * as path from 'path';
import { sync as mkdirp } from 'mkdirp';
import applicationConfigPath = require('application-config-path');

// Platform shortcuts
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

// Common paths
export const configDir = applicationConfigPath('devcert');
export const configPath: (...pathSegments: string[]) => string = path.join.bind(path, configDir);

export const domainsDir = configPath('domains');
export const pathForDomain: (domain: string, ...pathSegments: string[]) => string = path.join.bind(path, domainsDir)

export const opensslConfTemplate = path.join(__dirname, '..', 'openssl.conf');
export const opensslConfPath = configPath('openssl.conf');

export const rootCAInstalledFlagFilePath = configPath('root-ca-installed');

mkdirp(configDir);
mkdirp(domainsDir);
