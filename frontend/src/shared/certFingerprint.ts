/** SHA-256 fingerprint (upper-case hex) of a PEM certificate; used to confirm a test CA by eye. */
export async function pemFingerprint(pem: string): Promise<string> {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der));
  return [...digest]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export const groupFingerprint = (hex: string) => hex.match(/.{2}/g)?.join(':') ?? hex;
