# Install the tablet app: step by step

The simplest possible route. Do the steps in order and do not skip any.

## Which computer does what

The Sensibilia **server** is a Linux machine without a screen or desktop. You only reach it over the
network (SSH). It runs the server and keeps the laboratory certificate. It does not build the app and it
does not open the researcher screen.

You also need one **workstation**: any normal computer (Windows, Linux or macOS) on the same network, with
a browser and a USB port. The workstation builds the app, installs it on the tablets with a USB cable and
shows the researcher screen with the QR code.

On the workstation you need Java 17 or newer (`java -version` shows it), the Android SDK, and `adb`.
`android/local.properties` must contain a line like `sdk.dir=/path/to/android-sdk` (Windows:
`sdk.dir=D:/android-sdk`); create the file if it is missing. `adb` comes with the SDK in `platform-tools/`.
Below, `adb` means that program; if it is not on your PATH, type its full path.

## 1. Start the server (on the server, over SSH)

```
cd sensibilia
./docker-up.sh
```

The script finds the server's network address by itself and prints the addresses to use, a line
`Root certificate saved to data/lab-ca/root.crt`, and a SHA-256 fingerprint. Write down the **server address**
(for example `192.168.1.20`) and the fingerprint. If the tablets or the workstation cannot connect later, open
the two ports on the server:

```
sudo ufw allow 1379/tcp && sudo ufw allow 1380/tcp
```

The certificate is created once and kept, even if you stop or reset the server. If you ever delete the
folder `data/dev-tls` on the server, a new certificate is made and you must do steps 2 to 4 again.

## 2. Copy the certificate to the workstation

On the workstation, in the project folder (replace `user` and `192.168.1.20`; adjust the path to where the
project lives on the server):

```
scp user@192.168.1.20:sensibilia/data/lab-ca/root.crt data/lab-ca/root.crt
```

(Create the folder `data/lab-ca` first if it does not exist. Windows 10 and 11 have `scp` built in.)
Without SSH access from the workstation you can download the same file with
`http://192.168.1.20:1380/certificate.crt`, but then check that `openssl x509 -in root.crt -noout -fingerprint -sha256`
shows the fingerprint you wrote down in step 1.

## 3. Build the app (on the workstation)

```
./build_android_app.sh
```

Run it from the project folder (on Windows, in Git Bash). It bakes in `data/lab-ca/root.crt`, stops if that
file is missing, and checks that the finished app contains the certificate. Do not run `./gradlew` by
itself: that builds an app without the certificate. Without Bash, the same build is `cd android` and then
`.\gradlew.bat assembleDebug "-PlabCa=..\data\lab-ca\root.crt"`.

The first build downloads things and can take several minutes. When it says `BUILD SUCCESSFUL`, the app
is the file `android/app/build/outputs/apk/debug/app-debug.apk`. This one file works on every tablet.

## 4. Prepare each tablet (once per tablet)

1. Settings > About tablet > Software information. Tap "Build number" seven times.
2. Go back. Settings > Developer options. Turn on "USB debugging".
3. Plug the tablet into the workstation with the cable.
4. A question "Allow USB debugging?" appears on the tablet. Tick "Always allow" and press Allow.

## 5. Install the app on the tablet

```
adb devices
```

The tablet must be listed with the word `device` after it. If it says `unauthorized`, look at the tablet
screen and press Allow. If the list is empty, try another cable or USB port (on Linux you may also need
the "udev rules" for Android devices). Then, from the `android` folder:

```
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(Windows: `app\build\outputs\apk\debug\app-debug.apk`.) `Success` means it is installed. Unplug the tablet,
plug in the next one and run only this last command again. Several tablets at once: add `-s SERIAL` after
`adb`, using the serial from the `devices` list.

## 6. Set up the tablet

1. On the workstation open the researcher screen in a browser at `https://192.168.1.20:1379/researcher/`
   (the server's address, not `localhost`). The browser warns about the certificate: either click
   through the warning (Advanced > Proceed), or, to avoid the warning, install `data/lab-ca/root.crt` on the
   workstation as a trusted root certificate (Windows: double-click it, Install Certificate, Local Machine,
   "Trusted Root Certification Authorities").
2. Laboratory terminals > Set up new tablet. The field "Server address for tablets" must show the server's
   address and port, for example `192.168.1.20:1379`. If it shows `localhost` or `127.0.0.1`, you opened the
   page the wrong way; go back to the address above.
3. On the tablet open the app "Sensibilia Assessor". Press "Scan setup code" and point the camera at the QR code
   on the workstation screen. Setup finishes by itself and the tablet registers.
4. To check the certificate on the tablet: press and hold the top-left corner, then Certificate. The
   fingerprint must equal the one you wrote down in step 1.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "built for a different certificate authority" | The server has a new certificate. Do steps 2, 3 and 5 again. |
| "Could not reach ..." | Tablet and server must be on the same network. Check the address, and the two firewall ports in step 1. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An older copy was built on another computer. Run `adb uninstall app.sensibilia.assessor`, then install again. |
| `adb` shows nothing or `unauthorized` | Re-plug the cable, check step 4, press Allow on the tablet. |
| `SDK location not found` | Add the line `sdk.dir=...` (your SDK folder) to `android/local.properties`. |
| `./docker-up.sh` prints no certificate line | The server was still starting. Run it again after a minute. |

Locking the tablet to the app (kiosk mode) is optional and described in [README.md](README.md).
