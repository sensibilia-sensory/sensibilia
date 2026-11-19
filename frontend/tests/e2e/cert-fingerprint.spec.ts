import { test, expect } from '@playwright/test';
import { groupFingerprint, pemFingerprint } from '../../src/shared/certFingerprint';

// A public test root (Caddy local CA) and its SHA-256 fingerprint computed independently.
const pem = `-----BEGIN CERTIFICATE-----
MIIBojCCAUmgAwIBAgIQLlto0zFmB5WzrBcFh3VEbDAKBggqhkjOPQQDAjAwMS4w
LAYDVQQDEyVDYWRkeSBMb2NhbCBBdXRob3JpdHkgLSAyMDI2IEVDQyBSb290MB4X
DTI2MTAxOTIxMzM0OFoXDTM2MDgyNzIxMzM0OFowMDEuMCwGA1UEAxMlQ2FkZHkg
TG9jYWwgQXV0aG9yaXR5IC0gMjAyNiBFQ0MgUm9vdDBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABDKjs5m/21ke8KeA3bnd7WH2hz11LJlTs49dXVmR8OpGbFy7uXB4
SSbUpY1mMTaWXVI3wLCEEa3A1p4gSI/TvaKjRTBDMA4GA1UdDwEB/wQEAwIBBjAS
BgNVHRMBAf8ECDAGAQH/AgEBMB0GA1UdDgQWBBQGOs5t6YLpN8wdcuZVbYvQUgx5
JDAKBggqhkjOPQQDAgNHADBEAiAO8eqsS1sDZWPQRvhqt6XTLXW7J2QgF/zsiFI0
MJHhQgIgVo1pRgkU5S2+EvkZwawRYpw2vPEF98r7mXg6TaxtDk8=
-----END CERTIFICATE-----`;

test('certificate fingerprint matches an independent SHA-256 of the DER bytes', async () => {
  const hex = await pemFingerprint(pem);
  expect(hex).toBe('C68123CB850149DE9EC90B8D0402AD44F4151D37194644EAD9D7605EDBFBE6E2');
  expect(groupFingerprint(hex).split(':')).toHaveLength(32);
});
