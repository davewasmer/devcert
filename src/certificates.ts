import * as path from 'path';
import * as createDebug from 'debug';
import { unlinkSync as rm, chmodSync as chmod } from 'fs';
import { pathForDomain, opensslConfPath } from './constants';
import { openssl } from './utils';
import { fetchCertificateAuthorityCredentials } from './certificate-authority';

const debug = createDebug('devcert:certificates');

// Generate an app certificate signed by the devcert root CA
export default async function generateDomainCertificate(domain: string): Promise<void> {
  debug(`Generating private key for ${ domain }`);
  let keyPath = pathForDomain(domain, 'private-key.key');
  generateKey(keyPath);

  debug(`Generating certificate signing request for ${ domain }`);
  let csrFile = pathForDomain(domain, `${ domain }.csr`);
  openssl(`req -config ${ opensslConfPath } -subj "/CN=${ domain }" -key ${ keyPath } -out ${ csrFile } -new`);

  debug(`Generating certificate for ${ domain } from signing request and signing with root CA`);
  let certPath = pathForDomain(`${ domain }.crt`);
  let { rootKeyPath, rootCertPath } = await fetchCertificateAuthorityCredentials();
  openssl(`ca -config ${ opensslConfPath } -in ${ csrFile } -out ${ path.basename(certPath) } -outdir ${ path.dirname(certPath) } -keyfile ${ rootKeyPath } -cert ${ rootCertPath } -notext -md sha256 -days 7000 -batch -extensions server_cert`)

  rm(rootKeyPath);
  rm(rootCertPath);
}

// Generate a cryptographic key, used to sign certificates or certificate signing requests.
export function generateKey(filename: string): void {
  debug(`generateKey: ${ filename }`);
  openssl(`genrsa -out ${ filename } 2048`);
  chmod(filename, 400);
}