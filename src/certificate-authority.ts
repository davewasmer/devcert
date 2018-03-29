import { unlinkSync as rm, readFileSync as readFile, writeFileSync as writeFile } from 'fs';
import createDebug from 'debug';

import {
  rootCAKeyPath,
  rootCACertPath,
  caSelfSignConfig,
  opensslSerialFilePath,
  opensslDatabaseFilePath
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
  debug(`Generating a root certificate authority`);
  let rootKeyPath = mktmp();
  let rootCertPath = mktmp();

  debug(`Generating the OpenSSL configuration needed to setup the certificate authority`);
  seedConfigFiles();

  debug(`Generating a private key`);
  generateKey(rootKeyPath);

  debug(`Generating a CA certificate`);
  openssl(`req -new -x509 -config "${ caSelfSignConfig }" -key "${ rootKeyPath }" -out "${ rootCertPath }"`);

  debug('Saving certificate authority credentials');
  await saveCertificateAuthorityCredentials(rootKeyPath, rootCertPath);

  debug(`Adding the root certificate authority to trust stores`);
  await currentPlatform.addToTrustStores(rootCertPath, options);
}

/**
 * Initializes the files OpenSSL needs to sign certificates as a certificate
 * authority
 */
function seedConfigFiles() {
  writeFile(opensslDatabaseFilePath, '');
  writeFile(opensslSerialFilePath, '01');
}

export async function withCertificateAuthorityCredentials(cb: ({ caKeyPath, caCertPath }: { caKeyPath: string, caCertPath: string }) => Promise<void> | void) {
  debug(`Retrieving devcert's certificate authority credentials`);
  let tmpCAKeyPath = mktmp();
  let tmpCACertPath = mktmp();
  let caKey = await currentPlatform.readProtectedFile(rootCAKeyPath);
  let caCert = await currentPlatform.readProtectedFile(rootCACertPath);
  writeFile(tmpCAKeyPath, caKey);
  writeFile(tmpCACertPath, caCert);
  await cb({ caKeyPath: tmpCAKeyPath, caCertPath: tmpCACertPath });
  rm(tmpCAKeyPath);
  rm(tmpCACertPath);
}

async function saveCertificateAuthorityCredentials(keypath: string, certpath: string) {
  debug(`Saving devcert's certificate authority credentials`);
  let key = readFile(keypath, 'utf-8');
  let cert = readFile(certpath, 'utf-8');
  await currentPlatform.writeProtectedFile(rootCAKeyPath, key);
  await currentPlatform.writeProtectedFile(rootCACertPath, cert);
}
