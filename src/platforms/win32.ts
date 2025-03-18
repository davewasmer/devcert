import crypto from "crypto";
import createDebug from "debug";
import { readFileSync as read, writeFileSync as write } from "fs";
import { sync as rimraf } from "rimraf";
import { Platform } from ".";
import { Options } from "../index";
import UI from "../user-interface";
import { run, sudo } from "../utils";
import { assertNotTouchingFiles, openCertificateInFirefox } from "./shared";

const debug = createDebug("devcert:platforms:windows");

let encryptionKey: string;

export default class WindowsPlatform implements Platform {
    private HOST_FILE_PATH = "C:\\Windows\\System32\\Drivers\\etc\\hosts";

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
        debug("adding devcert root to Windows OS trust store");
        try {
            run("certutil", ["-addstore", "-user", "root", certificatePath]);
        } catch (e) {
            e.output.map((buffer: Buffer) => {
                if (buffer) {
                    console.log(buffer.toString());
                }
            });
        }
        debug("adding devcert root to Firefox trust store");
        // Firefox (don't even try NSS certutil, no easy install for Windows)
        try {
            await openCertificateInFirefox("start firefox", certificatePath);
        } catch {
            debug("Error opening Firefox, most likely Firefox is not installed");
        }
    }

    removeFromTrustStores(certificatePath: string) {
        debug("removing devcert root from Windows OS trust store");
        try {
            console.warn(
                "Removing old certificates from trust stores. You may be prompted to grant permission for this. It's safe to delete old devcert certificates."
            );
            run("certutil", ["-delstore", "-user", "root", "devcert"]);
        } catch (e) {
            debug(`failed to remove ${certificatePath} from Windows OS trust store, continuing. ${e.toString()}`);
        }
    }

    async addDomainToHostFileIfMissing(domain: string) {
        let hostsFileContents = read(this.HOST_FILE_PATH, "utf8");
        if (!hostsFileContents.includes(domain)) {
            await sudo(`echo 127.0.0.1  ${domain} >> ${this.HOST_FILE_PATH}`);
        }
    }

    deleteProtectedFiles(filepath: string) {
        assertNotTouchingFiles(filepath, "delete");
        rimraf(filepath);
    }

    async readProtectedFile(filepath: string): Promise<string> {
        assertNotTouchingFiles(filepath, "read");
        if (!encryptionKey) {
            encryptionKey = await UI.getWindowsEncryptionPassword();
        }
        // Try to decrypt the file
        try {
            return this.decrypt(read(filepath, "utf8"), encryptionKey);
        } catch (e) {
            // If it's a bad password, clear the cached copy and retry
            if (e.message.indexOf("bad decrypt") >= -1) {
                encryptionKey = null;
                return await this.readProtectedFile(filepath);
            }
            throw e;
        }
    }

    async writeProtectedFile(filepath: string, contents: string) {
        assertNotTouchingFiles(filepath, "write");
        if (!encryptionKey) {
            encryptionKey = await UI.getWindowsEncryptionPassword();
        }
        let encryptedContents = this.encrypt(contents, encryptionKey);
        write(filepath, encryptedContents);
    }

    private encrypt(text: string, key: string): string {
        const algorithm = "aes-256-cbc";
        const iv = crypto.randomBytes(16); // Initialization vector
        const keyBuffer = crypto.createHash("sha256").update(key).digest(); // Ensure 32-byte key

        const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
        const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);

        return iv.toString("hex") + ":" + encrypted.toString("hex"); // Store IV with encrypted data
    }

    private decrypt(encryptedText: string, key: string): string {
        const algorithm = "aes-256-cbc";
        const keyBuffer = crypto.createHash("sha256").update(key).digest(); // Ensure 32-byte key

        // Extract IV and encrypted data
        const [ivHex, encryptedHex] = encryptedText.split(":");
        const iv = Buffer.from(ivHex, "hex");
        const encryptedBuffer = Buffer.from(encryptedHex, "hex");

        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);

        return decrypted.toString("utf8");
    }
}
