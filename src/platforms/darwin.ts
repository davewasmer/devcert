import path from 'path';
import { writeFileSync as writeFile, existsSync as exists, readFileSync as read } from 'fs';
import createDebug from 'debug';
import { sync as commandExists } from 'command-exists';
import { isDomainInHostFile, run } from '../utils';
import { Options } from '../index';
import { addCertificateToNSSCertDB, openCertificateInFirefox, closeFirefox } from './shared';
import { Platform } from '.';

const debug = createDebug('devcert:platforms:macos');


export default class MacOSPlatform implements Platform {

  private FIREFOX_BUNDLE_PATH = '/Applications/Firefox.app';
  private FIREFOX_BIN_PATH = path.join(this.FIREFOX_BUNDLE_PATH, 'Contents/MacOS/firefox');
  private FIREFOX_NSS_DIR = path.join(process.env.HOME, 'Library/Application Support/Firefox/Profiles/*');

  private HOST_FILE_PATH = '/etc/hosts';

  /**
   * macOS is pretty simple - just add the certificate to the system keychain,
   * and most applications will delegate to that for determining trusted
   * certificates. Firefox, of course, does it's own thing. We can try to
   * automatically install the cert with Firefox if we can use certutil via the
   * `nss` Homebrew package, otherwise we go manual with user-facing prompts.
   */
  async addToTrustStores(certificatePath: string, options: Options = {}): Promise<void> {

    // Chrome, Safari, system utils
    debug('Adding devcert root CA to macOS system keychain');
    run(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain -p ssl -p basic "${ certificatePath }"`);

    if (this.isFirefoxInstalled()) {
      // Try to use certutil to install the cert automatically
      debug('Firefox install detected. Adding devcert root CA to Firefox trust store');
      if (!this.isNSSInstalled()) {
        if (!options.skipCertutilInstall) {
          if (commandExists('brew')) {
            debug(`certutil is not already installed, but Homebrew is detected. Trying to install certutil via Homebrew...`);
            run('brew install nss');
          } else {
            debug(`Homebrew isn't installed, so we can't try to install certutil. Falling back to manual certificate install`);
            return await openCertificateInFirefox(this.FIREFOX_BIN_PATH, certificatePath);
          }
        } else {
          debug(`certutil is not already installed, and skipCertutilInstall is true, so we have to fall back to a manual install`)
          return await openCertificateInFirefox(this.FIREFOX_BIN_PATH, certificatePath);
        }
      }
      let certutilPath = path.join(run('brew --prefix nss').toString().trim(), 'bin', 'certutil');
      await closeFirefox();
      await addCertificateToNSSCertDB(this.FIREFOX_NSS_DIR, certificatePath, certutilPath);
    } else {
      debug('Firefox does not appear to be installed, skipping Firefox-specific steps...');
    }
  }

  async addDomainToHostFileIfMissing(domain: string) {
    let hostsFileContents = read(this.HOST_FILE_PATH, 'utf8');
    if (!isDomainInHostFile(hostsFileContents, domain)) {
      run(`echo '\n127.0.0.1 ${ domain }' | sudo tee -a "${ this.HOST_FILE_PATH }" > /dev/null`);
    }
  }

  async readProtectedFile(filepath: string) {
    return (await run(`sudo cat "${filepath}"`)).toString().trim();
  }

  async writeProtectedFile(filepath: string, contents: string) {
    if (exists(filepath)) {
      await run(`sudo rm "${filepath}"`);
    }
    writeFile(filepath, contents);
    await run(`sudo chown 0 "${filepath}"`);
    await run(`sudo chmod 600 "${filepath}"`);
  }

  private isFirefoxInstalled() {
    return exists(this.FIREFOX_BUNDLE_PATH);
  }

  private isNSSInstalled() {
    try {
      return run('brew list -1').toString().includes('\nnss\n');
    } catch (e) {
      return false;
    }
  }

};
