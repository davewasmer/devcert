import { execSync, ExecSyncOptions } from 'child_process';
import tmp from 'tmp';
import createDebug from 'debug';
import path from 'path';
import sudoPrompt from 'sudo-prompt';

import {
  configPath,
} from './constants';

const debug = createDebug('devcert:util');

export function openssl(cmd: string) {
  return run(`openssl ${ cmd }`, {
    stdio: 'pipe',
    env: Object.assign({
      RANDFILE: path.join(configPath('.rnd'))
    }, process.env)
  });
}

export function run(cmd: string, options: ExecSyncOptions = {}) {
  debug(`exec: \`${ cmd }\``);
  return execSync(cmd, options);
}

export function waitForUser() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.on('data', resolve);
  });
}

export function reportableError(message: string) {
  return new Error(`${message} | This is a bug in devcert, please report the issue at https://github.com/davewasmer/devcert/issues`);
}

export function mktmp() {
  // discardDescriptor because windows complains the file is in use if we create a tmp file
  // and then shell out to a process that tries to use it
  return tmp.fileSync({ discardDescriptor: true }).name;
}

export function sudo(cmd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    sudoPrompt.exec(cmd, { name: 'devcert' }, (err: Error | null, stdout: string | null, stderr: string | null) => {
      let error = err || (typeof stderr === 'string' && stderr.trim().length > 0 && new Error(stderr)) ;
      error ? reject(error) : resolve(stdout);
    });
  });
}

export function isDomainInHostFile(hostFileContents: string, domain: string): boolean {
  // Do a check for a full match since a string includes can be fooled by 
  // a subdomain being present in the host file.
  const isPresent = hostFileContents
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(item => item === domain).length > 0;
 return isPresent;
}
