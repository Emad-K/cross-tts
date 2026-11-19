# Code signing

Cross TTS installers are unsigned until the repository is given signing
secrets. Unsigned builds work, but:

- **macOS** warns about an unidentified developer on first launch (the user
  has to right-click the app and choose Open), and auto-update can only point
  at the releases page (it can't install).
- **Windows** shows a SmartScreen "Windows protected your PC" warning.

The release workflow signs automatically once the secrets below exist. With no
secrets it builds exactly as before. Nothing else needs to change: there is no
flag to flip in the workflow.

Linux packages are not signed.

## What to buy

Prices and eligibility were checked in November 2026. Check them again before
paying; both vendors change them.

| Platform | What | Cost | Notes |
|---|---|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/) membership | 99 USD per year | Gives the "Developer ID Application" certificate and access to notarization. Individuals and companies can enrol. |
| Windows, option A | [Azure Artifact Signing](https://azure.microsoft.com/products/artifact-signing/) (formerly Trusted Signing), Basic plan | About 9.99 USD per month, 5,000 signatures included | Cheapest route and SmartScreen trusts it. Needs a paid Azure subscription (not free, trial or sponsored). Billing starts when the signing account is created and is not pro-rated. |
| Windows, option B | An OV or EV code signing certificate from a certificate authority, as a `.pfx` file | Roughly 200 to 500 USD per year | Use this if Azure won't validate your identity. See the warning below about hardware tokens. |

**Azure eligibility is the catch.** Microsoft validates your identity before it
issues a certificate, and only for some countries. Microsoft's own answers have
listed organizations in the USA, Canada, the EU and the UK, and individual
developers only in the USA and Canada; the list has been changing and
Microsoft's pages don't state it clearly. Validation takes from 1 to 30
business days. Confirm you qualify before creating the (billable) signing
account.

**Option B and hardware tokens.** Certificate authorities now issue code
signing keys on a hardware token or in a cloud HSM, not as a downloadable file.
The `.pfx` path here only works if your provider gives you an exportable
`.pfx`. If it doesn't, use Azure, or ask the provider for its cloud signing
tool (that needs a different setup from the one in this repository).

## Secrets to add

Add these under **Settings → Secrets and variables → Actions → New repository
secret**. Names must match exactly. Leave out the ones you don't use.

### macOS

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | The "Developer ID Application" certificate with its private key, exported as a `.p12` file and base64 encoded (`base64 -i certificate.p12 \| pbcopy`). |
| `MAC_CSC_KEY_PASSWORD` | The password you set when exporting the `.p12`. |

Signing starts when `MAC_CSC_LINK` exists. To also notarize (needed for the app
to open without a warning), add **one** of these two sets.

Apple ID:

| Secret | Value |
|---|---|
| `APPLE_ID` | The Apple ID email of the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password made at [account.apple.com](https://account.apple.com) (Sign-In and Security → App-Specific Passwords). Not the account password. |
| `APPLE_TEAM_ID` | The 10-character Team ID from the developer account's Membership page. |

Or an App Store Connect API key (better for a team account; no personal
password involved):

| Secret | Value |
|---|---|
| `APPLE_API_KEY_P8` | The full text of the downloaded `AuthKey_XXXXXXXXXX.p8` file. |
| `APPLE_API_KEY_ID` | The key ID shown next to the key. |
| `APPLE_API_ISSUER` | The issuer ID shown above the key list. |

If both sets exist, the API key is used.

### Windows, option A: Azure Artifact Signing

In Azure: create an Artifact Signing account, complete identity validation,
create a **Public Trust** certificate profile, then create an app registration
(service principal) with a client secret and give it the **Artifact Signing
Certificate Profile Signer** role on the certificate profile.

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) ID of the app registration. |
| `AZURE_CLIENT_ID` | Application (client) ID of the app registration. |
| `AZURE_CLIENT_SECRET` | The client secret's value. It expires; renew it before it does. |
| `AZURE_SIGNING_ENDPOINT` | The signing account's endpoint for its region, for example `https://eus.codesigning.azure.net`. |
| `AZURE_SIGNING_ACCOUNT` | The Artifact Signing account name. |
| `AZURE_SIGNING_PROFILE` | The certificate profile name. |
| `AZURE_SIGNING_PUBLISHER` | The certificate's subject common name, exactly as validated (your legal name or company name). |

Signing starts when `AZURE_CLIENT_ID` exists; the build then fails if any of
the other six is missing.

### Windows, option B: certificate file

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | The `.pfx` file, base64 encoded. |
| `WIN_CSC_KEY_PASSWORD` | The `.pfx` password. |

Used only when `AZURE_CLIENT_ID` is not set.

## How it works

- `.github/workflows/release.yml` maps the secrets into the **Package** step
  only, and each secret only on the operating system that uses it. No other
  step, and no dependency install script, can read them.
- `scripts/package-release.sh` passes them to electron-builder under the names
  it expects, and only when they are set. Its first log line says what it
  decided, for example `Code signing: Apple Developer ID, notarized with an
  Apple ID` or `Code signing: none (unsigned build)`.
- `electron-builder.yml` turns on the macOS hardened runtime (notarization
  requires it) with the entitlements in `assets/entitlements.mac.plist`:
  JIT and unsigned executable memory for the JavaScript and WebAssembly
  engines, and disabled library validation so the bundled ONNX Runtime
  libraries load.

## Check a signed release

The workflow publishes the release as soon as every build succeeds, so check
straight away: download the installers from the release and run these.

macOS (on a Mac):

```sh
# Who signed it, and is the hardened runtime on ("flags=0x10000(runtime)")?
codesign -dv --verbose=4 "/Applications/Cross TTS.app"
# Is every file inside validly signed?
codesign --verify --deep --strict --verbose=2 "/Applications/Cross TTS.app"
# Would Gatekeeper let it run? Expect "accepted" and "source=Notarized Developer ID".
spctl -a -vv "/Applications/Cross TTS.app"
# Is the notarization ticket attached, so the first launch works offline?
xcrun stapler validate "/Applications/Cross TTS.app"
```

Then do the real test: download the `.dmg` in a browser, install, and open the
app by double-clicking. It should open with no warning. Check both the Apple
silicon and the Intel build, and confirm speech still plays (that exercises the
entitlements).

Windows (in a "Developer Command Prompt", or with the Windows SDK installed):

```bat
signtool verify /pa /v cross-tts-<version>-setup-x64.exe
signtool verify /pa /v cross-tts-<version>-portable-x64.exe
```

Or right-click the file → Properties → Digital Signatures. Also check the
installed `Cross TTS.exe`. A new certificate can still show SmartScreen for a
while until it builds reputation; Azure Artifact Signing certificates usually
don't.

## After the first signed release

- **macOS auto-update.** `CAN_INSTALL_UPDATES` in `src/bun/autoUpdate.ts` is
  off on macOS because an unsigned app can't install an update. Turn it on in
  a later release, once a signed and notarized release is out and checked: if
  it were on in a build that came out unsigned (a missing or expired secret),
  that build would download updates it can't install. People on unsigned
  versions still have to install the first signed version by hand.
- **Windows auto-update pins the publisher.** Once a build is signed, the
  installed app only accepts updates signed with the same publisher name. If
  the name on the certificate ever changes (new legal name, a different
  certificate authority), existing installs will refuse the update and users
  must reinstall by hand. Keep `AZURE_SIGNING_PUBLISHER` and the certificate's
  subject stable.
- **Renewals.** The Apple membership and certificate, the Azure client secret
  and any `.pfx` all expire. An expired secret fails the release build; it does
  not silently fall back to unsigned.
- Remove the "isn't code-signed yet" note from the README once signed releases
  are published.

## Not tested

Signing can't be exercised without real certificates, so the signed paths have
only been checked by reading electron-builder's source and by running
`scripts/package-release.sh` against a stub. The first release after adding
secrets is the real test: watch the Package step's log, then run the checks
above.
