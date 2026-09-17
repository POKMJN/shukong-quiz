package com.quiz.shukong;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * 数控车工考证刷题：单 WebView 承载 assets/www 下的刷题应用。
 *
 * 页面经 WebViewAssetLoader 以 https://appassets.androidplatform.net/ 提供，
 * 而不是 file://，这样 localStorage 才可用（练习记录、错题本依赖它），
 * 同时也无需任何网络权限。
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setBackgroundColor(0xFFF4F6FB);
        web.setVerticalScrollBarEnabled(false);
        web.addJavascriptInterface(new NativeBridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 只允许内置页面在本应用内打开，其他链接一律拦下
                return !request.getUrl().toString().startsWith("https://appassets.androidplatform.net/");
            }
        });

        // 返回键先交给网页处理（关抽屉/弹窗、回上一级菜单），网页不拦截才退出应用
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                web.evaluateJavascript(
                        "(function(){ try { return window.__onBackPressed ? (window.__onBackPressed() === true) : false; } catch(e) { return false; } })()",
                        value -> {
                            if (!"true".equals(value)) {
                                finish();
                            }
                        });
            }
        });

        if (savedInstanceState == null) {
            web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        web.restoreState(savedInstanceState);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    public class NativeBridge {
        @JavascriptInterface
        public void vibrate(String type) {
            try {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if ("error".equals(type)) {
                        long[] timings = {0, 40, 50, 40};
                        int[] amplitudes = {0, 160, 0, 160};
                        v.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                    } else if ("success".equals(type)) {
                        v.vibrate(VibrationEffect.createOneShot(25, 100));
                    } else {
                        v.vibrate(VibrationEffect.createOneShot(15, 60));
                    }
                } else {
                    if ("error".equals(type)) {
                        v.vibrate(new long[]{0, 40, 50, 40}, -1);
                    } else if ("success".equals(type)) {
                        v.vibrate(25);
                    } else {
                        v.vibrate(15);
                    }
                }
            } catch (Exception ignored) {}
        }
    }
}
