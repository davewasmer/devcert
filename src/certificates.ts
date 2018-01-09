import * as path from 'path';
import * as createDebug from 'debug';
import { sync as mkdirp } from 'mkdirp';
import { unlinkSync as rm, chmodSync as chmod } from 'fs';
import { pathForDomain, opensslConfPath } from './constants';
import { openssl } from './utils';
import { fetchCertificateAuthorityCredentials } from './certificate-authority';

const debug = createDebug('devcert:certificates');

/**
 * Generate a domain certificate signed by the devcert root CA. Domain
 * certificates are cached in their own directories under
 * CONFIG_ROOT/domains/<domain>, and reused on subsequent requests. Because the
 * individual domain certificates are signed by the devcert root CA (which was
 * added to the OS/browser trust stores), they are trusted.
 */
export default async function generateDomainCertificate(domain: string): Promise<void> {
  mkdirp(pathForDomain(domain));

  debug(`Generating private key for ${ domain }`);
  let keyPath = pathForDomain(domain, 'private-key.key');
  generateKey(keyPath);

  debug(`Generating certificate signing request for ${ domain }`);
  let csrFile = pathForDomain(domain, `certificate-signing-request.csr`);
  openssl(`req -config ${ opensslConfPath } -subj "/CN=${ domain }" -key ${ keyPath } -out ${ csrFile } -new`);

  debug(`Generating certificate for ${ domain } from signing request and signing with root CA`);
  let certPath = pathForDomain(domain, `certificate.crt`);
  let { decryptedCAKeyPath, decryptedCACertPath } = await fetchCertificateAuthorityCredentials();
  openssl(`ca -config ${ opensslConfPath } -in ${ csrFile } -out ${ path.basename(certPath) } -outdir ${ path.dirname(certPath) } -keyfile ${ decryptedCAKeyPath } -cert ${ decryptedCACertPath } -notext -md sha256 -days 7000 -batch -extensions server_cert`)

  rm(decryptedCAKeyPath);
  rm(decryptedCACertPath);
}

// Generate a cryptographic key, used to sign certificates or certificate signing requests.
export function generateKey(filename: string): void {
  debug(`generateKey: ${ filename }`);
  openssl(`genrsa -out ${ filename } 2048`);
  chmod(filename, 400);
}