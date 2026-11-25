package app.sensibilia.assessor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Full-screen assessor. The page is the PWA served by the laboratory server; this shell only adds
 * the saved server address, kiosk (lock task) mode and a press-and-hold staff corner.
 */
public class MainActivity extends Activity {
    private static final long HOLD_MS = 900;
    /** A kiosk tablet never leaves the foreground, so the update check also repeats. */
    private static final long CHECK_EVERY_MS = 10 * 60 * 1000;

    private ServerPrefs prefs;
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private boolean kioskStarted;
    private String origin;
    private long installedCode;
    private String installedName;
    /** A newer app the server offers, or null. */
    private volatile Updater.Offer offer;
    /** Host of the page now shown; the bridge answers only pages from the saved server. */
    private volatile String pageHost;
    private boolean updating;
    private final Runnable periodicCheck = new Runnable() {
        @Override
        public void run() {
            checkForUpdate(null);
            handler.postDelayed(this, CHECK_EVERY_MS);
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new ServerPrefs(this);
        origin = prefs.origin();
        if (origin == null) {
            startActivity(new Intent(this, SetupActivity.class));
            finish();
            return;
        }
        KioskAdmin.allowLockTask(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout frame = new FrameLayout(this);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            // Debug builds only: lets developers inspect the page from chrome://inspect.
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F7F7F1"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        // The server shows staff which tablets run an older app.
        android.content.pm.PackageInfo info = Updater.installed(this);
        installedCode = info.getLongVersionCode();
        installedName = info.versionName;
        settings.setUserAgentString(settings.getUserAgentString()
                + " SensibiliaTablet/" + installedCode + "/" + installedName);
        web.addJavascriptInterface(new Bridge(), "SensibiliaTablet");
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new Client(Uri.parse(origin).getHost()));
        frame.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Press and hold the top-left corner for staff options; the web page keeps the bottom-right.
        View corner = new View(this);
        int size = Math.round(72 * getResources().getDisplayMetrics().density);
        Runnable open = this::staffMenu;
        corner.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    handler.postDelayed(open, HOLD_MS);
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    handler.removeCallbacks(open);
                    return true;
                default:
                    return true;
            }
        });
        frame.addView(corner, new FrameLayout.LayoutParams(size, size));
        setContentView(frame);

        String pairing = prefs.takePairingCode();
        web.loadUrl(origin + (pairing == null ? "/assessor/" : "/assessor/pair#" + pairing));
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
        if (!kioskStarted && web != null) {
            kioskStarted = true;
            try {
                startLockTask();
            } catch (Exception ignored) {
                // Not provisioned as device owner and pinning was declined: run unlocked.
            }
        }
        if (web != null) {
            handler.removeCallbacks(periodicCheck);
            handler.post(periodicCheck);
            String problem = UpdateReceiver.takeProblem(this);
            if (problem != null) {
                updating = false;
                say("Tablet app not updated", problem);
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(periodicCheck);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdownNow();
    }

    /** Asks the server for a newer app; quiet when there is none or the server is unreachable. */
    private void checkForUpdate(Runnable then) {
        if (origin == null) return;
        worker.execute(() -> {
            try {
                offer = Updater.check(origin, installedCode);
            } catch (Exception e) {
                // Unreachable or no tablet app on this server: keep what we knew, say nothing.
            }
            if (then != null) runOnUiThread(then);
        });
    }

    /** Downloads, checks and installs the offered app. Staff start this; it never runs by itself. */
    private void startUpdate() {
        Updater.Offer wanted = offer;
        if (wanted == null || updating) return;
        updating = true;
        AlertDialog progress = new AlertDialog.Builder(this)
                .setTitle("Updating the tablet app")
                .setMessage("Downloading version " + wanted.name + ". The tablet restarts by itself "
                        + "and stays set up. Answers stored on this tablet are kept.")
                .setCancelable(false)
                .show();
        worker.execute(() -> {
            try {
                java.io.File apk = Updater.download(this, origin, wanted);
                runOnUiThread(() -> {
                    try {
                        if (!Updater.silent(this)) {
                            // Android's confirmation cannot appear in kiosk mode; it resumes after.
                            try {
                                stopLockTask();
                            } catch (Exception ignored) {
                                // Not in lock task mode.
                            }
                            kioskStarted = false;
                        }
                        Updater.install(this, apk);
                    } catch (Exception e) {
                        progress.dismiss();
                        updating = false;
                        say("Tablet app not updated", "The update could not start: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    progress.dismiss();
                    updating = false;
                    say("Tablet app not updated", "Could not download the update: "
                            + e.getMessage() + "\n\nThe tablet keeps working with the current app.");
                });
            }
        });
    }

    private void say(String title, String message) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("Close", null)
                .show();
    }

    /**
     * What the tablet web app may ask the shell. Answers only pages from the saved
     * server; every method runs on a WebView thread, so UI work is posted to the main thread.
     */
    private final class Bridge {
        private boolean trusted() {
            return origin != null && Uri.parse(origin).getHost().equals(pageHost);
        }

        /** The newer version the server offers, or "" when there is none. */
        @JavascriptInterface
        public String offeredVersion() {
            Updater.Offer current = offer;
            return trusted() && current != null ? current.name : "";
        }

        /** This app's version. */
        @JavascriptInterface
        public String installedVersion() {
            return trusted() ? installedName : "";
        }

        /** Starts the update staff asked for. */
        @JavascriptInterface
        public void installUpdate() {
            if (trusted()) runOnUiThread(MainActivity.this::startUpdate);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Participants cannot leave the assessment with Back; only in-page history is honoured.
        if (web != null && web.canGoBack()) web.goBack();
    }

    private void staffMenu() {
        Updater.Offer current = offer;
        String update = current != null
                ? "Update tablet app to " + current.name
                : "Check for app update (this app: " + installedName + ")";
        String[] items = {"Reload", "Change server", "Leave kiosk mode", "Certificate", update, "Close"};
        new AlertDialog.Builder(this)
                .setTitle("Staff")
                .setItems(items, (dialog, which) -> {
                    if (which == 4) {
                        if (current != null) {
                            startUpdate();
                        } else {
                            checkForUpdate(() -> {
                                Updater.Offer found = offer;
                                if (found != null) {
                                    new AlertDialog.Builder(this)
                                            .setTitle("Update available")
                                            .setMessage("The server has tablet app " + found.name
                                                    + "; this tablet has " + installedName + ".")
                                            .setPositiveButton("Update now", (d, w) -> startUpdate())
                                            .setNegativeButton("Later", null)
                                            .show();
                                } else {
                                    say("No update", "This tablet has the newest app the server "
                                            + "offers (" + installedName + "), or the server could "
                                            + "not be reached.");
                                }
                            });
                        }
                    } else if (which == 0) {
                        web.reload();
                    } else if (which == 1) {
                        prefs.clear();
                        startActivity(new Intent(this, SetupActivity.class));
                        finish();
                    } else if (which == 2) {
                        try {
                            stopLockTask();
                        } catch (Exception ignored) {
                            // Not in lock task mode.
                        }
                    } else if (which == 3) {
                        String baked = BakedCa.fingerprint(this);
                        new AlertDialog.Builder(this)
                                .setTitle("Certificate authority")
                                .setMessage(baked == null
                                        ? "None built into this app. It trusts certificates installed "
                                                + "on this tablet."
                                        : "Built into this app (SHA-256):\n" + Servers.grouped(baked)
                                                + "\n\nCompare with the fingerprint on the "
                                                + "researcher screen.")
                                .setPositiveButton("Close", null)
                                .show();
                    }
                })
                .show();
    }

    /** Keeps navigation on the saved server and never proceeds past a certificate error. */
    private final class Client extends WebViewClient {
        private final String host;

        Client(String host) {
            this.host = host;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !host.equals(request.getUrl().getHost());
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            // Error pages are loaded without a URL, so they never count as the server.
            pageHost = url == null ? null : Uri.parse(url).getHost();
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            switch (error.getPrimaryError()) {
                case SslError.SSL_DATE_INVALID:
                case SslError.SSL_EXPIRED:
                case SslError.SSL_NOTYETVALID:
                    problem("This tablet's date or time is wrong, so it cannot check the server "
                            + "certificate. Set the correct date, time and time zone in Settings.");
                    break;
                case SslError.SSL_IDMISMATCH:
                    problem("The server certificate is not made for this server address. Set up the "
                            + "tablet again with the setup code from the researcher screen.");
                    break;
                default:
                    problem("The server certificate is not trusted on this tablet.");
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                problem("Cannot reach the laboratory server (" + error.getDescription() + ").");
            }
        }

        private void problem(String message) {
            String page = "<html><body style='font:20px sans-serif;padding:32px;background:#F7F7F1'>"
                    + "<h2>Sensibilia</h2><p>" + message + "</p>"
                    + "<p>Ask laboratory staff. Staff: press and hold the top-left corner for options.</p>"
                    + "</body></html>";
            web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
        }
    }
}
