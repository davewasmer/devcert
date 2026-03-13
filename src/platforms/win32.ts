import createDebug from 'debug';
import crypto from 'crypto';
import { writeFileSync as write, readFileSync as read } from 'fs';
import { sync as rimraf } from 'rimraf';
import { Options } from '../index';
import { assertNotTouchingFiles, openCertificateInFirefox } from './shared';
import { Platform } from '.';
import { run, sudo } from '../utils';
import UI from '../user-interface';

const debug = createDebug('devcert:platforms:windows');
const ALG_NAME = 'aes-256-gcm';
const ALG_SIZES = {
  NONCE: 16,
  TAG: 16,
  KEY: 16,
};
const PBKDF2 = {
  NAME: 'sha256',
  SALT_SIZE: 16,
  ITER: 32767,
};

let encryptionKey: string;

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
    try {
      run('certutil', ['-addstore', '-user', 'root', certificatePath]);
    } catch (e) {
      e.output.map((buffer: Buffer) => {
        if (buffer) {
          console.log(buffer.toString());
        }
      });
    }
    debug('adding devcert root to Firefox trust store')
    // Firefox (don't even try NSS certutil, no easy install for Windows)
    try {
      await openCertificateInFirefox('start firefox', certificatePath);
    } catch {
      debug('Error opening Firefox, most likely Firefox is not installed');
    }
  }

  removeFromTrustStores(certificatePath: string) {
    debug('removing devcert root from Windows OS trust store');
    try {
      console.warn('Removing old certificates from trust stores. You may be prompted to grant permission for this. It\'s safe to delete old devcert certificates.');
      run('certutil', ['-delstore', '-user', 'root', 'devcert']);
    } catch (e) {
      debug(`failed to remove ${ certificatePath } from Windows OS trust store, continuing. ${ e.toString() }`)
    }
  }

  async addDomainToHostFileIfMissing(domain: string) {
    let hostsFileContents = read(this.HOST_FILE_PATH, 'utf8');
    if (!hostsFileContents.includes(domain)) {
      await sudo(`echo 127.0.0.1  ${ domain } >> ${ this.HOST_FILE_PATH }`);
    }
  }

  deleteProtectedFiles(filepath: string) {
    assertNotTouchingFiles(filepath, 'delete');
    rimraf(filepath);
  }

  async readProtectedFile(filepath: string): Promise<string> {
    assertNotTouchingFiles(filepath, 'read');
    if (!encryptionKey) {
      encryptionKey = await UI.getWindowsEncryptionPassword();
    }
    // Try to decrypt the file
    try {
      return this.decrypt(read(filepath, 'utf8'), encryptionKey);
    } catch (e) {
      // If it's a bad password, clear the cached copy and retry
      if (e.message.indexOf('bad decrypt') >= -1) {
        encryptionKey = null;
        return await this.readProtectedFile(filepath);
      }
      throw e;
    }
  }

  async writeProtectedFile(filepath: string, contents: string) {
    assertNotTouchingFiles(filepath, 'write');
    if (!encryptionKey) {
      encryptionKey = await UI.getWindowsEncryptionPassword();
    }
    let encryptedContents = this.encrypt(contents, encryptionKey);
    write(filepath, encryptedContents);
  }

  private getPbkdf2 = (password: string, salt: Buffer): Buffer => {
    return crypto.pbkdf2Sync(
      Buffer.from(password, 'utf8'),
      salt,
      PBKDF2.ITER,
      ALG_SIZES.KEY,
      PBKDF2.NAME
    );
  };

  private getCryptoKey = (key: Buffer) =>
    crypto.createHash('sha256').update(key).digest();

  private encrypt = (plainText: string, password: string): string => {
    // Generate a 128-bit salt using a PBKDF2.
    const salt = crypto.randomBytes(PBKDF2.SALT_SIZE);

    // Derive a key using PBKDF2.
    const key = this.getCryptoKey(this.getPbkdf2(password, salt));

    // Generate a 128-bit nonce using a CSPRNG.
    const nonce = crypto.randomBytes(ALG_SIZES.NONCE);

    // Create the cipher instance.
    const cipher = crypto.createCipheriv(ALG_NAME, key, nonce);

    // Encrypt and prepend salt.
    return Buffer.concat([
      salt,
      nonce,
      cipher.update(plainText, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString('base64');
  };

  private decrypt = (
    base64EncryptedContent: string,
    password: string
  ): string => {
    // Decode the base64.
    const encCipher = Buffer.from(base64EncryptedContent, 'base64');

    // Create buffers of salt, nonce, encryption cipher, and auth tag
    let position = 0;
    const salt = encCipher.slice(position, (position += PBKDF2.SALT_SIZE));
    const nonce = encCipher.slice(position, (position += ALG_SIZES.NONCE));
    const encContent = encCipher.slice(
      position,
      encCipher.length - ALG_SIZES.TAG
    );
    const tag = encCipher.slice(encCipher.length - ALG_SIZES.TAG);

    // Derive the key using PBKDF2.
    const key = this.getCryptoKey(this.getPbkdf2(password, salt));

    const decipher = crypto.createDecipheriv(ALG_NAME, key, nonce);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encContent),
      decipher.final(),
    ]).toString('utf8');
  };
}
