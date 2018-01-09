import * as path from 'path';
import * as createDebug from 'debug';
import * as assert from 'assert';
import * as getPort from 'get-port';
import * as http from 'http';
import { sync as glob } from 'glob';
import { readFileSync as readFile, existsSync as exists } from 'fs';
import { run, waitForUser } from '../utils';
import { isMac, isLinux } from '../constants';
import { execSync as exec } from 'child_process';

const debug = createDebug('devcert:platforms:shared');

/**
 *  Given a directory or glob pattern of directories, attempt to install the
 *  CA certificate to each directory containing an NSS database.
 */
export async function addCertificateToNSSCertDB(nssDirGlob: string, certPath: string, certutilPath: string): Promise<void> {
  debug(`trying to install certificate into NSS databases in ${ nssDirGlob }`);
  glob(nssDirGlob).forEach((potentialNSSDBDir) => {
    debug(`checking to see if ${ potentialNSSDBDir } is a valid NSS database directory`);
    if (exists(path.join(potentialNSSDBDir, 'cert8.db'))) {
      debug(`Found legacy NSS database in ${ potentialNSSDBDir }, adding certificate ...`)
      run(`${ certutilPath } -A -d "${ potentialNSSDBDir }" -t 'C,,' -i ${ certPath } -n devcert`);
    } else if (exists(path.join(potentialNSSDBDir, 'cert9.db'))) {
      debug(`Found modern NSS database in ${ potentialNSSDBDir }, adding certificate ...`)
      run(`${ certutilPath } -A -d "sql:${ potentialNSSDBDir }" -t 'C,,' -i ${ certPath } -n devcert`);
    } else {
      debug(`${ potentialNSSDBDir } doesn't look like an NSS database directory, skipping ...`);
    }
  });
  debug(`finished scanning & installing certificate in NSS databases in ${ nssDirGlob }`);
}

/**
 *  Check to see if Firefox is still running, and if so, ask the user to close
 *  it. Poll until it's closed, then return.
 *
 * This is needed because Firefox appears to load the NSS database in-memory on
 * startup, and overwrite on exit. So we have to ask the user to quite Firefox
 * first so our changes don't get overwritten.
 */
export async function closeFirefox(): Promise<void> {
  if (isFirefoxOpen()) {
    console.log('Please close Firefox before continuing');
    // LEFT OFF: this appears to not be looping properly
    while(isFirefoxOpen()) {
      await sleep(50);
    }
  }
}

/**
 * Check if Firefox is currently open
 */
function isFirefoxOpen() {
  // NOTE: We use some Windows-unfriendly methods here (ps) because Windows
  // never needs to check this, because it doesn't update the NSS DB
  // automaticaly.
  assert(isMac || isLinux, 'checkForOpenFirefox was invoked on a platform other than Mac or Linux');
  return exec('ps aux').indexOf('firefox') > -1;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Firefox manages it's own trust store for SSL certificates, which can be
 * managed via the certutil command (supplied by NSS tooling packages). In the
 * event that certutil is not already installed, and either can't be installed
 * (Windows) or the user doesn't want to install it (skipCertutilInstall:
 * true), it means that we can't programmatically tell Firefox to trust our
 * root CA certificate.
 *
 * There is a recourse though. When a Firefox tab is directed to a URL that
 * responds with a certificate, it will automatically prompt the user if they
 * want to add it to their trusted certificates. So if we can't automatically
 * install the certificate via certutil, we instead start a quick web server
 * and host our certificate file. Then we open the hosted cert URL in Firefox
 * to kick off the GUI flow.
 *
 * This method does all this, along with providing user prompts in the terminal
 * to walk them through this process.
 */
export async function openCertificateInFirefox(firefoxPath: string, certPath: string): Promise<void> {
  debug('Adding devert to Firefox trust stores manually. Launching a webserver to host our certificate temporarily ...');
  let port = await getPort();
  let server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-type': 'application/x-x509-ca-cert' });
    res.write(readFile(certPath));
    res.end();
  }).listen(port);
  debug('Certificate server is up. Printing instructions for user and launching Firefox with hosted certificate URL');
  console.log(`
    devcert was unable to automatically configure Firefox. You'll need to
    complete this process manually. Don't worry though - Firefox will walk
    you through it.

    When you're ready, hit any key to continue. Firefox will launch and
    display a wizard to walk you through how to trust the devcert
    certificate. When you are finished, come back here and we'll finish up.

    (If Firefox doesn't start, go ahead and start it and navigate to
    http://localhost:${ port } in a new tab.)

    If you are curious about why all this is necessary, check out
    https://github.com/davewasmer/devcert#how-it-works

    <Press any key to launch Firefox wizard>
  `);
  run(`${ firefoxPath } http://localhost:${ port }`);
  console.log(`
    Launching Firefox ...

    Great! Once you've finished the Firefox wizard for adding the devcert
    certificate, just hit any key here again and we'll wrap up.

    <Press any key to continue>
  `)
  await waitForUser();
  server.close();
}
