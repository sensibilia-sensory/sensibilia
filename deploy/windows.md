# Windows portable edition

For a laboratory that runs Windows and has nobody who wants a console. Everything
is a double-click. The folder `READ ME FIRST.txt` in the zip says the same in shorter form.

## First time

1. Download `Sensibilia-<version>-windows-portable.zip` from the
   [releases page](../../../releases). **Right-click it, Properties, tick
   "Unblock", OK**, then unzip it somewhere that stays (the Desktop, or `D:\`). Skipping the unblock
   makes Windows warn about every file.
2. Double-click **Start Sensibilia**. A black window opens and the browser opens the researcher
   screen. If Windows asks about network access, choose *Private networks* and Allow.
   (SmartScreen: *More info*, *Run anyway*.)
3. Double-click **Allow tablets (firewall)** once and choose Yes. It opens TCP 1379 and 1380 on
   private networks only.
4. Before collecting real data, double-click **Set sign-in keys**. They are shown once and saved in
   `settings.env`; restart Sensibilia afterwards.
5. Set Windows to never sleep while collecting (Settings, System, Power).

## The tablet app

Start Sensibilia builds the tablet app for this computer (a second, offline). The black window
prints an address such as `http://192.168.0.20:1380/tablet-app.apk`. On each tablet open it in
Chrome, allow installing from this source once, and install. The app trusts only this computer's
certificate, so nothing is installed in Settings.

Testing with several laptops: every laptop is its own server with its own certificate. A tablet
that used laptop A must **synchronise, then uninstall the Sensibilia app**, before it installs
laptop B's. (Otherwise Android refuses the update, because the signatures differ.)

## Every day

| Do this | By double-clicking |
| --- | --- |
| Start (leave the window open; closing it stops Sensibilia, nothing is lost) | Start Sensibilia |
| Back up (daily while collecting; copy `data\backups` to a second disk or stick) | Back up |
| Put a backup back (the data it replaces is kept in `data\before-restore-<time>`) | Restore a backup |

A different backup disk: edit `settings.env`, e.g. `BACKUP_DIRECTORY=E:\SensibiliaBackups`. Backups
include the tablet app's signing key.

## Updating

Back up, then unzip the new version over the old folder and choose Replace. `data\` and
`settings.env` are not in the zip. The database is updated automatically on the next start, after
a verified backup.

## Moving between Docker and portable

Both use the same `data\` layout and the same backups. Copy `data\` (the database, images and
`dev-tls`, which holds the certificate authority) and start the other install.

## Problems

- *Already seems to be running*: another black window is open, or another program uses port 1379,
  1380 or 1381.
- A tablet cannot connect: run **Allow tablets (firewall)**; the computer and tablet must be on
  the same network, and the network must be a *Private* one in Windows.
- Errors are written in plain words in the window; details are in `data\logs`.
