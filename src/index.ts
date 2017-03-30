import {
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  existsSync
} from 'fs';
import * as path from 'path';
import * as getPort from 'get-port';
import * as http from 'http';
import { execSync } from 'child_process';
import * as tmp from 'tmp';
import * as glob from 'glob';
import * as Configstore from 'configstore';
import { sync as commandExists } from 'command-exists';

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';

// use %LOCALAPPDATA%/Yarn on Windows otherwise use ~/.config/yarn
let configDir: string;
if (isWindows && process.env.LOCALAPPDATA) {
  configDir = path.join(process.env.LOCALAPPDATA, 'Yarn', 'config');
} else {
  let uid = process.getuid && process.getuid();
  let userHome = (isLinux && uid === 0) ? path.resolve('/usr/local/share') : require('os').homedir();
  configDir = path.join(userHome, '.config', 'yarn');
}
const configPath: (...pathSegments: string[]) => string = path.join.bind(path, configDir);

const opensslConfPath = path.join(__dirname, '..', 'openssl.conf');
const rootKeyPath = configPath('devcert-ca-root.key');
const rootCertPath = configPath('devcert-ca-root.crt');

export interface Options {
  installCertutil?: boolean;
}

export default async function devcert(appName: string, options: Options = {}) {

  // Fail fast on unsupported platforms (PRs welcome!)
  if (!isMac && !isLinux && !isWindows) {
    throw new Error(`devcert: "${ process.platform }" platform not supported`);
  }
  if (!commandExists('openssl')) {
    throw new Error('Unable to find openssl - make sure it is installed and available in your PATH');
  }

  let appKeyPath = configPath(`${ appName }.key`);
  let appCertPath = configPath(`${ appName }.crt`);

  if (!existsSync(rootKeyPath)) {
    await installCertificateAuthority(options.installCertutil);
  }

  if (!existsSync(configPath(`${ appName }.key`))) {
    generateKey(appName);
    generateSignedCertificate(appName, appKeyPath);
  }

  return {
    keyPath: appKeyPath,
    certPath: appCertPath,
    key: readFileSync(appKeyPath),
    cert: readFileSync(appCertPath)
  };

}

// Install the once-per-machine trusted root CA. We'll use this CA to sign per-app certs, allowing
// us to minimize the need for elevated permissions while still allowing for per-app certificates.
async function installCertificateAuthority(installCertutil: boolean): Promise<void> {
  let rootKeyPath = generateKey('devcert-ca-root');
  execSync(`openssl req -config ${ opensslConfPath } -key ${ rootKeyPath } -out ${ rootCertPath } -new -subj '/CN=devcert' -x509 -days 7000 -extensions v3_ca`);
  await addCertificateToTrustStores(installCertutil);
}

// Generate a cryptographic key, used to sign certificates or certificate signing requests.
function generateKey(name: string): void {
  let filename = configPath(`${ name }.key`);
  execSync(`openssl genrsa -out ${ filename } 2048`);
  chmodSync(filename, 400);
}

// Generate a certificate signed by the devcert root CA
function generateSignedCertificate(name: string, keyPath: string): void {
  let csrFile = configPath(`${ name }.csr`)
  execSync(`openssl req -config ${ opensslConfPath } -subj '/CN=${ name }' -key ${ keyPath } -out ${ csrFile } -new`);
  let certPath = configPath(`${ name }.crt`);
  execSync(`openssl ca -config ${ opensslConfPath } -in ${ csrFile } -out ${ certPath } -keyfile ${ rootKeyPath } -cert ${ rootCertPath } -notext -md sha256 -days 7000 -extensions server_cert`)
}

