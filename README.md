# devcert - Development SSL made easy

So, running a local HTTPS server usually sucks. There's a range of approaches,
each with their own tradeoff. The common one, using self-signed certificates,
means having to ignore scary browser warnings for each project.

devcert makes the process easy. Want a private key and certificate file to use
with your server? Just ask:

```js
let { key, cert } = await devcert.certificateFor('my-app.dev');
https.createServer({ key, cert }, app).listen(3000);
});
```

Now open https://my-app.dev:3000 and voila - your page loads with no scary
warnings or hoops to jump through.

> Certificates are cached by name, so two calls for
`certificateFor('foo')` will return the same key and certificate.

## Options

### skipHostsFile

If you supply a custom domain name (i.e. any domain other than `localhost`) when requesting a certificate from devcert, it will attempt to modify your system to redirect requests for that domain to your local machine (rather than to the real domain). It does this by modifying your `/etc/hosts` file (or the equivalent file for Windows).

If you pass in the `skipHostsFile` option, devcert will skip this step. This means that if you ask for certificates for `my-app.test` (for example), and don't have some other DNS redirect method in place, that you won't be able to access your app at `https://my-app.test` because your computer wouldn't know
that `my-app.test` should resolve your local machine.

### skipCertutil

This option will tell devcert to avoid installing `certutil` tooling.

`certutil` is a tooling package used to automated the installation of SSL certificates in certain circumstances; specifically, Firefox (for every OS) and Chrome (on Linux only). Without it, the install process changes for those two scenarios:

**Firefox**: Thankully, Firefox makes this easy. There's a point-and-click wizard for importing and trusting a certificate, so if you don't provide `installCertutil: true` to devcert, devcert will instead automatically open Firefox and kick off this wizard for you. Simply follow the prompts to trust the certificate. **Reminder: you'll only need to do this once per machine**

**Chrome on Linux**: Unfortunately, it appears that the **only** way to get Chrome to trust an SSL certificate on Linux is via the `certutil` tooling - there is no manual process for it. Thus, if you are using Chrome on Linux, do **not** supply `skipCertuil: true`.

The `certutil` tooling is installed in OS-specific ways:

* Mac: `brew install nss`
* Linux: `apt install libnss3-tools`
* Windows: N/A

## How it works

When you ask for a development certificate, devcert will first check to see if it has run on this machine before. If not, it will create a root certificate authority and add it to your OS and various browser trust stores. You'll likely see password prompts from your OS at this point to authorize the new root CA. Once this root CA is trusted by your machine, devcert will encrypt the root CA credentials used to sign certificates with a user supplied password. This prevents malicious processes from access those keys to generated trusted certificates.

Since your machine now trusts this root CA, it will trust any certificates signed by it. So when you ask for a certificate for a new domain, devcert will decrypt the root CA credentials (triggering a password prompt to supply the decryption password as it does). It then uses those root CA credentials to generate a certificate specific to the domain you requested, and returns the new certificate to you. The root CA credentials are momentarily written in plain text to the disk in tmp files, since OpenSSL doesn't support directly supplying them via command line, but they are deleted as soon as the domain-specific certificate is generated.

If you request a domain that has already had certificates generated for it, devcert will simply return the cached certificates - no additional password prompting needed.

This setup ensures that browsers won't show scary warnings about untrusted certificates, since your OS and browsers will now trust devcert's certificates. The root CA certificate is unique to your machine only, is generated on-the-fly when it is first installed, and stored in the system secret storage, so attackers should not be able to compromise it to generate their own certificates.

### Why install a root certificate authority?

The root certificate authority makes it slightly simpler to manage which domains are configured for SSL by devcert. The alternative is to generate and trust self-signed certificates for each domain. The problem is that while devcert is able to add a certificate to your machine's trust stores, the tooling to remove a certificate doesn't cover every case.

By trusting only a single root CA, devcert is able to guarantee that when you want to _disable_ SSL for a domain, it can do so with no manual intervention - we just delete the certificate files and that's it.

## Testing

If you want to test a contribution to devcert, it comes packaged with a Vagrantfile to help make testing easier. The Vagrantfile will spin up three virtual machines, one for each supported platform: macOS, Linux, and Windows.

Launch the VMs with `vagrant up`, which should start all three in GUI mode. Each VM is a snapshot, with instructions for testing on screen already. Just follow the instructions to test each.

You can also use snapshots of the VMs to roll them back to a pristine state for another round of testing. Just `vagrant snapshot push` on the intial bootup of the VMs, and `vagrant snapshot pop` to roll it back to the pristine state later.

**Note**: Be aware that the macOS license terms prohibit running it on non-Apple hardware, so you must own a Mac to test that platform. If you don't own a Mac - that's okay, just mention in the PR that you were unable to test on a Mac and we're happy to test it for you.

## License

MIT © [Dave Wasmer](http://davewasmer.com)
