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
import { exec, execSync } from 'child_process';
import * as tmp from 'tmp';
import * as glob from 'glob';
import * as Configstore from 'configstore';
import * as mkdirp from 'mkdirp';
import * as createDebug from 'debug';
import * as eol from 'eol';
import { sync as commandExists } from 'command-exists';

const debug = createDebug('devcert');

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';

// use %LOCALAPPDATA%/devcert on Windows otherwise use ~/.config/devcert
let configDir: string;
if (isWindows && process.env.LOCALAPPDATA) {
  configDir = path.join(process.env.LOCALAPPDATA, 'devcert', 'config');
} else {
  let uid = process.getuid && process.getuid();
  let userHome = (isLinux && uid === 0) ? path.resolve('/usr/local/share') : require('os').homedir();
  configDir = path.join(userHome, '.config', 'devcert');
}
const configPath: (...pathSegments: string[]) => string = path.join.bind(path, configDir);

const opensslConfTemplate = path.join(__dirname, '..', 'openssl.conf');
const opensslConfPath = configPath('openssl.conf');
const rootKeyPath = configPath('devcert-ca-root.key');
const rootCertPath = configPath('devcert-ca-root.crt');
const caCertsDir = configPath('certs');

mkdirp.sync(configDir);
mkdirp.sync(caCertsDir);

export interface Options {
  installCertutil?: boolean;
}

export default async function devcert(appName: string, options: Options = {}) {
  debug(`development cert requested for ${ appName }`);

  // Fail fast on unsupported platforms (PRs welcome!)
  if (!isMac && !isLinux && !isWindows) {
    throw new Error(`devcert: "${ process.platform }" platform not supported`);
  }
  if (!commandExists('openssl')) {
    throw new Error('Unable to find openssl - make sure it is installed and available in your PATH');
  }

  let appKeyPath = configPath(`${ appName }.key`);
  let appCertPath = configPath(`${ appName }.crt`);

  if (!existsSync(rootCertPath)) {
    debug('devcert root CA not installed yet, must be first run; installing root CA ...');
    await installCertificateAuthority(options.installCertutil);
  }

  if (!existsSync(configPath(`${ appName }.crt`))) {
    debug(`first request for ${ appName } cert, generating and caching ...`);
    generateKey(configPath(`${ appName }.key`));
    generateSignedCertificate(appName, appKeyPath);
  }

  debug(`returning app cert`);
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
  debug(`generating openssl configuration`);
  let confTemplate = readFileSync(opensslConfTemplate, 'utf-8');
  confTemplate = confTemplate.replace(/DATABASE_PATH/, configPath('index.txt').replace('\\', '\\\\'));
  confTemplate = confTemplate.replace(/SERIAL_PATH/, configPath('serial').replace('\\', '\\\\'));
  confTemplate = eol.auto(confTemplate);
  writeFileSync(opensslConfPath, confTemplate);
  debug(`generating root certificate authority key`);
  generateKey(rootKeyPath);
  debug(`generating root certificate authority certificate`);
  execSync(`openssl req -config ${ opensslConfPath } -key ${ rootKeyPath } -out ${ rootCertPath } -new -subj "/CN=devcert" -x509 -days 7000 -extensions v3_ca`);
  debug(`adding root certificate authority to trust stores`)
  await addCertificateToTrustStores(installCertutil);
  writeFileSync(configPath('index.txt'), '');
  writeFileSync(configPath('serial'), '01');
}

// Generate a cryptographic key, used to sign certificates or certificate signing requests.
function generateKey(filename: string): void {
  debug(`generateKey: ${ filename }`);
  execSync(`openssl genrsa -out ${ filename } 2048`);
  chmodSync(filename, 400);
}

// Generate a certificate signed by the devcert root CA
function generateSignedCertificate(name: string, keyPath: string): void {
  debug(`generating certificate signing request for ${ name }`);
  let csrFile = configPath(`${ name }.csr`)
  execSync(`openssl req -config ${ opensslConfPath } -subj "/CN=${ name }" -key ${ keyPath } -out ${ csrFile } -new`);
  debug(`generating certificate for ${ name } from signing request; signing with devcert root CA`);
  let certPath = configPath(`${ name }.crt`);
  execSync(`openssl ca -config ${ opensslConfPath } -in ${ csrFile } -out ${ certPath } -outdir ${ caCertsDir } -keyfile ${ rootKeyPath } -cert ${ rootCertPath } -notext -md sha256 -days 7000 -batch -extensions server_cert`)
}

