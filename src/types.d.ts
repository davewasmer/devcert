/// <reference types="node-forge" />
declare module "command-exists";
declare module "eol";
declare module "sudo-prompt";
declare module "password-prompt";
declare module "application-config-path" {
  export = (appName: string) => string;
}

/**
 * The @types/node-forge package is missing these definitions.
 */
declare module "node-forge" {
  namespace random {
    function getBytes(numBytes: int, callback: (err: Error, bytes: Bytes) => any): Bytes;
  }
  namespace pki {
    interface CertificateAuthorityStore {
      addCertificate: (cert: Certificate) => void;
    }
    function createCertificationRequest(): Certificate;
    function createCaStore(): CertificateAuthorityStore;
    function verifyCertificateChain(caStore: CertificateAuthorityStore, certs: Certificate[]): void;
  }
}