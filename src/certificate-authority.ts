import path from 'path';
import {
  unlinkSync as rm,
  readFileSync as readFile,
  writeFileSync as writeFile,
  existsSync as exists
} from 'fs';
import { sync as rimraf } from 'rimraf';
import createDebug from 'debug';

import {
  rootCAKeyPath,
  rootCACertPath,
  caSelfSignConfig,
  opensslSerialFilePath,
  opensslDatabaseFilePath,
  isWindows,
  isLinux,
  caVersionFile
} from './constants';
import currentPlatform from './platforms';
import { openssl, mktmp } from './utils';
import { generateKey } from './certificates';
import { Options } from './index';

const debug = createDebug('devcert:certificate-authority');

/**
 * Install the once-per-machine trusted root CA. We'll use this CA to sign
 * per-app certs.
 */
export default async function installCertificateAuthority(options: Options = {}): Promise<void> {
  debug(`Checking if older devcert install is present`);
  scrubOldInsecureVersions();

  debug(`Generating a root certificate authority`);
  let rootKeyPath = mktmp();

  debug(`Generating the OpenSSL configuration needed to setup the certificate authority`);
  seedConfigFiles();

  debug(`Generating a private key`);
  generateKey(rootKeyPath);

  debug(`Generating a CA certificate`);
  openssl(`req -new -x509 -config "${ caSelfSignConfig }" -key "${ rootKeyPath }" -out "${ rootCACertPath }" -days 825`);

  debug('Saving certificate authority credentials');
  await saveCertificateAuthorityCredentials(rootKeyPath);

  debug(`Adding the root certificate authority to trust stores`);
  await currentPlatform.addToTrustStores(rootCACertPath, options);
}

/**
 * Older versions of devcert left the root certificate keys unguarded and
 * accessible by userland processes. Here, we check for evidence of this older
 * version, and if found, we delete the root certificate keys to remove the
 * attack vector.
 */
function scrubOldInsecureVersions() {
  // Use the old verion's logic for determining config directory
  let configDir: string;
  if (isWindows && process.env.LOCALAPPDATA) {
    configDir = path.join(process.env.LOCALAPPDATA, 'devcert', 'config');
  } else {
    let uid = process.getuid && process.getuid();
    let userHome = (isLinux && uid === 0) ? path.resolve('/usr/local/share') : require('os').homedir();
    configDir = path.join(userHome, '.config', 'devcert');
  }

  // Delete the root certificate keys, as well as the generated app certificates
  debug(`Checking ${ configDir } for legacy files ...`);
  [
    path.join(configDir, 'openssl.conf'),
    path.join(configDir, 'devcert-ca-root.key'),
    path.join(configDir, 'devcert-ca-root.crt'),
    path.join(configDir, 'devcert-ca-version'),
    path.join(configDir, 'certs')
  ].forEach((filepath) => {
    if (exists(filepath)) {
      debug(`Removing legacy file: ${ filepath }`)
      rimraf(filepath);
    }
  });
}

/**
 * Initializes the files OpenSSL needs to sign certificates as a certificate
 * authority, as well as our CA setup version
 */
function seedConfigFiles() {
  // This is v2 of the devcert certificate authority setup
  writeFile(caVersionFile, '2');
  // OpenSSL CA files
  writeFile(opensslDatabaseFilePath, '');
  writeFile(opensslSerialFilePath, '01');
}

export async function withCertificateAuthorityCredentials(cb: ({ caKeyPath, caCertPath }: { caKeyPath: string, caCertPath: string }) => Promise<void> | void) {
  debug(`Retrieving devcert's certificate authority credentials`);
  let tmpCAKeyPath = mktmp();
  let caKey = await currentPlatform.readProtectedFile(rootCAKeyPath);
  writeFile(tmpCAKeyPath, caKey);
  await cb({ caKeyPath: tmpCAKeyPath, caCertPath: rootCACertPath });
  rm(tmpCAKeyPath);
}

async function saveCertificateAuthorityCredentials(keypath: string) {
  debug(`Saving devcert's certificate authority credentials`);
  let key = readFile(keypath, 'utf-8');
  await currentPlatform.writeProtectedFile(rootCAKeyPath, key);
}
