package app.sensibilia.assessor;

import android.content.Context;
import android.content.SharedPreferences;

/** The server address learned at setup. Nothing about the laboratory is compiled in. */
final class ServerPrefs {
    private static final String FILE = "server";
    private static final String ORIGIN = "origin";
    private static final String PENDING_CODE = "pending_code";

    private final SharedPreferences prefs;

    ServerPrefs(Context context) {
        prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** https://host[:port] or null before setup. */
    String origin() {
        return prefs.getString(ORIGIN, null);
    }

    void save(String origin, String pairingCode) {
        prefs.edit().putString(ORIGIN, origin).putString(PENDING_CODE, pairingCode).apply();
    }

    /** One-time pairing code from the setup QR, consumed when the first page opens. */
    String takePairingCode() {
        String code = prefs.getString(PENDING_CODE, null);
        prefs.edit().remove(PENDING_CODE).apply();
        return code;
    }

    void clear() {
        prefs.edit().clear().apply();
    }
}
