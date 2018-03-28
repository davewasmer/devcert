import { readFileSync as readFile, readdirSync as readdir, existsSync as exists } from 'fs';
import createDebug from 'debug';
import { sync as commandExists } from 'command-exists';
import rimraf from 'rimraf';
import {
  isMac,
  isLinux,
  isWindows,
  pathForDomain,
  domainsDir,
  rootCAKeyPath
} from './constants';
import currentPlatform from './platforms';
import installCertificateAuthority from './certificate-authority';
import generateDomainCertificate from './certificates';
import UI, { UserInterface } from './user-interface';

const debug = createDebug('devcert');

export interface Options {
  skipCertutilInstall?: true,
  skipHostsFile?: true,
  ui?: UserInterface
}

/**
 * Request an SSL certificate for the given app name signed by the devcert root
 * certificate authority. If devcert has previously generated a certificate for
 * that app name on this machine, it will reuse that certificate.
 *
 * If this is the first time devcert is being run on this machine, it will
 * generate and attempt to install a root certificate authority.
 *
 * Returns a promise that resolves with { key, cert }, where `key` and `cert`
 * are Buffers with the contents of the certificate private key and certificate
 * file, respectively
 */
export async function certificateFor(domain: string, options: Options = {}) {
  debug(`Certificate requested for ${ domain }. Skipping certutil install: ${ Boolean(options.skipCertutilInstall) }. Skipping hosts file: ${ Boolean(options.skipHostsFile) }`);

  if (options.ui) {
    Object.assign(UI, options.ui);
  }

  if (!isMac && !isLinux && !isWindows) {
    throw new Error(`Platform not supported: "${ process.platform }"`);
  }

  if (!commandExists('openssl')) {
    throw new Error('OpenSSL not found: OpenSSL is required to generate SSL certificates - make sure it is installed and available in your PATH');
  }

  let domainKeyPath = pathForDomain(domain, `private-key.key`);
  let domainCertPath = pathForDomain(domain, `certificate.crt`);

  if (!exists(rootCAKeyPath)) {
    debug('Root CA is not installed yet, so it must be our first run. Installing root CA ...');
    await installCertificateAuthority(options);
  }

  if (!exists(pathForDomain(domain, `certificate.crt`))) {
    debug(`Can't find certificate file for ${ domain }, so it must be the first request for ${ domain }. Generating and caching ...`);
    await generateDomainCertificate(domain);
  }

  if (!options.skipHostsFile) {
    await currentPlatform.addDomainToHostFileIfMissing(domain);
  }

  debug(`Returning domain certificate`);
  return {
    key: readFile(domainKeyPath),
    cert: readFile(domainCertPath)
  };
}

export function hasCertificateFor(domain: string) {
  return exists(pathForDomain(domain, `certificate.crt`));
}

export function configuredDomains() {
  return readdir(domainsDir);
}

export function removeDomain(domain: string) {
  return rimraf.sync(pathForDomain(domain));
}