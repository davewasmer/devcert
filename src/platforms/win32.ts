import createDebug from 'debug';
import sudoPrompt from 'sudo-prompt';
import { readFileSync as read, copyFileSync as copy } from 'fs';
import { Options } from '../index';
import { openCertificateInFirefox } from './shared';
import { Platform } from '.';

const debug = createDebug('devcert:platforms:windows');

export default class WindowsPlatform implements Platform {

  private HOST_FILE_PATH = 'C:\\Windows\\System32\\Drivers\\etc\\hosts';

  /**
   * Windows is at least simple. Like macOS, most applications will delegate to
   * the system trust store, which is updated with the confusingly named
   * `certutil` exe (not the same as the NSS/Mozilla certutil). Firefox does it's
   * own thing as usual, and getting a copy of NSS certutil onto the Windows
   * machine to try updating the Firefox store is basically a nightmare, so we
   * don't even try it - we just bail out to the GUI.
   */
  async addToTrustStores(certificatePath: string, options: Options = {}): Promise<void> {
    // IE, Chrome, system utils
    debug('adding devcert root to Windows OS trust store')
    copy(certificatePath, './certificate.cert');
    await this.sudo(`certutil -addstore -user root ${ certificatePath }`);
    debug('adding devcert root to Firefox trust store')
    // Firefox (don't even try NSS certutil, no easy install for Windows)
    await openCertificateInFirefox('start firefox', certificatePath);
  }

  async addDomainToHostFileIfMissing(domain: string) {
    let hostsFileContents = read(this.HOST_FILE_PATH, 'utf8');
    if (!hostsFileContents.includes(domain)) {
      this.sudo(`echo '127.0.0.1  ${ domain }' > ${ this.HOST_FILE_PATH }`);
    }
  }

  sudo(cmd: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      sudoPrompt.exec(cmd, { name: 'devcert' }, (err: Error | null, stdout: string | null, stderr: string | null) => {
        let error = err || (typeof stderr === 'string' && stderr.trim().length > 0 && new Error(stderr)) ;
        error ? reject(error) : resolve(stdout);
      });
    });
  }


}