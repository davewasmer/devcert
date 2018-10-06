// import path from 'path';
import createDebug from 'debug';
import { unlinkSync as rm } from 'fs';
import { sync as mkdirp } from 'mkdirp';
import { pathForDomain } from './constants';
import { generateCertificateWithCA, generateKey, mktmp } from './utils';
import { withCertificateAuthorityCredentials } from './certificate-authority';

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

  debug(`Generating key pair for ${ domain }`);
  let domainPublicKeyPath = mktmp();
  let domainPrivateKeyPath = pathForDomain(domain, 'private-key.key')
  await generateKey(domainPrivateKeyPath, domainPublicKeyPath);

  debug(`Generating certificate for ${ domain } and signing with root CA`);
  let domainCertPath = pathForDomain(domain, `certificate.crt`);

  await withCertificateAuthorityCredentials(({ caKeyPath, caCertPath }) => 
     generateCertificateWithCA(domain, domainCertPath, domainPublicKeyPath, domainPrivateKeyPath, caKeyPath, caCertPath)
    );
  rm(domainPublicKeyPath);
}