// Add the devcert root CA certificate to the trust stores for this machine. Adds to OS level trust
// stores, and where possible, to browser specific trust stores
async function addCertificateToTrustStores(installCertutil: boolean): Promise<void> {

  if (isMac) {
    // Chrome, Safari, system utils
    execSync(`sudo security add-trusted-cert -r trustRoot -k /Library/Keychains/System.keychain -p ssl "${ rootCertPath }"`);
    // Firefox
    try {
      // Try to use certutil to install the cert automatically
      addCertificateToNSSCertDB('~/Library/Application Support/Firefox/Profiles/*', installCertutil);
    } catch (e) {
      // Otherwise, open the cert in Firefox to install it
      await openCertificateInFirefox('/Applications/Firefox.app/Contents/MacOS/firefox');
    }

  } else if (isLinux) {
    // system utils
    execSync(`sudo cp ${ rootCertPath } /usr/local/share/ca-certificates/devcert.cer && update-ca-certificates`);
    // Firefox
    try {
      // Try to use certutil to install the cert automatically
      addCertificateToNSSCertDB('~/.mozilla/firefox/*', installCertutil);
    } catch (e) {
      // Otherwise, open the cert in Firefox to install it
      await openCertificateInFirefox('firefox');
    }
    // Chrome
    try {
      addCertificateToNSSCertDB('~/.pki/nssdb', installCertutil);
    } catch (e) {
      console.warn('WARNING: Because you did not pass in `installCertutil` to devcert, we are unable to update Chrome to respect generated development certificates. The certificates will work, but Chrome will continue to warn you that they are untrusted.');
    }

  // Windows
  } else if (isWindows) {
    // IE, Chrome, system utils
    execSync(`certutil -addstore -user root ${ rootCertPath }`);
    // Firefox (don't even try NSS certutil, no easy install for Windows)
    await openCertificateInFirefox('start firefox');
  }

}

// Try to use certutil to add the root cert to an NSS database
function addCertificateToNSSCertDB(nssDirGlob: string, installCertutil: boolean): void {
  let certutilPath = lookupOrInstallCertutil(installCertutil);
  if (!certutilPath) {
    throw new Error('certutil not available, and `installCertutil` was false');
  }
  glob.sync(nssDirGlob).forEach((potentialNSSDBDir) => {
    if (existsSync(path.join(potentialNSSDBDir, 'cert8.db'))) {
      execSync(`${ certutilPath } -A -d ${ potentialNSSDBDir } -t 'C,,' -i ${ rootCertPath }`);
    } else if (existsSync(path.join(potentialNSSDBDir, 'cert9.db'))) {
      execSync(`${ certutilPath } -A -d sql:${ potentialNSSDBDir } -t 'C,,' -i ${ rootCertPath }`);
    }
  });
}

// Launch a web server and open the root cert in Firefox. Useful for when certutil isn't available
async function openCertificateInFirefox(firefoxPath: string): Promise<void> {
  let port = await getPort();
  let server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-type': 'application/x-x509-ca-cert' });
    res.write(readFileSync(rootCertPath));
    res.end();
  }).listen(port);
  execSync(`${ firefoxPath } http://localhost:${ port }`);
  await new Promise((resolve) => {
    console.log('Unable to automatically install SSL certificate - please follow the prompts in Firefox to trust the root certificate');
    console.log('See https://github.com/davewasmer/devcert#how-it-works for more details');
    process.stdin.resume();
    process.stdin.on('data', resolve);
  });
}

// Try to install certutil if it's not already available, and return the path to the executable
function lookupOrInstallCertutil(options: Options): boolean | string {
  if (isMac) {
    if (commandExists('brew')) {
      let nssPath: string;
      try {
        return path.join(execSync('brew --prefix nss').toString(), 'bin', 'certutil');
      } catch (e) {
        if (options.installCertutil) {
          execSync('brew install nss');
          return path.join(execSync('brew --prefix nss').toString(), 'bin', 'certutil');
        }
      }
    }
  } else if (isLinux) {
    if (!commandExists('certutil')) {
      if (options.installCertutil) {
        execSync('sudo apt install libnss3-tools');
      } else {
        return false;
      }
    }
    return execSync('which certutil').toString();
  }
  return false;
}
