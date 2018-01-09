import { execSync, ExecSyncOptions } from 'child_process';
import * as createDebug from 'debug';
import * as path from 'path';

import {
  configPath,
} from './constants';

const debug = createDebug('devcert:util');

export function openssl(cmd: string) {
  return run(`openssl ${ cmd }`, {
    stdio: 'ignore',
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