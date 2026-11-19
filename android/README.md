# Sensibilia Assessor (Android kiosk shell)

A thin Android app that shows the assessor PWA full screen and can lock the tablet to it
(kiosk mode). The PWA, its offline storage and sync are unchanged.

**New to this? Follow [INSTALL.md](INSTALL.md): build, install with adb and set up a tablet, step by step.**

No server address, IP or certificate is compiled in. On first start the app asks for the server:

1. **Scan setup code** reads the QR on the researcher screen (Laboratory terminals › Set up new
   tablet). It contains the server address, the pairing code and, for the standard install, the
   fingerprint of the laboratory certificate authority.
2. Or **type** `host:port`.
3. If the tablet already trusts the server's certificate the app opens the assessor page (and the
   pairing code from the QR is passed to it).
4. If this build has the laboratory root baked in (see below) it never gets here: the server is
   trusted and setup finishes. A baked build whose root does not match the server says so.
   Otherwise it downloads the server's published root certificate, shows its SHA-256 fingerprint,
   compares it with the one in the QR (or asks staff to compare it with the researcher screen),
   and only then saves `sensibilia-test-ca.crt` to Downloads and opens Settings so staff can
   install it as a CA certificate. The app never proceeds past a certificate error.

Staff press and hold the **top-left corner** for: Reload, Change server, Leave kiosk mode.
(The web page's own staff corner is bottom-right.)

## Laboratory certificate authority

Build the app with the laboratory's root certificate to skip the Settings step on every tablet:

```
# standard install: ./docker-up.sh saves the root to data/lab-ca/root.crt and prints its SHA-256.
# The server may be headless: copy that file to the computer that builds (see INSTALL.md).
./build_android_app.sh   # from the project root; bakes in data/lab-ca/root.crt by default
# Options: --ca FILE (another root), --install (adb install afterwards), --no-ca (no baked root).
# Equivalent: cd android && ./gradlew assembleDebug -PlabCa=../data/lab-ca/root.crt
```

`-PlabCa` takes a PEM root (path relative to `android/`, or absolute). The APK then trusts the system
store plus that root, and no certificate installed by hand. Install the same APK on every tablet. Compare
the fingerprint on the setup screen (and in the staff menu, Certificate) with the researcher screen.
Without `-PlabCa` the app trusts system and user-installed certificates and offers the manual install.

The standard install keeps its authority in `data/dev-tls`, so wiping data or recreating containers does not
change it and the APK stays valid. Deleting `data/dev-tls`, or moving the stack to a host without a copy of
it, creates a new authority: rebuild the APK. When you move the server, copy the whole `data/` folder
(see deploy/standard.md). A server with a certificate Android already trusts needs no
baked root. The root is public, but specific to one laboratory: keep the APK as a laboratory artefact.

**Device check (run once per tablet model).** On a tablet with no CA installed,
install a debug build made with `-PlabCa`, then open `chrome://inspect` on a computer with USB debugging
and check, on the assessor page: no certificate error, `isSecureContext`, a service worker controlling
`/assessor/`, IndexedDB intact after force-stop, and the value of `navigator.storage.persist()`.

## Build

Requires JDK 17+ and the Android SDK (platform 35, build-tools 35.0.0).

```
cd android
echo sdk.dir=/path/to/android-sdk > local.properties    # not committed
./gradlew testDebugUnitTest assembleDebug
```

Output: `app/build/outputs/apk/debug/app-debug.apk` (debug-signed; fine for sideloading in the
laboratory). For a release-signed build create a keystore outside the repository and add a
signing config; keep the keystore and its password with the laboratory's other secrets.

Install: `adb install -r app/build/outputs/apk/debug/app-debug.apk`

## Kiosk mode

- **Locked to this app (recommended):** on a freshly factory-reset tablet with no accounts
  (skip account setup), enable USB debugging, install the APK, then
  `adb shell dpm set-device-owner app.sensibilia.assessor/.KioskAdmin`. The app then starts lock
  task mode by itself: no home, recents or notifications. Staff leave it from the corner menu
  (Leave kiosk mode). Removing device-owner status needs a factory reset or
  `adb shell dpm remove-active-admin app.sensibilia.assessor/.KioskAdmin`.
- **Without device owner:** the app asks Android to pin the screen; staff confirm once and can
  unpin with the system gesture.

## Tests

`ServersTest` covers address parsing (pairing URL, typed host:port, fingerprint normalisation).
Camera scanning, the certificate flow and lock task mode need a device and are not covered by
automated tests.
