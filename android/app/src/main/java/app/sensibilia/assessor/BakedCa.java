package app.sensibilia.assessor;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * The laboratory root certificate built into this APK with {@code -PlabCa}, or none.
 * It is a trust anchor in the generated network security config; here it is only read so the app can
 * show its fingerprint and recognise a server that belongs to a different authority.
 */
final class BakedCa {
    private BakedCa() {}

    /** SHA-256 of the built-in root as upper-case hex, or null when this build has none. */
    static String fingerprint(Context context) {
        int id = context.getResources().getIdentifier("lab_ca", "raw", context.getPackageName());
        if (id == 0) return null;
        try (InputStream in = context.getResources().openRawResource(id)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return Servers.fingerprint(out.toByteArray());
        } catch (Exception e) {
            return null;
        }
    }
}
