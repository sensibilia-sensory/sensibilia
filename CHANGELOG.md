# Changelog

Notable changes to Sensibilia, newest first. Changes land under **Unreleased** as they are made;
a release moves them under its version number and date. The Windows portable zip on the releases
page is built only from tagged versions, so anything under Unreleased is not in a download yet.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-21

### Fixed

- Tablet setup: when the researcher screen is opened on the server itself (as the Windows portable
  edition does at start), the setup code now carries the server's address on the laboratory network
  instead of `https://localhost:1379`, which tablets cannot reach. The Docker install does the same
  when `DEV_LAN_ADDRESS` is set.
- Run study: "Start first assessment" failed with "Request failed." on a booth whose earlier
  tablet had been removed or moved to another booth. The booth is now freed when its tablet is
  removed, and an earlier finished assessment no longer blocks the next tablet. Booths affected
  by this on an existing install start working after the update, with nothing to clean up. If
  the booth still has an assessment in progress, the page says so and offers "End assessment for
  booth n", which ends it and starts the new tablet.
- Windows portable edition: after an upgrade, the tablet app download is rebuilt from the new
  version instead of serving the app built by the previous one, and tablets no longer receive a
  cached copy of an older app.

## [0.1.0] - 2026-11-19

First public release.
