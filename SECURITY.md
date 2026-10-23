# Security policy

## Supported versions

Only the latest release is supported: the website always serves it, and the desktop application updates itself to
it (« Réglages › Mises à jour »). Fixes are not backported to older versions.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub: on the repository page, open the
**Security** tab, then **Report a vulnerability**. Only the maintainer sees the report.

Say what is affected (website, desktop application on Windows, macOS or Linux, version), how to reproduce it, and what
an attacker could do with it. You should get an answer within a week. Once a fix is released, the advisory is
published with credit to you, unless you prefer not to be named.

## What is in scope

- The desktop application: its Tauri commands and capabilities (`src-tauri/`), the content security policy, file
  access, and the update channel (the installers and `latest.json` are signed; an update that bypasses the signature
  is critical).
- The website and its service worker: anything that runs code or reads data across origins.
- Project files (`.opnflvr`): a crafted file that runs code, reads local files or escapes its project when opened.

Out of scope: the third-party tile, weather and OpenStreetMap services the app reads (report to them), and attacks
that need an already compromised computer.
