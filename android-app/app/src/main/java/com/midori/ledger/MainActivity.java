package com.midori.ledger;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private WebView mWebView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mWebView = new WebView(this);
        WebSettings webSettings = mWebView.getSettings();
        
        // Core settings for clean responsive web app operation
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true); // VERY IMPORTANT: Persists the LocalStorage ledger data!
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        
        // Zoom and scale settings
        webSettings.setUseWideViewPort(true);
        webSettings.setLoadWithOverviewMode(true);
        
        mWebView.setWebViewClient(new WebViewClient());
        
        // Load the offline asset
        mWebView.loadUrl("file:///android_asset/index.html");
        
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
