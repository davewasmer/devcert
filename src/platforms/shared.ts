import path from 'path';
import url from 'url';
import createDebug from 'debug';
import assert from 'assert';
import getPort from 'get-port';
import http from 'http';
import { sync as glob } from 'glob';
import { readFileSync as readFile, existsSync as exists } from 'fs';
import { run } from '../utils';
import { isMac, isLinux , configDir, getLegacyConfigDir } from '../constants';
import UI from '../user-interface';
import { execSync as exec } from 'child_process';

const debug = createDebug('devcert:platforms:shared');

/**
 *  Given a directory or glob pattern of directories, run a callback for each db
 *  directory, with a version argument.
 */
function doForNSSCertDB(nssDirGlob: string, callback: (dir: string, version: "legacy" | "modern") => void): void {
  glob(nssDirGlob).forEach((potentialNSSDBDir) => {
    debug(`checking to see if ${ potentialNSSDBDir } is a valid NSS database directory`);
    if (exists(path.join(potentialNSSDBDir, 'cert8.db'))) {
      debug(`Found legacy NSS database in ${ potentialNSSDBDir }, running callback...`)
      callback(potentialNSSDBDir, 'legacy');
    }
    if (exists(path.join(potentialNSSDBDir, 'cert9.db'))) {
      debug(`Found modern NSS database in ${ potentialNSSDBDir }, running callback...`)
      callback(potentialNSSDBDir, 'modern');
    }
  });
}

/**
 *  Given a directory or glob pattern of directories, attempt to install the
 *  CA certificate to each directory containing an NSS database.
 */
export function addCertificateToNSSCertDB(nssDirGlob: string, certPath: string, certutilPath: string): void {
  debug(`trying to install certificate into NSS databases in ${ nssDirGlob }`);
  doForNSSCertDB(nssDirGlob, (dir, version) => {
    const dirArg = version === 'modern' ? `sql:${ dir }` : dir;
      run(certutilPath, ['-A', '-d', dirArg, '-t', 'C,,', '-i', certPath, '-n', 'devcert']);
  });
  debug(`finished scanning & installing certificate in NSS databases in ${ nssDirGlob }`);
}

export function removeCertificateFromNSSCertDB(nssDirGlob: string, certPath: string, certutilPath: string): void {
  debug(`trying to remove certificates from NSS databases in ${ nssDirGlob }`);
  doForNSSCertDB(nssDirGlob, (dir, version) => {
    const dirArg = version === 'modern' ? `sql:${ dir }` : dir;
    try {
      run(certutilPath, ['-A', '-d', dirArg, '-t', 'C,,', '-i', certPath, '-n', 'devcert']);
    } catch (e) {
      debug(`failed to remove ${ certPath } from ${ dir }, continuing. ${ e.toString() }`)
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
    await UI.closeFirefoxBeforeContinuing();
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
  let server = http.createServer(async (req, res) => {
    let { pathname } = url.parse(req.url);
    if (pathname === '/certificate') {
      res.writeHead(200, { 'Content-type': 'application/x-x509-ca-cert' });
      res.write(readFile(certPath));
      res.end();
    } else {
      res.writeHead(200);
      res.write(await UI.firefoxWizardPromptPage(`http://localhost:${ port }/certificate`));
      res.end();
    }
  }).listen(port);
  debug('Certificate server is up. Printing instructions for user and launching Firefox with hosted certificate URL');
  await UI.startFirefoxWizard(`http://localhost:${ port }`);
  run(firefoxPath, [`http://localhost:${ port }`]);
  await UI.waitForFirefoxWizard();
  server.close();
}

export function assertNotTouchingFiles(filepath: string, operation: string): void {
    if (!filepath.startsWith(configDir) && !filepath.startsWith(getLegacyConfigDir())) {
      throw new Error(`Devcert cannot ${ operation } ${ filepath }; it is outside known devcert config directories!`);
    }
}