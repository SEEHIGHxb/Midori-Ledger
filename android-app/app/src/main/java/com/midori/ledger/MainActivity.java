package com.midori.ledger;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.browser.customtabs.CustomTabsIntent;
import org.json.JSONObject;

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
    private static final String APP_URL = "https://seehighxb.github.io/Midori-Ledger/";

    // Google refuses to complete OAuth inside a WebView, so the Supabase
    // authorize step is diverted into a Custom Tab (real Chrome). This prefix
    // mirrors SUPABASE_URL in js/supabase-config.js; it is the only URL the app
    // hands to an external browser.
    private static final String SUPABASE_AUTHORIZE_PREFIX =
        "https://hzgmjfgezlduxezbwpkm.supabase.co/auth/v1/authorize";

    // The scheme the auth bridge page (auth-callback.html) deep-links back to
    // after the Custom Tab finishes. Registered in AndroidManifest.
    private static final String AUTH_SCHEME = "com.midori.ledger";

    // The web app checks for this marker to know it is running in the wrapper,
    // and so must send auth to the deep-link bridge rather than to the page.
    private static final String UA_MARKER = "MidoriAndroid/1.1";

    private WebView mWebView;

    // The deep link can arrive before the WebView has finished loading (e.g. a
    // cold start via the link). Hold the fragment and flush it once the page is
    // ready to receive it.
    private String mPendingAuthFragment = null;
    private boolean mPageReady = false;

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

        // Append (never replace) the marker so the page still renders as a normal
        // mobile browser. This is read by isAndroidWrapper() in the web app.
        webSettings.setUserAgentString(webSettings.getUserAgentString() + " " + UA_MARKER);

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Divert only the Supabase authorize step to a Custom Tab; every
                // other navigation stays in the WebView.
                if (url.startsWith(SUPABASE_AUTHORIZE_PREFIX)) {
                    CustomTabsIntent tab = new CustomTabsIntent.Builder().build();
                    tab.launchUrl(MainActivity.this, request.getUrl());
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                mPageReady = true;
                if (mPendingAuthFragment != null) {
                    deliverAuthFragment(mPendingAuthFragment);
                    mPendingAuthFragment = null;
                }
            }

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
                view.loadDataWithBaseURL(APP_URL, html, "text/html", "utf-8", APP_URL);
            }
        });

        mWebView.loadUrl(APP_URL);
        setContentView(mWebView);

        // If the activity was launched (cold) by the auth deep link, handle it.
        handleAuthDeepLink(getIntent());
    }

    // singleTask (set in the manifest) routes the deep link to the existing
    // instance holding the ledger's WebView, rather than creating a new one.
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthDeepLink(intent);
    }

    private void handleAuthDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) {
            return;
        }
        Uri data = intent.getData();
        if (!AUTH_SCHEME.equals(data.getScheme())) {
            return;
        }
        // On success the tokens are in the fragment. A cancelled/failed sign-in
        // can put error params in the query instead; the web side parses either.
        String payload = data.getEncodedFragment();
        if (TextUtils.isEmpty(payload)) {
            payload = data.getEncodedQuery();
        }
        if (TextUtils.isEmpty(payload)) {
            return;
        }
        if (mPageReady) {
            deliverAuthFragment(payload);
        } else {
            mPendingAuthFragment = payload;
        }
    }

    private void deliverAuthFragment(String fragment) {
        // JSONObject.quote wraps the value in quotes and escapes anything that
        // would break out of the JS string literal — defensive even though
        // OAuth fragments are URL-safe.
        String js = "window.__midoriHandleAuthFragment && window.__midoriHandleAuthFragment("
            + JSONObject.quote(fragment) + ");";
        mWebView.evaluateJavascript(js, null);
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
