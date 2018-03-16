import { Options } from '../index';


export interface Platform {
   addToTrustStores(certificatePath: string, options?: Options): Promise<void>;
   addDomainToHostFileIfMissing(domain: string): void;
}

const PlatformClass = require(`./${ process.platform }`);
export default new PlatformClass() as Platform;
