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
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Full-screen assessor. The page is the PWA served by the laboratory server; this shell only adds
 * the saved server address, kiosk (lock task) mode and a press-and-hold staff corner.
 */
public class MainActivity extends Activity {
    private static final long HOLD_MS = 900;

    private ServerPrefs prefs;
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean kioskStarted;

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = new ServerPrefs(this);
        String origin = prefs.origin();
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
        String[] items = {"Reload", "Change server", "Leave kiosk mode", "Certificate", "Close"};
        new AlertDialog.Builder(this)
                .setTitle("Staff")
                .setItems(items, (dialog, which) -> {
                    if (which == 0) {
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
