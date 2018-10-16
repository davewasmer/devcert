import path from 'path';
import { sync as mkdirp } from 'mkdirp';
import applicationConfigPath = require('application-config-path');

export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
export const defaultDays = daysToMs(7000);

// Platform shortcuts
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

// Common paths
export const configDir = applicationConfigPath('devcert');
export const configPath: (...pathSegments: string[]) => string = path.join.bind(path, configDir);

export const domainsDir = configPath('domains');
export const pathForDomain: (domain: string, ...pathSegments: string[]) => string = path.join.bind(path, domainsDir)

export const caVersionFile = configPath('devcert-ca-version');

export const rootCADir = configPath('certificate-authority');
export const rootCAKeyPath = configPath('certificate-authority', 'private-key.key');
export const rootCACertPath = configPath('certificate-authority', 'certificate.cert');

mkdirp(configDir);
mkdirp(domainsDir);
mkdirp(rootCADir);
