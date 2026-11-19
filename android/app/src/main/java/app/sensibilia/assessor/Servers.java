package app.sensibilia.assessor;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Locale;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Address parsing and the two network checks used at setup. */
final class Servers {
    private Servers() {}

    /** What a setup QR or typed text means: the server, the CA fingerprint and the pairing code. */
    static final class Target {
        final String origin;
        final String caFingerprint; // upper-case hex or null
        final String pairingCode; // or null

        Target(String origin, String caFingerprint, String pairingCode) {
            this.origin = origin;
            this.caFingerprint = caFingerprint;
            this.pairingCode = pairingCode;
        }
    }

    /** Accepts host:port, https://host:port/anything, or the pairing URL from the researcher screen. */
    static Target parse(String input) {
        if (input == null) return null;
        String text = input.trim();
        if (text.isEmpty()) return null;
        if (!text.contains("://")) text = "https://" + text;
        URI uri;
        try {
            uri = new URI(text);
        } catch (URISyntaxException e) {
            return null;
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return null;
        // The app only ever speaks HTTPS, whatever the pasted text said.
        String origin = "https://" + host + (uri.getPort() > 0 ? ":" + uri.getPort() : "");
        String ca = null;
        if (uri.getRawQuery() != null) {
            for (String pair : uri.getRawQuery().split("&")) {
                if (pair.startsWith("ca=")) ca = pair.substring(3);
            }
        }
        String code = uri.getRawFragment();
        return new Target(
                origin,
                ca == null || ca.isEmpty() ? null : ca.replace(":", "").toUpperCase(Locale.ROOT),
                code == null || code.isEmpty() ? null : code);
    }

    /** Succeeds when the server answers over HTTPS with a certificate the tablet trusts. */
    static void checkTrusted(String origin) throws Exception {
        HttpsURLConnection c = (HttpsURLConnection) new URL(origin + "/health").openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("Server answered " + c.getResponseCode());
        } finally {
            c.disconnect();
        }
    }

    /**
     * Downloads the published root certificate. The connection is deliberately not verified, because
     * the point is to learn a root the tablet does not trust yet; the caller shows its fingerprint to a
     * person and compares it before anything is installed.
     */
    static byte[] downloadRoot(String origin) throws Exception {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] {new TrustEveryone()}, new SecureRandom());
        HttpsURLConnection c =
                (HttpsURLConnection) new URL(origin + "/certificate.crt").openConnection();
        c.setSSLSocketFactory(context.getSocketFactory());
        c.setHostnameVerifier((host, session) -> true);
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        try {
            if (c.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new Exception("No certificate is published (" + c.getResponseCode() + ")");
            }
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    static String fingerprint(byte[] pem) throws Exception {
        X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(pem));
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(cert.getEncoded());
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(Locale.ROOT, "%02X", b));
        return hex.toString();
    }

    /**
     * True when the setup code names a certificate authority other than the one built into this app.
     * Either side missing means there is nothing to compare, so it is not a mismatch.
     */
    static boolean caMismatch(String baked, String fromSetupCode) {
        if (baked == null || fromSetupCode == null) return false;
        return !normalise(baked).equals(normalise(fromSetupCode));
    }

    private static String normalise(String hex) {
        return hex.replace(":", "").trim().toUpperCase(Locale.ROOT);
    }

    static String grouped(String hex) {
        return hex.replaceAll("(.{2})(?!$)", "$1:");
    }

    private static final class TrustEveryone implements X509TrustManager {
        @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
}
