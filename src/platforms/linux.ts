import path from 'path';
import { existsSync as exists, readFileSync as read } from 'fs';
import createDebug from 'debug';
import { sync as commandExists } from 'command-exists';
import { exec as sudo } from 'sudo-prompt';
import { run } from '../utils';
import { addCertificateToNSSCertDB, openCertificateInFirefox, closeFirefox } from './shared';
import { Options } from '../index';
import { Platform } from '.';

const debug = createDebug('devcert:platforms:linux');

export default class LinuxPlatform implements Platform {

  private FIREFOX_NSS_DIR = path.join(process.env.HOME, '.mozilla/firefox/*');
  private CHROME_NSS_DIR = path.join(process.env.HOME, '.pki/nssdb');
  private FIREFOX_BIN_PATH = '/usr/bin/firefox';
  private CHROME_BIN_PATH = '/usr/bin/google-chrome';

  private HOST_FILE_PATH = '/etc/hosts';

  /**
   * Linux is surprisingly difficult. There seems to be multiple system-wide
   * repositories for certs, so we copy ours to each. However, Firefox does it's
   * usual separate trust store. Plus Chrome relies on the NSS tooling (like
   * Firefox), but uses the user's NSS database, unlike Firefox (which uses a
   * separate Mozilla one). And since Chrome doesn't prompt the user with a GUI
   * flow when opening certs, if we can't use certutil to install our certificate
   * into the user's NSS database, we're out of luck.
   */
  async addToTrustStores(certificatePath: string, options: Options = {}): Promise<void> {

    debug('Adding devcert root CA to Linux system-wide trust stores');
    run(`sudo cp ${ certificatePath } /etc/ssl/certs/devcert.pem`);
    run(`sudo cp ${ certificatePath } /usr/local/share/ca-certificates/devcert.cer`);
    run(`sudo update-ca-certificates`);

    if (this.isFirefoxInstalled()) {
      // Firefox
      debug('Firefox install detected: adding devcert root CA to Firefox-specific trust stores ...');
      if (!commandExists('certutil')) {
        if (options.skipCertutilInstall) {
          debug('NSS tooling is not already installed, and `skipCertutil` is true, so falling back to manual certificate install for Firefox');
          openCertificateInFirefox(this.FIREFOX_BIN_PATH, certificatePath);
        } else {
          debug('NSS tooling is not already installed. Trying to install NSS tooling now with `apt install`');
          run('sudo apt install libnss3-tools');
          debug('Installing certificate into Firefox trust stores using NSS tooling');
          await closeFirefox();
          await addCertificateToNSSCertDB(this.FIREFOX_NSS_DIR, certificatePath, 'certutil');
        }
      }
    } else {
      debug('Firefox does not appear to be installed, skipping Firefox-specific steps...');
    }

    if (this.isChromeInstalled()) {
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
        await addCertificateToNSSCertDB(this.CHROME_NSS_DIR, certificatePath, 'certutil');
      }
    } else {
      debug('Chrome does not appear to be installed, skipping Chrome-specific steps...');
    }
  }

  addDomainToHostFileIfMissing(domain: string) {
    let hostsFileContents = read(this.HOST_FILE_PATH, 'utf8');
    if (!hostsFileContents.includes(domain)) {
      // Shell out to append the file so the subshell can prompt for sudo
      sudo(`bash -c "echo '127.0.0.1  ${ domain }' >> ${ this.HOST_FILE_PATH }"`, { name: 'devcert' });
    }
  }

  private isFirefoxInstalled() {
    return exists(this.FIREFOX_BIN_PATH);
  }

  private isChromeInstalled() {
    return exists(this.CHROME_BIN_PATH);
  }

}