// Add the devcert root CA certificate to the trust stores for this machine. Adds to OS level trust
// stores, and where possible, to browser specific trust stores
async function addCertificateToTrustStores(installCertutil: boolean): Promise<void> {

  if (isMac) {
    // Chrome, Safari, system utils
    debug('adding devcert root CA to macOS system keychain');
    execSync(`sudo security add-trusted-cert -r trustRoot -k /Library/Keychains/System.keychain -p ssl "${ rootCertPath }"`);
    // Firefox
    try {
      // Try to use certutil to install the cert automatically
      debug('adding devcert root CA to firefox');
      addCertificateToNSSCertDB('~/Library/Application Support/Firefox/Profiles/*', installCertutil);
    } catch (e) {
      // Otherwise, open the cert in Firefox to install it
      await openCertificateInFirefox('/Applications/Firefox.app/Contents/MacOS/firefox');
    }

  } else if (isLinux) {
    // system utils
    debug('adding devcert root CA to linux system-wide certificates');
    execSync(`sudo cp ${ rootCertPath } /etc/ssl/certs/devcert.pem`);
    execSync(`sudo cp ${ rootCertPath } /usr/local/share/ca-certificates/devcert.cer`);
    execSync(`sudo update-ca-certificates`);
    // Firefox
    try {
      // Try to use certutil to install the cert automatically
      debug('adding devcert root CA to firefox');
      addCertificateToNSSCertDB('~/.mozilla/firefox/*', installCertutil);
    } catch (e) {
      // Otherwise, open the cert in Firefox to install it
      await openCertificateInFirefox('firefox');
    }
    // Chrome
    try {
      debug('adding devcert root CA to chrome');
      addCertificateToNSSCertDB('~/.pki/nssdb', installCertutil);
    } catch (e) {
      console.warn('WARNING: Because you did not pass in `installCertutil` to devcert, we are unable to update Chrome to respect generated development certificates. The certificates will work, but Chrome will continue to warn you that they are untrusted.');
    }

  // Windows
  } else if (isWindows) {
    // IE, Chrome, system utils
    debug('adding devcert root to Windows OS trust store')
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
      debug(`Found legacy NSS database in ${ potentialNSSDBDir }, adding devcert ...`)
      execSync(`${ certutilPath } -A -d ${ potentialNSSDBDir } -t 'C,,' -i ${ rootCertPath }`);
    } else if (existsSync(path.join(potentialNSSDBDir, 'cert9.db'))) {
      debug(`Found modern NSS database in ${ potentialNSSDBDir }, adding devcert ...`)
      execSync(`${ certutilPath } -A -d sql:${ potentialNSSDBDir } -t 'C,,' -i ${ rootCertPath }`);
    }
  });
}

// Launch a web server and open the root cert in Firefox. Useful for when certutil isn't available
async function openCertificateInFirefox(firefoxPath: string): Promise<void> {
  debug('adding devert to firefox manually - launch webserver for certificate hosting');
  let port = await getPort();
  let server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-type': 'application/x-x509-ca-cert' });
    res.write(readFileSync(rootCertPath));
    res.end();
  }).listen(port);
  debug('certificate is hosted, starting firefox at hosted URL');
  await new Promise((resolve) => {
    console.log(`Unable to automatically install SSL certificate - please follow the prompts at http://localhost:${ port } in Firefox to trust the root certificate`);
    console.log('See https://github.com/davewasmer/devcert#how-it-works for more details');
    console.log('-- Press <Enter> once you finish the Firefox prompts --');
    exec(`${ firefoxPath } http://localhost:${ port }`);
    process.stdin.resume();
    process.stdin.on('data', resolve);
  });
}

// Try to install certutil if it's not already available, and return the path to the executable
function lookupOrInstallCertutil(options: Options): boolean | string {
  debug('looking for nss tooling ...')
  if (isMac) {
    debug('on mac, looking for homebrew (the only method for install nss supported by devcert');
    if (commandExists('brew')) {
      let nssPath: string;
      try {
        let certutilPath = path.join(execSync('brew --prefix nss').toString(), 'bin', 'certutil');
        debug(`Found nss installed at ${ certutilPath }`);
        return certutilPath;
      } catch (e) {
        debug('brew was found, but nss is not installed');
        if (options.installCertutil) {
          debug('attempting to install nss via brew');
          execSync('brew install nss');
          return path.join(execSync('brew --prefix nss').toString(), 'bin', 'certutil');
        }
      }
    }
  } else if (isLinux) {
    debug('on linux, checking is nss is already installed');
    if (!commandExists('certutil')) {
      if (options.installCertutil) {
        debug('not already installed, installing it ourselves');
        execSync('sudo apt install libnss3-tools');
      } else {
        debug('not installed and do not want to install');
        return false;
      }
    }
    debug('looks like nss is installed');
    return execSync('which certutil').toString();
  }
  return false;
}
