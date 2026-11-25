package app.sensibilia.assessor;

import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * The app updates itself from the server it is set up for. The server publishes
 * {@code /tablet-app.json} (version and SHA-256) next to {@code /tablet-app.apk}; both are fetched
 * over the HTTPS connection the app already trusts. A newer build signed with the same key installs
 * over this one and keeps the saved server, the pairing and stored answers.
 */
final class Updater {
    private Updater() {}

    /** A newer build the server offers. */
    static final class Offer {
        final long code;
        final String name;
        final String sha256;

        Offer(long code, String name, String sha256) {
            this.code = code;
            this.name = name;
            this.sha256 = sha256;
        }
    }

    private static final Pattern CODE = Pattern.compile("\"version_code\"\\s*:\\s*(\\d{1,9})");
    private static final Pattern NAME =
            Pattern.compile("\"version_name\"\\s*:\\s*\"([0-9A-Za-z.+-]{1,32})\"");
    private static final Pattern SHA = Pattern.compile("\"sha256\"\\s*:\\s*\"([0-9a-fA-F]{64})\"");

    /** The offer in tablet-app.json when it is newer than {@code installed}, else null. */
    static Offer parse(String json, long installed) {
        if (json == null) return null;
        Matcher code = CODE.matcher(json), name = NAME.matcher(json), sha = SHA.matcher(json);
        if (!code.find() || !name.find() || !sha.find()) return null;
        long offered = Long.parseLong(code.group(1));
        if (offered <= installed) return null;
        return new Offer(offered, name.group(1), sha.group(1).toLowerCase(Locale.ROOT));
    }

    /** This app's version code and name. */
    static PackageInfo installed(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Asks the server; null when there is nothing newer or the server has no tablet app. */
    static Offer check(String origin, long installed) throws IOException {
        HttpsURLConnection c =
                (HttpsURLConnection) new URL(origin + "/tablet-app.json").openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            try (InputStream in = c.getInputStream()) {
                byte[] body = read(in, 4096);
                return parse(new String(body, StandardCharsets.UTF_8), installed);
            }
        } finally {
            c.disconnect();
        }
    }

    /** Downloads the APK into the cache and checks it against the offer's SHA-256. */
    static File download(Context context, String origin, Offer offer) throws Exception {
        File target = new File(context.getCacheDir(), "update.apk");
        HttpsURLConnection c =
                (HttpsURLConnection) new URL(origin + "/tablet-app.apk").openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try {
            if (c.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("The server answered " + c.getResponseCode());
            }
            try (InputStream in = c.getInputStream();
                    OutputStream out = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) {
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                }
            }
        } finally {
            c.disconnect();
        }
        if (!hex(digest.digest()).equals(offer.sha256)) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new IOException("The downloaded app does not match the server's checksum. "
                    + "Nothing was installed.");
        }
        return target;
    }

    /** True when this app is device owner, so the update installs without a prompt. */
    static boolean silent(Context context) {
        DevicePolicyManager dpm =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        return dpm != null && dpm.isDeviceOwnerApp(context.getPackageName());
    }

    /** Hands the APK to Android; the outcome arrives in {@link UpdateReceiver}. */
    static void install(Context context, File apk) throws IOException {
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(context.getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk);
                    OutputStream out = session.openWrite("sensibilia-tablet.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                session.fsync(out);
            }
            Intent result = new Intent(context, UpdateReceiver.class)
                    .setAction(UpdateReceiver.ACTION_RESULT);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(context, id, result, flags);
            session.commit(pending.getIntentSender());
        } catch (IOException | RuntimeException e) {
            installer.abandonSession(id);
            throw e;
        }
    }

    /** Plain words for an install status from PackageInstaller, or null for success. */
    static String problem(int status, String detail) {
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS:
                return null;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "Android refused the update because it is signed differently from the app on "
                        + "this tablet (the server's tablet app key changed, or this app came from "
                        + "another server). Synchronise, uninstall the Sensibilia app and set the "
                        + "tablet up again.";
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return "The update was cancelled. Nothing changed.";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "The tablet does not have enough free storage for the update.";
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "The update was blocked on this tablet. Allow Sensibilia to install apps "
                        + "(Settings, Apps, Special app access, Install unknown apps).";
            default:
                return "The update did not install" + (detail == null ? "." : ": " + detail);
        }
    }

    private static byte[] read(InputStream in, int limit) throws IOException {
        byte[] buffer = new byte[limit];
        int total = 0;
        for (int n; total < limit && (n = in.read(buffer, total, limit - total)) > 0; ) total += n;
        byte[] out = new byte[total];
        System.arraycopy(buffer, 0, out, 0, total);
        return out;
    }

    static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder();
        for (byte b : bytes) text.append(String.format(Locale.ROOT, "%02x", b));
        return text.toString();
    }
}
