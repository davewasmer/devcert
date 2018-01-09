import * as path from 'path';
import { unlinkSync as rm, writeFileSync as writeFile, readFileSync as readFile } from 'fs';
import { sync as mkdirp } from 'mkdirp';
import { fileSync as tmp } from 'tmp';
import { template as makeTemplate } from 'lodash';
import applicationConfigPath = require('application-config-path');
import * as eol from 'eol';

// Platform shortcuts
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
export const isWindows = process.platform === 'win32';

// Common paths
export const configDir = applicationConfigPath('devcert');
export const configPath: (...pathSegments: string[]) => string = path.join.bind(path, configDir);

export const domainsDir = configPath('domains');
export const pathForDomain: (domain: string, ...pathSegments: string[]) => string = path.join.bind(path, domainsDir)

export const opensslSerialFilePath = configPath('certificate-authority', 'serial');
export const opensslDatabaseFilePath = configPath('certificate-authority', 'index.txt');
export const caSelfSignConfig = path.join(__dirname, '../openssl-configurations/certificate-authority-self-signing.conf');

export function withDomainSigningRequestConfig(domain: string, cb: (filepath: string) => void) {
  let tmpFile = tmp().name;
  let source = readFile(path.join(__dirname, '../openssl-configurations/domain-certificate-signing-requests.conf'), 'utf-8');
  let template = makeTemplate(source);
  let result = template({ domain });
  writeFile(tmpFile, eol.auto(result));
  cb(tmpFile);
  rm(tmpFile);
}

export function withDomainCertificateConfig(domain: string, cb: (filepath: string) => void) {
  let tmpFile = tmp().name;
  let source = readFile(path.join(__dirname, '../openssl-configurations/domain-certificates.conf'), 'utf-8');
  let template = makeTemplate(source);
  let result = template({
    domain,
    serialFile: opensslSerialFilePath,
    databaseFile: opensslDatabaseFilePath,
    domainDir: pathForDomain(domain)
  });
  writeFile(tmpFile, eol.auto(result));
  cb(tmpFile);
  rm(tmpFile);
}

  // confTemplate = confTemplate.replace(/DATABASE_PATH/, configPath('index.txt').replace(/\\/g, '\\\\'));
  // confTemplate = confTemplate.replace(/SERIAL_PATH/, configPath('serial').replace(/\\/g, '\\\\'));
  // confTemplate = eol.auto(confTemplate);

export const rootCADir = configPath('certificate-authority');
export const rootCAKeyPath = configPath('certificate-authority', 'private-key.key');
export const rootCACertPath = configPath('certificate-authority', 'certificate.cert');

mkdirp(configDir);
mkdirp(domainsDir);
mkdirp(rootCADir);
