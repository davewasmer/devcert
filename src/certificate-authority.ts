import * as crypto from 'crypto';
import { unlinkSync as rm, readFileSync as readFile, writeFileSync as writeFile } from 'fs';
import * as createDebug from 'debug';
import { fileSync as tmp } from 'tmp';
import * as inquirer from 'inquirer';

import {
  isMac,
  isLinux,
  rootCAKeyPath,
  rootCACertPath,
  caSelfSignConfig,
  opensslSerialFilePath,
  opensslDatabaseFilePath
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
  seedConfigFiles();

  debug(`Generating a private key`);
  generateKey(rootKeyPath);

  debug(`Generating a CA certificate`);
  openssl(`req -new -x509 -config ${ caSelfSignConfig } -key ${ rootKeyPath } -out ${ rootCertPath }`);

  debug('Saving certificate authority credentials');
  await saveCertificateAuthorityCredentials(rootKeyPath, rootCertPath);

  debug(`Adding the root certificate authority to trust stores`);
  if (isMac) {
    await addToMacTrustStores(rootCertPath, options);
  } else if (isLinux) {
    await addToLinuxTrustStores(rootCertPath, options);
  } else {
    await addToWindowsTrustStores(rootCertPath, options);
  }

}

/**
 * Initializes the files OpenSSL needs to sign certificates as a certificate
 * authority
 */
function seedConfigFiles() {
  writeFile(opensslDatabaseFilePath, '');
  writeFile(opensslSerialFilePath, '01');
}

export async function withCertificateAuthorityCredentials(cb: ({ keyPath, certPath }: { keyPath: string, certPath: string }) => Promise<void> | void) {
  debug(`Decrypting devcert's certificate authority credentials`);
  let decryptedCAKeyPath = tmp().name;
  let decryptedCACertPath = tmp().name;
  let encryptedCAKey = readFile(rootCAKeyPath, 'utf-8');
  let encryptedCACert = readFile(rootCACertPath, 'utf-8');
  let encryptionKey = await getPasswordFromUser();
  writeFile(decryptedCAKeyPath, decrypt(encryptedCAKey, encryptionKey));
  writeFile(decryptedCACertPath, decrypt(encryptedCACert, encryptionKey));
  await cb({ keyPath: decryptedCAKeyPath, certPath: decryptedCACertPath });
  rm(decryptedCAKeyPath);
  rm(decryptedCACertPath);
}

async function saveCertificateAuthorityCredentials(keypath: string, certpath: string) {
  debug(`Encrypting devcert's certificate authority credentials`);
  let key = readFile(keypath, 'utf-8');
  let cert = readFile(certpath, 'utf-8');
  let encryptionKey = await getPasswordFromUser();
  writeFile(rootCAKeyPath, encrypt(key, encryptionKey));
  writeFile(rootCACertPath, encrypt(cert, encryptionKey));
}

async function getPasswordFromUser(): Promise<string> {
  let { password } = await inquirer.prompt([{
    type: 'password',
    name: 'password',
    message: 'password:'
  }]);
  return password;
}

function encrypt(text: string, key: string) {
  let cipher = crypto.createCipher('aes256', key);
  return cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
}

function decrypt(encrypted: string, key: string) {
  let decipher = crypto.createDecipher('aes256', key);
  return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
}