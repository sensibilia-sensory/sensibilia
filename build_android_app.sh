#!/usr/bin/env bash
# Build the tablet app (android/) with the laboratory's root certificate
# baked in, so tablets need nothing installed in Settings.
#
#   ./build_android_app.sh                  build with data/lab-ca/root.crt (the default)
#   ./build_android_app.sh --ca FILE        bake in another PEM root (a copied or institutional root)
#   ./build_android_app.sh --install        also install on the connected tablet(s) with adb
#   ./build_android_app.sh --no-ca          build WITHOUT a baked certificate (system and
#                                           user-installed certificates; manual install flow)
#
# The root comes from ./docker-up.sh on the server (data/lab-ca/root.crt). If the server is a
# headless machine, copy that file to this computer first (android/INSTALL.md, step 2). The build
# stops when the file is missing instead of quietly building an app that does not trust the
# server. Result: android/app/build/outputs/apk/debug/app-debug.apk, one file for every tablet.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

CA=data/lab-ca/root.crt
BAKE=1
INSTALL=0
EXPECT_CA=0

for arg in "$@"; do
  if [ "$EXPECT_CA" = "1" ]; then
    CA="$arg"
    EXPECT_CA=0
    continue
  fi
  case "$arg" in
    --ca) EXPECT_CA=1 ;;
    --install) INSTALL=1 ;;
    --no-ca) BAKE=0 ;;
    -h | --help)
      sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (see ./build_android_app.sh --help)" >&2
      exit 2
      ;;
  esac
done
if [ "$EXPECT_CA" = "1" ]; then
  echo "--ca needs a file name (see ./build_android_app.sh --help)" >&2
  exit 2
fi

APK=android/app/build/outputs/apk/debug/app-debug.apk
BAKED=android/app/build/generated/labCa/res/raw/lab_ca.crt

fingerprint() {
  if command -v openssl > /dev/null 2>&1; then
    openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^.*=//'
  else
    echo "(openssl not installed; compare the fingerprint on the tablet's setup screen with the researcher screen)"
  fi
}

if ! command -v java > /dev/null 2>&1; then
  echo "Java 17 or newer is needed to build the app (android/INSTALL.md)." >&2
  exit 1
fi
if [ ! -f android/local.properties ] && [ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]; then
  echo "The Android SDK location is not set: add the line sdk.dir=/path/to/android-sdk to" >&2
  echo "android/local.properties (android/INSTALL.md)." >&2
  exit 1
fi

GRADLE_ARGS=(assembleDebug)
if [ "$BAKE" = "1" ]; then
  if [ ! -f "$CA" ]; then
    echo "Laboratory root certificate not found: $CA" >&2
    echo "Run ./docker-up.sh on the server, copy data/lab-ca/root.crt here (android/INSTALL.md," >&2
    echo "step 2), or pass --ca FILE. To build without a certificate on purpose: --no-ca." >&2
    exit 1
  fi
  if ! grep -q "BEGIN CERTIFICATE" "$CA"; then
    echo "$CA is not a PEM certificate (it must contain -----BEGIN CERTIFICATE-----)." >&2
    exit 1
  fi
  # Gradle resolves the path against android/. A relative path avoids drive-letter and
  # path-conversion trouble on Windows (Git Bash).
  CA_ARG="$(realpath --relative-to=android "$CA" 2> /dev/null || realpath "$CA")"
  GRADLE_ARGS+=("-PlabCa=$CA_ARG")
  echo "Baking in the laboratory root certificate: $CA"
  echo "  SHA-256 $(fingerprint "$CA")"
else
  echo "Building WITHOUT a baked certificate (--no-ca): tablets need the root installed in Settings."
fi

(cd android && ./gradlew "${GRADLE_ARGS[@]}")

# Check what was built rather than trusting the command line.
if [ "$BAKE" = "1" ]; then
  if ! cmp -s "$CA" "$BAKED"; then
    echo "The build did not include $CA (expected $BAKED). Do not install this app." >&2
    exit 1
  fi
elif [ -e "$BAKED" ]; then
  echo "A certificate was baked in although --no-ca was given. Do not install this app." >&2
  exit 1
fi

echo
echo "Built $APK"
if [ "$BAKE" = "1" ]; then
  echo "It trusts the system store and the root above. After setup on a tablet, the fingerprint"
  echo "under the staff menu > Certificate must equal it."
fi

if [ "$INSTALL" = "1" ]; then
  if ! command -v adb > /dev/null 2>&1; then
    echo "adb not found on PATH; install with: adb install -r $APK (android/INSTALL.md, step 5)." >&2
    exit 1
  fi
  adb install -r "$APK"
else
  echo "Install on a tablet over USB: adb install -r $APK   (or rerun with --install)"
fi
