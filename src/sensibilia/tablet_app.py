"""Re-bake the tablet app with this laboratory's root certificate.

The portable zip carries a template APK that was built with a placeholder root
(``app/tablet-app/template.apk``) and a small signer (``signer.jar``, built from
``android/signer/`` with Google's apksig) that runs on the bundled Java runtime (``app/jre``).
Only the bytes of ``res/raw/lab_ca.crt`` differ between laboratories, so nothing is recompiled.
The signing key is created once per install in ``data/tablet-app/signing.p12``. Losing it means
tablets must uninstall the app before a new one installs, so backups include it.
"""

from __future__ import annotations

import hashlib
import secrets
import shutil
import struct
import subprocess
import zipfile
from pathlib import Path

CA_ENTRY = "res/raw/lab_ca.crt"
APK_NAME = "sensibilia-tablet.apk"
ALIAS = "sensibilia-tablet"


class Unavailable(Exception):
    """The template, signer or Java runtime is not part of this install."""


def replace_certificate(template: Path, certificate: bytes, target: Path) -> None:
    """Copy the template with the root swapped and its old signature removed (unsigned APK)."""
    with zipfile.ZipFile(template) as source, zipfile.ZipFile(target, "w") as output:
        names = source.namelist()
        if CA_ENTRY not in names:
            raise ValueError(f"The template app has no {CA_ENTRY}; rebuild it with -PlabCa.")
        for info in source.infolist():
            name = info.filename
            if name.startswith("META-INF/") and name.upper().endswith(
                (".SF", ".RSA", ".DSA", ".EC", ".MF")
            ):
                continue  # the old signature
            data = certificate if name == CA_ENTRY else source.read(name)
            copy = zipfile.ZipInfo(name, date_time=info.date_time)
            copy.compress_type = info.compress_type
            copy.external_attr = info.external_attr
            if info.compress_type == zipfile.ZIP_STORED:
                # Android needs stored entries (resources.arsc) 4-byte aligned. The data starts
                # after the 30-byte header, the name and the extra field.
                pad = (-(output.fp.tell() + 30 + len(name.encode()))) % 4
                if pad:
                    copy.extra = b"\x35\xd9" + struct.pack("<H", pad) + bytes(pad)
            output.writestr(copy, data)


def ensure(app: Path, out: Path, certificate: Path) -> Path:
    """Return the signed tablet APK for this root, building it when missing or out of date."""
    template = app / "tablet-app" / "template.apk"
    signer = app / "tablet-app" / "signer.jar"
    java = app / "jre" / "bin" / "java.exe"
    keytool = app / "jre" / "bin" / "keytool.exe"
    if not (template.is_file() and signer.is_file() and java.is_file() and keytool.is_file()):
        raise Unavailable("This install has no tablet app template.")
    pem = certificate.read_bytes()
    if b"BEGIN CERTIFICATE" not in pem:
        raise ValueError("The root certificate is not a PEM file.")
    out.mkdir(parents=True, exist_ok=True)
    apk, stamp = out / APK_NAME, out / "baked-for.sha256"
    digest = hashlib.sha256(pem).hexdigest()
    if (
        apk.is_file()
        and stamp.is_file()
        and stamp.read_text().strip() == digest
        and apk.stat().st_mtime >= template.stat().st_mtime  # a newer template needs a new bake
    ):
        return apk
    keystore, password_file = out / "signing.p12", out / "signing.pass"
    if not keystore.exists():
        # Created once; an existing key is never overwritten (tablets would reject the update).
        password = secrets.token_urlsafe(18)
        subprocess.run(
            [str(keytool), "-genkeypair", "-keystore", str(keystore), "-storetype", "PKCS12",
             "-storepass", password, "-keypass", password, "-alias", ALIAS, "-keyalg", "RSA",
             "-keysize", "3072", "-validity", "9125", "-dname", "CN=Sensibilia tablet app"],
            check=True, capture_output=True,
        )  # fmt: skip
        password_file.write_text(password, encoding="ascii")
    unsigned, signed = out / "unsigned.tmp", out / "signed.tmp"
    try:
        replace_certificate(template, pem, unsigned)
        subprocess.run(
            [str(java), "-jar", str(signer), str(unsigned), str(signed), str(keystore),
             str(password_file), ALIAS],
            check=True, capture_output=True,
        )  # fmt: skip
        shutil.move(signed, apk)
    finally:
        unsigned.unlink(missing_ok=True)
        signed.unlink(missing_ok=True)
    stamp.write_text(digest, encoding="ascii")
    return apk
