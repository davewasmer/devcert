import * as crypto from 'crypto';
import { readFileSync as readFile, writeFileSync as writeFile } from 'fs';
import * as createDebug from 'debug';
import * as eol from 'eol';
import { fileSync as tmp } from 'tmp';
import * as inquirer from 'inquirer';

import {
  isMac,
  isLinux,
  configPath,
  opensslConfPath,
  opensslConfTemplate,
  rootCAKeyPath,
  rootCACertPath,
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
  debug(`Decrypting devcert's certificate authority credentials`);
  let decryptedCAKeyPath = tmp().name;
  let decryptedCACertPath = tmp().name;
  let encryptedCAKey = readFile(rootCAKeyPath, 'utf-8');
  let encryptedCACert = readFile(rootCACertPath, 'utf-8');
  let encryptionKey = await getPasswordFromUser();
  writeFile(decryptedCAKeyPath, decrypt(encryptedCAKey, encryptionKey));
  writeFile(decryptedCACertPath, decrypt(encryptedCACert, encryptionKey));
  return { decryptedCAKeyPath , decryptedCACertPath  };
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