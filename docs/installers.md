# Desktop application installers

GitHub builds the desktop application installers (workflow `.github/workflows/desktop.yml`, "Desktop installers"):

| System | Files |
|---|---|
| Windows | `OpenFlyover_<version>_x64-setup.exe` (NSIS) and `OpenFlyover_<version>_x64_fr-FR.msi` |
| macOS | `OpenFlyover_<version>_universal.dmg` (Apple Silicon and Intel) |
| Linux | `OpenFlyover_<version>_amd64.AppImage` and `OpenFlyover_<version>_amd64.deb` (Ubuntu 22.04, Debian 12 or newer) |

Allow 15 to 30 minutes per system (the Rust cache shortens later runs).

## What the installers show

The installers use the colours of the application (the « Carte alpine » palette: paper, ink, rust red, glacier).

- **Windows `.exe` (NSIS)**: wizard in French; header image (ink band, logo, name), sidebar image on the welcome and finish pages (logo, name, screenshot of the app), then the licence page with « J'accepte » (the MIT licence followed by a reminder of the licences of the products used and of the data sources).
- **Windows `.msi`**: dialogs in French, same banner and welcome image, licence dialog from the same text.
- **macOS `.dmg`**: window with the « Carte alpine » background, an arrow towards the Applications folder; the licence is shown as a dialog to accept when the disk image is opened (to remove it: add `src-tauri/tauri.macos.conf.json` with `{"bundle":{"licenseFile":null}}`).
- **Linux (`.deb`, AppImage)**: no visual customisation is possible; the deb installs the licence text as `/usr/share/doc/open-flyover/copyright`. `THIRD_PARTY_NOTICES.md` (full licence texts) is installed next to the application by all of them.

The images and licence pages are build inputs committed in `src-tauri/installer/` (`nsis-header.bmp` 150×57, `nsis-sidebar.bmp` 164×314, `wix-banner.bmp` 493×58, `wix-dialog.bmp` 493×312, `dmg-background.png` 660×400, `license.rtf`, `license.txt`), referenced by `bundle.licenseFile`, `bundle.windows.nsis`, `bundle.windows.wix`, `bundle.macOS.dmg` and `bundle.linux.deb.files` in `tauri.conf.json` (`licenseFile` must stay an RTF: WiX requires one).

- Images: `npm run installer-assets` (needs a Chromium, `OPENFLYOVER_CHROME` if it is not found, and internet access so that the screenshot shows the terrain). Commit the result.
- Licence pages: `npm run notices` regenerates them after `THIRD_PARTY_NOTICES.md`; `node scripts/installer-license.mjs` alone rebuilds them from the committed notices.

## Building the installers

**To try them out**: on GitHub, *Actions* tab › "Desktop installers" › *Run workflow* (any branch) › *Run workflow*.

**For a release**:

1. Put the same number in `src-tauri/tauri.conf.json` (`version`) and `src-tauri/Cargo.toml` (`version`), for example
   `0.2.0`. This is the number that appears in the file names.
2. Regenerate the third-party licenses with `npm run notices` (after `npm ci`; the first run takes about 8 minutes because
   of the crates.io rate limit) and commit `THIRD_PARTY_NOTICES.md` and `src-tauri/installer/license.rtf` / `license.txt`: they are shipped with the installers.
3. Create and push the tag: `git tag v0.2.0`, then `git push origin v0.2.0`.

## Where to download them

- After *Run workflow* or a tag: *Actions* › the workflow run › at the bottom, *Artifacts* (one zip file per
  installer, kept 90 days).
- After a tag, in addition: *Releases*, the release `OpenFlyover v0.2.0` with all the installers, **published
  automatically** once the three systems are built (public on a public repository). While the builds run, it stays
  a draft that only the repository owner can see; if one system fails, it stays a draft: re-run the failed job
  (*Re-run failed jobs*), which publishes it at the end, or publish it by hand (*Edit* › *Publish release*).

## Without a certificate (current situation)

The installers work, but the system warns at first launch:

- **Windows** (SmartScreen, "Windows protected your PC"): click **More info**, then
  **Run anyway**.
- **macOS**: the application is only signed "ad hoc" (`signingIdentity: "-"` in `tauri.conf.json`; without it,
  an Apple Silicon Mac reports it as "damaged"). At first launch: right-click the application › **Open** ›
  **Open**. Since macOS 15, if this is not offered: *System Settings* › *Privacy & Security* › at the bottom,
  **Open Anyway**.
- **Linux**: nothing to sign. AppImage: make it executable (`chmod +x OpenFlyover_*.AppImage`), then run it. Debian
  package: `sudo apt install ./OpenFlyover_*.deb`.

## Adding the certificates later

The certificates stay in the repository **secrets**, never in a file: *Settings* › *Secrets and variables* ›
*Actions* › *New repository secret*. As soon as they are present, the workflow signs; otherwise it builds unsigned.

### Windows (Authenticode)

You need a code signing certificate (`.pfx` file with its private key and its password). Method followed:
<https://v2.tauri.app/distribute/sign/windows/> (the certificate is imported into the user store, then Tauri
signs with its thumbprint, DigiCert timestamp, SHA-256).

| Secret | Content |
|---|---|
| `WINDOWS_CERTIFICATE` | the `.pfx` file in base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | the `.pfx` password |

Convert the `.pfx` to base64, on Windows: `certutil -encode certificat.pfx certificat-base64.txt`, then paste the whole
content of the text file into the secret (the `-----BEGIN…` and `-----END…` lines can stay). On Linux or
macOS: `openssl base64 -A -in certificat.pfx -out certificat-base64.txt`.

A new certificate does not remove the SmartScreen warning right away: Windows removes it once the application has gained
a reputation (number of downloads). Certificates on a hardware key or in the cloud (Azure Trusted Signing…)
cannot be exported as `.pfx`: they need a signing command (`bundle.windows.signCommand`), to be added in that case.

### macOS (Developer ID and notarization)

You need an Apple Developer account and a **Developer ID Application** certificate, exported from Keychain as `.p12`. Method
followed: <https://v2.tauri.app/distribute/sign/macos/>.

| Secret | Content |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12` file in base64: `openssl base64 -A -in certificat.p12 -out certificat-base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | the password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | the certificate name, for example `Developer ID Application: First Last (ABCDE12345)` (`security find-identity -v -p codesigning`) |
| `APPLE_ID` | the Apple account email address (notarization) |
| `APPLE_PASSWORD` | an **app-specific password** created on <https://account.apple.com> (not the account password) |
| `APPLE_TEAM_ID` | the team ID (10 characters, *Membership* page of the developer account) |

The first three are enough to sign; the last three add notarization, which removes the
Gatekeeper warning.

### Automatic updates

The application does not use the Tauri updater plugin: no update signing key is
needed.
