import * as createDebug from 'debug';
import { run } from '../utils';
import { Options } from '../index';
import { openCertificateInFirefox } from './shared';

const debug = createDebug('devcert:platforms:windows');

/**
 * Windows is at least simple. Like macOS, most applications will delegate to
 * the system trust store, which is updated with the confusingly named
 * `certutil` exe (not the same as the NSS/Mozilla certutil). Firefox does it's
 * own thing as usual, and getting a copy of NSS certutil onto the Windows
 * machine to try updating the Firefox store is basically a nightmare, so we
 * don't even try it - we just bail out to the GUI.
 */
export default async function addToWindowsTrustStores(certificatePath: string, options: Options = {}): Promise<void> {
  // IE, Chrome, system utils
  debug('adding devcert root to Windows OS trust store')
  run(`certutil -addstore -user root ${ certificatePath }`);
  // Firefox (don't even try NSS certutil, no easy install for Windows)
  await openCertificateInFirefox('start firefox', certificatePath);
}