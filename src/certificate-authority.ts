import { unlinkSync as rm, readFileSync as readFile, writeFileSync as writeFile } from 'fs';
import * as createDebug from 'debug';
import * as eol from 'eol';
import { fileSync as tmp } from 'tmp';
import * as keychain from 'keytar';

import {
  isMac,
  isLinux,
  configPath,
  opensslConfPath,
  opensslConfTemplate,
  rootCAInstalledFlagFilePath
} from './constants';
import addToMacTrustStores from './platforms/macos';
import addToLinuxTrustStores from './platforms/linux';
import addToWindowsTrustStores from './platforms/windows';
import { openssl } from './utils';
import { generateKey } from './certificates';
import { Options } from './index';

const debug = createDebug('devcert:certificate-authority');

/**
 * Install the once-per-machine trusted root CA. We'll use this CA to sign
 * per-app certs.
 */
export default async function installCertificateAuthority(options: Options = {}): Promise<void> {
  debug(`Generating a root certificate authority`);
  let rootKeyPath = tmp().name;
  let rootCertPath = tmp().name;

  debug(`Generating the OpenSSL configuration needed to setup the certificate authority`);
  generateOpenSSLConfFiles();

  debug(`Generating a private key`);
  generateKey(rootKeyPath);

  debug(`Generating a CA certificate`);
  openssl(`req -config ${ opensslConfPath } -key ${ rootKeyPath } -out ${ rootCertPath } -new -subj "/CN=devcert" -x509 -days 7000 -extensions v3_ca`);

  debug('Saving certificate authority credentials to system keychain');
  addCertificateAuthorityToSystemKeychain(rootKeyPath, rootCertPath);

  debug(`Adding the root certificate authority to trust stores`);
  if (isMac) {
    await addToMacTrustStores(rootCertPath, options);
  } else if (isLinux) {
    await addToLinuxTrustStores(rootCertPath, options);
  } else {
    await addToWindowsTrustStores(rootCertPath, options);
  }

  debug('Certificate authority added to trust stores, removing temporary files');
  rm(rootKeyPath);
  rm(rootCertPath);

  debug('Adding flag indicating root certificate authority install');
  writeFile(rootCAInstalledFlagFilePath, '');
}

/**
 * Copy our OpenSSL conf template to the local devcert config folder, and
 * update the paths inside that config file to be OS specific. Also initializes
 * the files OpenSSL needs to sign certificates as a certificate authority
 */
function generateOpenSSLConfFiles() {
  let confTemplate = readFile(opensslConfTemplate, 'utf-8');
  confTemplate = confTemplate.replace(/DATABASE_PATH/, configPath('index.txt').replace(/\\/g, '\\\\'));
  confTemplate = confTemplate.replace(/SERIAL_PATH/, configPath('serial').replace(/\\/g, '\\\\'));
  confTemplate = eol.auto(confTemplate);
  writeFile(opensslConfPath, confTemplate);
  writeFile(configPath('index.txt'), '');
  writeFile(configPath('serial'), '01');
  // This version number lets us write code in the future that intelligently upgrades an existing
  // devcert installation. This "ca-version" is independent of the devcert package version, and
  // tracks changes to the root certificate setup only.
  writeFile(configPath('devcert-ca-version'), '1');
}

export async function fetchCertificateAuthorityCredentials() {
  let rootKeyPath = tmp().name;
  let rootCertPath = tmp().name;
  let key = await keychain.getPassword('devcert', 'certificate-authority-key');
  let cert = await keychain.getPassword('devcert', 'certificate-authority-cert');
  writeFile(rootKeyPath, key);
  writeFile(rootCertPath, cert);
  return { rootKeyPath, rootCertPath };
}

async function addCertificateAuthorityToSystemKeychain(keypath: string, certpath: string) {
  let key = readFile(keypath, 'utf-8');
  let cert = readFile(certpath, 'utf-8');
  await keychain.setPassword('devcert', 'certificate-authority-key', key);
  await keychain.setPassword('devcert', 'certificate-authority-certificate', cert);
}