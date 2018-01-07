import * as path from 'path';
import { existsSync as exists } from 'fs';
import * as createDebug from 'debug';
import { sync as commandExists } from 'command-exists';
import { run } from '../utils';
import { addCertificateToNSSCertDB, openCertificateInFirefox, closeFirefox } from './shared';
import { Options } from '../index';

const debug = createDebug('devcert:platforms:linux');

const FIREFOX_NSS_DIR = path.join(process.env.HOME, '.mozilla/firefox/*');
const CHROME_NSS_DIR = path.join(process.env.HOME, '.pki/nssdb');
const FIREFOX_BIN_PATH = '/usr/bin/firefox';
const CHROME_BIN_PATH = '/usr/bin/google-chrome';

/**
 * Linux is surprisingly difficult. There seems to be multiple system-wide
 * repositories for certs, so we copy ours to each. However, Firefox does it's
 * usual separate trust store. Plus Chrome relies on the NSS tooling (like
 * Firefox), but uses the user's NSS database, unlike Firefox (which uses a
 * separate Mozilla one). And since Chrome doesn't prompt the user with a GUI
 * flow when opening certs, if we can't use certutil to install our certificate
 * into the user's NSS database, we're out of luck.
 */
export default async function addToLinuxTrustStores(certificatePath: string, options: Options = {}): Promise<void> {

  debug('Adding devcert root CA to Linux system-wide trust stores');
  run(`sudo cp ${ certificatePath } /etc/ssl/certs/devcert.pem`);
  run(`sudo cp ${ certificatePath } /usr/local/share/ca-certificates/devcert.cer`);
  run(`sudo update-ca-certificates`);

  if (isFirefoxInstalled()) {
    // Firefox
    debug('Firefox install detected: adding devcert root CA to Firefox-specific trust stores ...');
    if (!commandExists('certutil')) {
      if (options.skipCertutilInstall) {
        debug('NSS tooling is not already installed, and `skipCertutil` is true, so falling back to manual certificate install for Firefox');
        openCertificateInFirefox(FIREFOX_BIN_PATH, certificatePath);
      } else {
        debug('NSS tooling is not already installed. Trying to install NSS tooling now with `apt install`');
        run('sudo apt install libnss3-tools');
        debug('Installing certificate into Firefox trust stores using NSS tooling');
        await closeFirefox();
        await addCertificateToNSSCertDB(FIREFOX_NSS_DIR, certificatePath, 'certutil');
      }
    }
  } else {
    debug('Firefox does not appear to be installed, skipping Firefox-specific steps...');
  }

  if (isChromeInstalled()) {
    debug('Chrome install detected: adding devcert root CA to Chrome trust store ...');
    if (!commandExists('certutil')) {
      console.warn(`
        WARNING: It looks like you have Chrome installed, but you specified
        'skipCertutilInstall: true'. Unfortunately, without installing
        certutil, it's impossible get Chrome to trust devcert's certificates
        The certificates will work, but Chrome will continue to warn you that
        they are untrusted.
      `);
    } else {
      await closeFirefox();
      await addCertificateToNSSCertDB(CHROME_NSS_DIR, certificatePath, 'certutil');
    }
  } else {
    debug('Chrome does not appear to be installed, skipping Chrome-specific steps...');
  }
}

function isFirefoxInstalled() {
  return exists(FIREFOX_BIN_PATH);
}

function isChromeInstalled() {
  return exists(CHROME_BIN_PATH);
}