# Running Sensibilia in a small laboratory

This guide is for the standard install: one server computer in the laboratory, a few tablets, and
nobody from IT involved. If your institution supplies
the certificate, the host and backup monitoring, the optional [institution-managed
deployment](operations.md) is the alternative.

Everything is one script, `./docker-up.sh`, run from the Sensibilia folder on the server. The server
needs Linux, `git`, Docker Engine with Compose v2, and internet access once, for the first build.

## What lives where

Everything the laboratory collects is in the `data/` folder next to the script. Docker volumes hold
none of it, so `docker compose down -v` removes nothing that matters.

| Folder | Contents | If it is lost |
| --- | --- | --- |
| `data/server` | the database: studies, sessions, responses | collected data is gone; restore from a backup |
| `data/assets` | stimulus images | images are gone; restore from a backup |
| `data/dev-tls` | the laboratory certificate authority | tablets no longer trust the server; build the Android app again |
| `data/backups` | verified backups (or the folder you choose) | you lose the safety copies, not the live data |
| `data/lab-ca/root.crt` | public copy of the root certificate | run `./docker-up.sh` again to save it |

The application runs as an unprivileged user (id 10001), so `data/server`, `data/assets` and the
backups belong to that user. To copy them by hand, use `sudo`.

## First install

```bash
git clone <repository-url> sensibilia && cd sensibilia
./docker-up.sh --password
```

`--password` generates the researcher and operator keys, saves them in `.env` and prints them once.
Leave it out only on a network you trust completely: without keys, anyone who can reach port 1379 has
full access. The script prints the addresses to open and the fingerprint of the laboratory root
certificate. To get the tablets going, follow [android/INSTALL.md](../android/INSTALL.md).

## Daily routine

| When | Command | What it tells you |
| --- | --- | --- |
| Start of a session day | `./docker-up.sh status` | `created_at` of the last verified backup; it fails if there is none from the last 26 hours |
| Before changes, and after each session day | `./docker-up.sh backup` | writes a verified copy of the database and the images |
| After a backup | copy the backup folder to a second disk | a copy that survives the server disk failing |

During collection, run `backup` every hour with cron (`crontab -e`):

```
0 * * * * cd /home/lab/sensibilia && ./docker-up.sh backup >> data/backup.log 2>&1
```

Nothing alerts anyone when a backup fails. The `status` check is the alarm: do it before every
session and do not start one if it fails.

Point the backups at a second disk, or a USB drive that stays plugged in, by adding this line to `.env`
in the Sensibilia folder:

```
BACKUP_DIRECTORY=/mnt/usb/sensibilia
```

A second folder on the same disk is not a safety copy.

## When the address changes

The proxy answers only for `localhost` and the server's LAN address. `./docker-up.sh` finds the
address itself, also on a network without internet. After a change of network or a new DHCP lease,
run it again: it keeps the same certificate authority and makes a new server certificate for the new
address. To fix an address, add `DEV_LAN_ADDRESS=192.168.1.20` to `.env`.

Each tablet stores the server address. Change it in the app's staff menu (Change server) or pair the
tablet again from the researcher screen. Ask whoever runs the network for a fixed address or a DHCP
reservation for the server, so this does not come up.

## Moving the server to another network or computer

The same computer on a different network needs nothing more than `./docker-up.sh`. Starting does not
need internet, because it only builds the application image when it is missing.

To move to another computer, install Docker there, then:

1. On the old server, stop it (`./docker-up.sh down`) and save the images: `docker save -o images.tar sensibilia-dev:local caddy:2`.
2. Copy the whole Sensibilia folder, including `data/`, with `sudo cp -a` or `sudo tar`, and `images.tar`.
3. On the new computer run `docker load -i images.tar`, then `./docker-up.sh`.

`data/dev-tls` travels with `data/`, so the Android app you already installed keeps trusting the
server. Without it the new server gets a new authority and every tablet needs a rebuilt app.

## Updating

Updating is the one step that needs internet. Finish and synchronise every tablet first, so nothing is
pending, then:

```bash
git pull
./docker-up.sh update
```

It backs up first, rebuilds the application image and restarts. The database is migrated on start. If
anything looks wrong afterwards, restore the backup it just made.

## Restoring a backup

```bash
ls data/backups                       # or your BACKUP_DIRECTORY
./docker-up.sh restore 20261117T153903518469Z-3e9b63e35ea54688845f2049dcbb26ae.db
./docker-up.sh
```

`restore` stops the server and moves the current data to `data/before-restore-<time>`; it never
deletes it. It then restores the database and images from that backup and checks their checksums and
counts. After starting, open a study and an export to confirm it is what you expect. Tablets keep their
own unsent answers; do not clear a tablet's data, because the original event identifiers are needed to
reconcile them.

## What this install does not give you

- No off-machine copy and no alert on its own: the second disk and the daily `status` check are yours to
  do.
- A private certificate authority, not one your browsers already trust. Tablets with the Android app
  trust it without installing anything; a laptop browser shows a warning until you install the root
  from `http://<address>:1380/certificate.crt`.
- Any key is shared by everyone who holds it, and audit records name the staff member only as typed.
- Validation on your own server and tablets, including a restore drill, before you collect data
  from people.
