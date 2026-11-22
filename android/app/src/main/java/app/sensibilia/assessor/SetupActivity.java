package app.sensibilia.assessor;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.appcompat.app.AppCompatActivity;

import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;

import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * First-run (and change-server) screen. The tablet learns the server from the setup QR on the
 * researcher screen, or from a typed host:port; the address is never compiled in.
 */
public class SetupActivity extends AppCompatActivity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ServerPrefs prefs;
    private Servers.Target target;
    private byte[] rootPem;

    private EditText address;
    private TextView status;
    private String baked;
    private LinearLayout certificate;
    private TextView fingerprint;
    private TextView verdict;
    private Button save;

    private final ActivityResultLauncher<ScanOptions> scanner =
            registerForActivityResult(new ScanContract(), result -> {
                if (result.getContents() != null) {
                    address.setText(result.getContents());
                    begin(result.getContents());
                }
            });

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new ServerPrefs(this);
        baked = BakedCa.fingerprint(this);
        build();
        String saved = prefs.origin();
        if (saved != null) address.setText(saved);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(Color.parseColor("#1D2420"));
        if (bold) t.setTypeface(t.getTypeface(), Typeface.BOLD);
        t.setPadding(0, dp(8), 0, dp(4));
        return t;
    }

    private Button button(String label, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setMinHeight(dp(48));
        b.setOnClickListener(click);
        return b;
    }

    private void build() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(24), dp(24), dp(24));
        root.addView(text("Set up this tablet", 24, true));
        root.addView(text(
                "Scan the setup code shown on the researcher screen (Laboratory terminals, Set up new "
                        + "tablet), or type the server address.", 16, false));
        root.addView(button("Scan setup code", v -> scanner.launch(new ScanOptions()
                .setPrompt("Point the camera at the setup code")
                .setBeepEnabled(false)
                .setOrientationLocked(false)
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE))));
        address = new EditText(this);
        address.setHint("Server address, for example 192.168.1.20:1379");
        address.setSingleLine();
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        root.addView(address, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(button("Continue", v -> begin(address.getText().toString())));
        status = text("", 16, false);
        root.addView(status);
        if (baked != null) {
            root.addView(text("Certificate authority built into this app (SHA-256)", 14, false));
            TextView built = text(Servers.grouped(baked), 14, false);
            built.setTypeface(Typeface.MONOSPACE);
            root.addView(built);
        }

        certificate = new LinearLayout(this);
        certificate.setOrientation(LinearLayout.VERTICAL);
        certificate.setVisibility(View.GONE);
        certificate.addView(text("The server certificate is not trusted yet", 18, true));
        certificate.addView(text(
                "The server uses its own certificate authority. Check that the fingerprint below is the "
                        + "one shown on the researcher screen before you install it.", 16, false));
        fingerprint = text("", 16, false);
        fingerprint.setTypeface(Typeface.MONOSPACE);
        certificate.addView(fingerprint);
        verdict = text("", 16, true);
        certificate.addView(verdict);
        save = button("Save certificate and open Settings", v -> installRoot());
        certificate.addView(save);
        certificate.addView(button("I installed it, check again", v -> {
            if (target != null) begin(target.origin);
        }));
        root.addView(certificate);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);
    }

    private void say(String message, boolean problem) {
        status.setText(message);
        status.setTextColor(Color.parseColor(problem ? "#A63A2E" : "#1D2420"));
    }

    private void begin(String input) {
        Servers.Target parsed = Servers.parse(input);
        if (parsed == null) {
            say("That is not a server address.", true);
            return;
        }
        target = parsed;
        certificate.setVisibility(View.GONE);
        if (Servers.caMismatch(baked, parsed.caFingerprint)) {
            say("This app was built for a different certificate authority than the one this server "
                    + "uses. Install the app build made for this server.", true);
            return;
        }
        say("Checking " + parsed.origin + " ...", false);
        worker.execute(() -> {
            try {
                Servers.checkTrusted(parsed.origin);
                runOnUiThread(() -> finishSetup(parsed));
            } catch (javax.net.ssl.SSLException e) {
                Servers.TlsProblem problem = Servers.classify(e);
                String detail = "\n\nDetails: " + Servers.rootMessage(e);
                if (problem == Servers.TlsProblem.CLOCK) {
                    String now = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.ROOT)
                            .format(new java.util.Date());
                    runOnUiThread(() -> say("This tablet's date or time is wrong (it says " + now
                            + "). The server certificate is only valid for a few hours, so the clock "
                            + "must be right. Open Settings, Date and time, set the correct date, time "
                            + "and time zone, then try again." + detail, true));
                } else if (problem == Servers.TlsProblem.ADDRESS) {
                    runOnUiThread(() -> say("The server certificate is not made for the address "
                            + parsed.origin + ". Scan the setup code again from the researcher screen "
                            + "opened on the server's laboratory address." + detail, true));
                } else if (baked != null) {
                    // Installing a certificate in Settings would not help: this build trusts only
                    // the authority built into it.
                    runOnUiThread(() -> say("The server certificate is not signed by the "
                            + "certificate authority built into this app. Install the app build made "
                            + "for this server." + detail, true));
                } else {
                    loadCertificate(parsed);
                }
            } catch (Exception e) {
                runOnUiThread(() -> say("Could not reach " + parsed.origin + ": " + e.getMessage(), true));
            }
        });
    }

    private void loadCertificate(Servers.Target parsed) {
        try {
            byte[] pem = Servers.downloadRoot(parsed.origin);
            String hex = Servers.fingerprint(pem);
            runOnUiThread(() -> showCertificate(pem, hex));
        } catch (Exception e) {
            runOnUiThread(() -> say(
                    "The certificate is not trusted and the server does not publish a root certificate: "
                            + e.getMessage(), true));
        }
    }

    private void showCertificate(byte[] pem, String hex) {
        rootPem = pem;
        say("", false);
        certificate.setVisibility(View.VISIBLE);
        fingerprint.setText("SHA-256\n" + Servers.grouped(hex));
        if (target.caFingerprint == null) {
            verdict.setText("Compare this with the fingerprint on the researcher screen.");
            verdict.setTextColor(Color.parseColor("#1D2420"));
            save.setEnabled(true);
        } else if (target.caFingerprint.equals(hex)) {
            verdict.setText("Matches the setup code.");
            verdict.setTextColor(Color.parseColor("#1F5C46"));
            save.setEnabled(true);
        } else {
            verdict.setText(
                    "Does NOT match the setup code. Do not install this certificate; ask the lab lead.");
            verdict.setTextColor(Color.parseColor("#A63A2E"));
            save.setEnabled(false);
        }
    }

    private void installRoot() {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, "sensibilia-test-ca.crt");
            values.put(MediaStore.Downloads.MIME_TYPE, "application/x-x509-ca-cert");
            values.put(MediaStore.Downloads.RELATIVE_PATH, "Download");
            ContentResolver resolver = getContentResolver();
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("Could not write the certificate file");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                out.write(rootPem);
            }
            say("Saved as Downloads, sensibilia-test-ca.crt. In Settings open Security, More security "
                    + "settings, Install a certificate, CA certificate, pick that file, then come back and "
                    + "press I installed it.", false);
            startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
        } catch (Exception e) {
            say("Could not save the certificate: " + e.getMessage(), true);
        }
    }

    private void finishSetup(Servers.Target done) {
        prefs.save(done.origin, done.pairingCode);
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    @Override
    protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }
}
