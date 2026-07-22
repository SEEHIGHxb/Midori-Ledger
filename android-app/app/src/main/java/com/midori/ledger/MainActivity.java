package com.midori.ledger;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {

    // The app loads the deployed web app instead of bundled file:// assets.
    // Two reasons this matters:
    //   1. Google sign-in cannot redirect back to a file:// page, and localStorage
    //      under file:// is a separate, opaque origin. A real https origin is a
    //      prerequisite for cloud auth working at all.
    //   2. Users get the latest deployed Midori without shipping a new APK.
    //
    // Offline still works: the page registers a service worker on first online
    // load, and the WebView's Chromium engine serves the cached copy afterwards.
    // The one gap this trades in is a truly-cold first launch with no network —
    // handled below with a retry page rather than a raw Chromium error.
    private static final String APP_URL = "https://seehighxb.github.io/Midori-Ledger/";

    private WebView mWebView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mWebView = new WebView(this);
        WebSettings webSettings = mWebView.getSettings();

        webSettings.setJavaScriptEnabled(true);
        // Persists the ledger: localStorage and IndexedDB are keyed to APP_URL's
        // origin, so this store survives app restarts and app updates.
        webSettings.setDomStorageEnabled(true);

        // No file:// content is loaded anymore, so file access stays off. It is
        // already off by default on modern WebView; setting it explicitly
        // documents the intent and narrows the attack surface of a WebView that
        // now loads remote content.
        webSettings.setAllowFileAccess(false);
        webSettings.setAllowContentAccess(false);

        webSettings.setUseWideViewPort(true);
        webSettings.setLoadWithOverviewMode(true);

        mWebView.setWebViewClient(new WebViewClient() {
            // A finance ledger that shows a raw Chromium error page on a dropped
            // connection reads as data loss. Replace the main-frame failure with
            // a plain retry page; subresource errors are left to the page itself.
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) {
                    return;
                }
                String html = "<!doctype html>"
                    + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                    + "<div style=\"font-family:sans-serif;max-width:340px;margin:15vh auto;padding:0 24px;"
                    + "text-align:center;color:#1e381b\">"
                    + "<h2 style=\"margin-bottom:8px\">Can't reach Midori</h2>"
                    + "<p style=\"opacity:.75;line-height:1.5\">Connect to the internet, then tap Retry. "
                    + "Your ledger stays saved on this device.</p>"
                    + "<a href=\"" + APP_URL + "\" style=\"display:inline-block;margin-top:16px;padding:12px 24px;"
                    + "background:#4a7c59;color:#fff;border-radius:12px;text-decoration:none;font-weight:600\">Retry</a>"
                    + "</div>";
                // Base URL is APP_URL so the Retry link resolves against the real
                // origin and re-navigates the WebView back to the app.
                view.loadDataWithBaseURL(APP_URL, html, "text/html", "utf-8", APP_URL);
            }
        });

        mWebView.loadUrl(APP_URL);

        setContentView(mWebView);
    }

    @Override
    public void onBackPressed() {
        if (mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
