import { execSync, ExecSyncOptions } from 'child_process';
import tmp from 'tmp';
import createDebug from 'debug';
import sudoPrompt from 'sudo-prompt';
import { promisify } from 'util';
import {
  readFile as readFileAsync,
  writeFile as writeFileAsync
} from 'fs';
import {pki, md, random } from 'node-forge';
import { defaultDays } from './constants';

const forgeGenerateRSAKey = promisify(pki.rsa.generateKeyPair);
const forgeGetRandomBytes = promisify(random.getBytes);
const readFile = promisify(readFileAsync);
const writeFile = promisify(writeFileAsync);

const debug = createDebug('devcert:util');

async function getKeysFromPemFiles(privateKeyFile: string, publicKeyFile?: string): Promise<{ privateKey: string, publicKey: string }> {
  return {
    privateKey: pki.privateKeyFromPem(await readFile(privateKeyFile, 'utf8')),
    publicKey: publicKeyFile ? pki.publicKeyFromPem(await readFile(publicKeyFile, 'utf8')) : ''
  };
}

// Create a random serial number conforming to spec.
async function createSerial(): Promise<string> {
  const randBuf = Buffer.from(await forgeGetRandomBytes(9), 'binary');
  // X.509 serial numbers must be positive ASN.1 INTEGERS. ASN.1 uses one's
  // complement representation, and JS is two's complement. That means the most
  // significant bit of our JS buffer must be 0. Do this by ensuring the first
  // byte is below 0x80 (128, or 1000 in binary).
  randBuf[0] = randBuf[0] % 0x80;
  return randBuf.toString('hex');
}

// Create a self-signed root certificate, to be used as the authority for
// domain certificates to be generated.
// Equivalent of:
//
//  openssl(`req -new -x509 -config "${ caSelfSignConfig }" -key "${ rootKeyPath }" -out "${ rootCertPath }"`);
export async function generateCACertificate(
  rootPrivateKeyPath: string,
  rootPublicKeyPath: string,
  rootCertPath: string
) {
  const { privateKey, publicKey } = await getKeysFromPemFiles(rootPrivateKeyPath, rootPublicKeyPath);
  const cert = pki.createCertificate();
  cert.serialNumber = await createSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(
    cert.validity.notBefore.getTime() + defaultDays
  );

  cert.publicKey = publicKey;
  const attrs = [
    {
      name: 'commonName',
      value: 'devcert'
    }
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    {
      name: 'subjectKeyIdentifier'
    },
    {
      name: 'basicConstraints',
      critical: true,
      cA: true,
      pathLenConstraint: 0
    },
    {
      name: 'keyUsage',
      critical: true,
      dataEncipherment: true,
      digitalSignature: true,
      keyCertSign: true,
      keyEncipherment: true,
      nonRepudiation: true
    }
  ]);

  cert.sign(privateKey, md.sha256.create());
  await writeFile(rootCertPath, pki.certificateToPem(cert));
}

// Generate a certificate for a particular domain, using a CSR and the root CA.
// Equivalent to:
//
//  openssl(`ca -config "${ domainCertConfigPath }" -in "${ csrFile }" -out "${ domainCertPath }" -keyfile "${ caKeyPath }" -cert "${ caCertPath }" -days 7000 -batch`)
export async function generateCertificateWithCA(
  domain: string,
  domainCertPath: string,
  domainPublicKeyPath: string,
  domainPrivateKeyPath: string,
  caPrivateKeyPath: string,
  caCertPath: string
): Promise<void> {
  const { privateKey, publicKey } = await getKeysFromPemFiles(domainPrivateKeyPath, domainPublicKeyPath);
  
  const { privateKey: caPrivateKey } = await getKeysFromPemFiles(caPrivateKeyPath);

  const rootCa = pki.certificateFromPem(await readFile(caCertPath, 'utf8'));

  const csr = pki.createCertificationRequest();
  csr.publicKey = publicKey;
  csr.setSubject([{
    name: 'commonName',
    value: domain
  }]);
  csr.sign(privateKey, md.sha256.create());
  
  const cert = pki.createCertificate();
  cert.serialNumber = await createSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(
    cert.validity.notBefore.getTime() + defaultDays
  );
  cert.publicKey = csr.publicKey;
  cert.setSubject(csr.subject.attributes);
  cert.setIssuer(rootCa.subject.attributes);
  cert.setExtensions([
    {
      name: 'basicConstraints',
      critical: true,
      cA: false
    },
    {
      name: 'subjectKeyIdentifier'
    },
    {
      name: 'keyUsage',
      critical: true,
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: 'extKeyUsage',
      serverAuth: true
    },
    {
      name: 'subjectAltName',
      altNames: [
        {
          type: 2,
          value: `*.${domain}`
        },
        {
          type: 2,
          value: domain
        },
        {
          type: 6,
          value: `https://${domain}/`
        }
      ]
    }
  ]);
  cert.sign(caPrivateKey, md.sha256.create());
  
  const caStore = pki.createCaStore();
  caStore.addCertificate(rootCa);
  try {
    pki.verifyCertificateChain(caStore, [cert, rootCa]);
  } catch (e) {
      if (e instanceof Error) {
        throw e;
      }
      throw new Error(JSON.stringify(e, null, 2));
  }
  await writeFile(domainCertPath, pki.certificateToPem(cert));
}

// Generate a cryptographic key, used to sign certificates or certificate signing requests.
// Equivalent of:
//
//  openssl(`genrsa -out "${ filename }" 2048`);
export async function generateKey(
  privateKeyPath: string,
  publicKeyPath: string
): Promise<void> {
  debug(`generateKey: ${privateKeyPath}`);
  const keyPair: pki.KeyPair = await forgeGenerateRSAKey({ bits: 2048 });
  const privateKeyPEM: string = pki.privateKeyToPem(keyPair.privateKey);
  await writeFile(privateKeyPath, privateKeyPEM, { mode: 0o400 });
  const publicKeyPEM: string = pki.publicKeyToPem(keyPair.publicKey);
  await writeFile(publicKeyPath, publicKeyPEM, { mode: 0o400 });
}

export function run(cmd: string, options: ExecSyncOptions = {}) {
  debug(`exec: \`${ cmd }\``);
  return execSync(cmd, options);
}

export function waitForUser() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.on('data', resolve);
  });
}

export function reportableError(message: string) {
  return new Error(`${message} | This is a bug in devcert, please report the issue at https://github.com/davewasmer/devcert/issues`);
}

export function mktmp() {
  // discardDescriptor because windows complains the file is in use if we create a tmp file
  // and then shell out to a process that tries to use it
  return tmp.fileSync({ discardDescriptor: true }).name;
}

export function sudo(cmd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    sudoPrompt.exec(cmd, { name: 'devcert' }, (err: Error | null, stdout: string | null, stderr: string | null) => {
      let error = err || (typeof stderr === 'string' && stderr.trim().length > 0 && new Error(stderr)) ;
      error ? reject(error) : resolve(stdout);
    });
  });
}