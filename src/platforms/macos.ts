import * as path from 'path';
import { existsSync as exists } from 'fs';
import * as createDebug from 'debug';
import { sync as commandExists } from 'command-exists';
import { run } from '../utils';
import { Options } from '../index';
import { addCertificateToNSSCertDB, openCertificateInFirefox, closeFirefox } from './shared';

const debug = createDebug('devcert:platforms:macos');

const FIREFOX_BUNDLE_PATH = '/Applications/Firefox.app';
const FIREFOX_BIN_PATH = path.join(FIREFOX_BUNDLE_PATH, 'Contents/MacOS/firefox');
const FIREFOX_NSS_DIR = path.join(process.env.HOME, 'Library/Application Support/Firefox/Profiles/*');

/**
 * macOS is pretty simple - just add the certificate to the system keychain,
 * and most applications will delegate to that for determining trusted
 * certificates. Firefox, of course, does it's own thing. We can try to
 * automatically install the cert with Firefox if we can use certutil via the
 * `nss` Homebrew package, otherwise we go manual with user-facing prompts.
 */
export default async function addToMacTrustStores(certificatePath: string, options: Options = {}): Promise<void> {

  // Chrome, Safari, system utils
  debug('Adding devcert root CA to macOS system keychain');
  run(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain -p ssl -p basic "${ certificatePath }"`);

  if (isFirefoxInstalled()) {
    // Try to use certutil to install the cert automatically
    debug('Firefox install detected. Adding devcert root CA to Firefox trust store');
    if (!isNSSInstalled()) {
      if (!options.skipCertutilInstall) {
        if (commandExists('brew')) {
          debug(`certutil is not already installed, but Homebrew is detected. Trying to install certutil via Homebrew...`);
          run('brew install nss');
          let certutilPath = path.join(run('brew --prefix nss').toString().trim(), 'bin', 'certutil');
          await closeFirefox();
          await addCertificateToNSSCertDB(FIREFOX_NSS_DIR, certificatePath, certutilPath);
        } else {
          debug(`Homebrew isn't installed, so we can't try to install certutil. Falling back to manual certificate install`);
          return await openCertificateInFirefox(FIREFOX_BIN_PATH, certificatePath);
        }
      } else {
        debug(`certutil is not already installed, and skipCertutilInstall is true, so we have to fall back to a manual install`)
        return await openCertificateInFirefox(FIREFOX_BIN_PATH, certificatePath);
      }
    }
  }
}

function isFirefoxInstalled() {
  return exists(FIREFOX_BUNDLE_PATH);
}

function isNSSInstalled() {
  try {
    return run('brew --prefix nss') && true;
  } catch (e) {
    return false;
  }
}