# Changelog

Notable changes to Sensibilia, newest first. Changes land under **Unreleased** as they are made;
a release moves them under its version number and date. The Windows portable zip on the releases
page is built only from tagged versions, so anything under Unreleased is not in a download yet.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Run study floor: each running booth shows its next sample underneath (switch off with "Next
  sample under booths"). The "Sample table" switch shows a table on the floor with the sample each
  assessor is assessing and the next 1 to 5 samples, the next one highlighted.
- Run study list: shows the same as the floor (status, step, current step, loop sample, what each
  assessor is assessing and the next samples, the next one highlighted). A Columns menu chooses
  which columns show, how many samples ahead, and whether product labels show. Drag a column
  header's edge to resize it, double-click the edge to fit the content; "Reset column widths"
  goes back to the standard widths.
- Booths can be renamed by double-clicking their name (or pressing F2) on the floor or in the
  list, or in the booth panel. The name
  is shown on that computer only; the room layout and recorded data keep the booth's own name.
- Tablet app updates itself: after the server is updated, tablets show "Update tablet app" on the
  waiting and handover screens and in the press-and-hold corner menu. One tap installs the new app
  over the old one; the tablet restarts and stays set up, with no uninstalling or pairing again.
  Tablets in kiosk mode set up as device owner update without any further question. Tablets with
  an app from before this version need the new app installed once by hand.
- Run study: the List tab shows each tablet's app version, as "0.1.2 → 0.1.3" when the tablet is
  behind the server.

### Fixed

- Run study: the step counter counts each pass through a sample loop, so "step 9 of 26 (sample 2 of
  5)" instead of repeating the loop's steps for every sample.
- Study sequence: a step dragged and dropped quickly was sometimes left where it was.
- Run study: the List tab's action buttons ("Serve samples" with "End assessment") no longer get
  cut off.

## [0.1.2] - 2026-11-22

### Added

- Run study: each booth now shows the next sample its assessor will need ("next sample 482"), and
  the booth panel shows its code and product, so staff can prepare it before the tablet asks. The
  floor also has a "Next samples" box listing every running assessor with their next sample; drag
  it anywhere on the floor and it stays there in that browser.

### Fixed

- Tablets: each new question screen now opens at the top. Long lists such as a RATA attribute list
  used to open part-way down, at the scroll position of the previous screen.
- Tablet app: when the server certificate is rejected, setup now says why. A wrong date or time on
  the tablet, or a setup code for the wrong address, used to be reported as "not signed by the
  certificate authority built into this app" even when the app was the right build.
- Tablets: pressing Go or Enter on the on-screen keyboard in a text or number answer now closes the
  keyboard, so Save and continue is reachable without tapping outside it.

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
