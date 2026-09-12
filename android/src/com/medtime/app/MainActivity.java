package com.medtime.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import org.json.JSONObject;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;

/** An offline medication log with user-configured native alarms. */
public final class MainActivity extends Activity {
    private static final String LOCAL_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + LOCAL_HOST + "/assets/www/index.html";
    private static final int OPEN_BACKUP = 41;
    private static final int SAVE_BACKUP = 42;
    private static final int ALARM_NOTIFICATIONS = 43;
    private static final int MAX_BACKUP_BYTES = 32 * 1024 * 1024;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private boolean restoredFilePicker;
    private String pendingExportKind;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        restoredFilePicker = state != null && state.getBoolean("medtime-file-picker", false);
        if (state != null && state.getBoolean("medtime-export", false)) {
            File cache = pendingExportFile();
            if (cache.isFile() && cache.length() <= MAX_BACKUP_BYTES) {
                try { pendingExport = Files.readAllBytes(cache.toPath()); pendingExportKind = state.getString("medtime-export-kind"); }
                catch (IOException ignored) { clearPendingExport(); }
            } else { clearPendingExport(); }
        } else { clearPendingExport(); }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(246, 247, 249));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(246, 247, 249));
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only document URIs explicitly chosen in the system picker.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        // Root rem sizes follow getTextScale(); do not apply WebView text zoom twice.
        if (Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        WebView.setWebContentsDebuggingEnabled(false);
        webView.addJavascriptInterface(new LocalFileBridge(), "MedtimeAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isLocal(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return localResponse(request.getUrl());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                    FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(picker, OPEN_BACKUP); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        webView.loadUrl(START_URL);
    }

    private boolean isLocal(Uri uri) {
        String path = uri.getPath();
        return "https".equals(uri.getScheme()) && LOCAL_HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && path != null && path.startsWith("/assets/www/") && !path.contains("..");
    }

    private WebResourceResponse localResponse(Uri uri) {
        if (!isLocal(uri)) return emptyResponse(403, "Forbidden");
        String path = uri.getPath().substring("/assets/".length());
        if (path.endsWith("/")) path += "index.html";
        try {
            InputStream file = getAssets().open(path);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'");
            return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK", headers, file);
        } catch (IOException error) {
            return emptyResponse(404, "Not Found");
        }
    }

    private WebResourceResponse emptyResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json") || path.endsWith(".webmanifest")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    public final class LocalFileBridge {
        @JavascriptInterface public String syncAlarms(String text) { return AlarmScheduler.sync(MainActivity.this,text).toString(); }
        @JavascriptInterface public String getAlarmStatus() { return AlarmScheduler.status(MainActivity.this).toString(); }
        @JavascriptInterface public void suspendAlarms() { AlarmScheduler.suspend(MainActivity.this,"请先修复或重新保存闹钟设置"); }
        @JavascriptInterface public void stopAlarm() { AlarmScheduler.stop(MainActivity.this); runOnUiThread(MainActivity.this::reportAlarmStatus); }
        @JavascriptInterface public String testAlarm() { return AlarmScheduler.test(MainActivity.this).toString(); }
        @JavascriptInterface public String scheduleAlarmTest() { return AlarmScheduler.scheduleTest(MainActivity.this).toString(); }
        @JavascriptInterface public void cancelAlarmTest() { AlarmScheduler.cancelTest(MainActivity.this); runOnUiThread(MainActivity.this::reportAlarmStatus); }
        @JavascriptInterface public String confirmAlarmTest(boolean heard) { return AlarmScheduler.confirmTest(MainActivity.this,heard).toString(); }

        @JavascriptInterface public void requestAlarmAccess(String kind) { runOnUiThread(() -> requestAlarmAccessOnUi(kind)); }
        @JavascriptInterface public float getTextScale() { return getResources().getConfiguration().fontScale; }
        @JavascriptInterface public String getBackupStatus() {
            android.content.SharedPreferences state=getSharedPreferences("medtime_backup",MODE_PRIVATE);
            JSONObject status=new JSONObject();
            try { status.put("savedAt",state.getLong("savedAt",0)); status.put("kind",state.getString("kind","")); } catch (Exception ignored) {}
            return status.toString();
        }
        @JavascriptInterface public void openExternal(String destination) {
            final String url="feedback".equals(destination)?"https://github.com/1841175465li-byte/medtime/issues/new":
                "updates".equals(destination)?"https://github.com/1841175465li-byte/medtime":
                "sponsor".equals(destination)?"https://afdian.com/a/666ccb":null;
            if (url==null) return;
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url))); }
                catch (ActivityNotFoundException error) { Toast.makeText(MainActivity.this,"没有可用的浏览器",Toast.LENGTH_SHORT).show(); }
            });
        }
        @JavascriptInterface public void exportBackup(String text, String filename, String kind) {
            if (!"plain".equals(kind) && !"encrypted".equals(kind)) return;
            saveDocument(text,filename,"application/json",kind);
        }
        @JavascriptInterface public void saveFile(String text, String filename, String mime) {
            saveDocument(text,filename,mime,null);
        }
        private void saveDocument(String text, String filename, String mime, String kind) {
            if (text == null || text.length() > MAX_BACKUP_BYTES) {
                runOnUiThread(() -> reportExport(false, false));
                return;
            }
            final byte[] contents = text.getBytes(StandardCharsets.UTF_8);
            if (contents.length > MAX_BACKUP_BYTES) {
                runOnUiThread(() -> reportExport(false, false));
                return;
            }
            String safeName = filename == null ? "medtime-backup.json" : filename.replaceAll("[\\\\/\\p{Cntrl}]", "_");
            if (safeName.length() > 100) safeName = safeName.substring(0, 100);
            final String suggestedName = safeName;
            final String contentType = "text/csv".equals(mime) ? "text/csv" : "application/json";
            runOnUiThread(() -> {
                if (pendingExport != null) { reportExport(false, false); return; }
                try (OutputStream cache = new FileOutputStream(pendingExportFile())) {
                    cache.write(contents);
                    pendingExport = contents;
                    pendingExportKind = kind;
                } catch (IOException error) {
                    clearPendingExport();
                    reportExport(false, false);
                    return;
                }
                Intent destination = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                destination.addCategory(Intent.CATEGORY_OPENABLE);
                destination.setType(contentType);
                destination.putExtra(Intent.EXTRA_TITLE, suggestedName);
                try { startActivityForResult(destination, SAVE_BACKUP); }
                catch (ActivityNotFoundException error) {
                    clearPendingExport();
                    reportExport(false, false);
                }
            });
        }
    }

    private void requestAlarmAccessOnUi(String kind) {
        try {
            if ("exact".equals(kind)) {
                if (Build.VERSION.SDK_INT >= 31 && !AlarmScheduler.exactAllowed(this)) {
                    startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));
                }
            } else if ("sound".equals(kind)) {
                startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS));
            } else if ("app".equals(kind)) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));
            } else if ("notifications".equals(kind)) {
                boolean asked=AlarmScheduler.prefs(this).getBoolean("askedNotifications",false);
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        && (!asked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
                    AlarmScheduler.prefs(this).edit().putBoolean("askedNotifications",true).apply();
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},ALARM_NOTIFICATIONS);
                } else {
                    boolean appAllowed=getSystemService(android.app.NotificationManager.class).areNotificationsEnabled();
                    Intent settingsIntent=new Intent(appAllowed ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName());
                    if (appAllowed) settingsIntent.putExtra(Settings.EXTRA_CHANNEL_ID,AlarmScheduler.CHANNEL);
                    startActivity(settingsIntent);
                }
            }
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this,"请在系统设置中打开药记的通知与闹钟权限",Toast.LENGTH_LONG).show();
        }
        reportAlarmStatus();
    }
    private void reportAlarmStatus() {
        if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('medtime-alarm-status',{detail:"
            +AlarmScheduler.status(this).toString()+"}))",null);
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grantResults) {
        super.onRequestPermissionsResult(request,permissions,grantResults);
        if (request==ALARM_NOTIFICATIONS) { AlarmScheduler.reschedule(this); reportAlarmStatus(); }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (AlarmScheduler.OPEN.equals(intent.getAction()) && webView != null)
            webView.evaluateJavascript("window.MedtimeOpenAlarm && window.MedtimeOpenAlarm()",null);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == OPEN_BACKUP && fileCallback != null) {
            Uri chosen = result == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(chosen == null ? null : new Uri[]{chosen});
            fileCallback = null;
        } else if (request == OPEN_BACKUP && restoredFilePicker && result == RESULT_OK) {
            Toast.makeText(this, "页面已重新打开，请再次选择备份文件", Toast.LENGTH_LONG).show();
        }
        if (request == OPEN_BACKUP) restoredFilePicker = false;
        if (request == SAVE_BACKUP) {
            if (result != RESULT_OK || data == null || data.getData() == null) {
                clearPendingExport();
                reportExport(false, true);
                return;
            }
            if (pendingExport == null) { clearPendingExport(); reportExport(false, false); return; }
            try (OutputStream stream = getContentResolver().openOutputStream(data.getData(), "wt")) {
                if (stream == null) throw new IOException("No output stream");
                stream.write(pendingExport);
                stream.flush();
            } catch (Exception error) { clearPendingExport(); reportExport(false, false); return; }
            long savedAt=System.currentTimeMillis();
            String savedKind=pendingExportKind;
            if (savedKind!=null) getSharedPreferences("medtime_backup",MODE_PRIVATE).edit().putLong("savedAt",savedAt).putString("kind",savedKind).commit();
            reportExport(true, false, savedKind, savedAt);
            clearPendingExport();
        }
    }

    private File pendingExportFile() { return new File(getCacheDir(), "medtime-pending-export.json"); }

    private void clearPendingExport() {
        pendingExport = null;
        pendingExportKind = null;
        File temporary = pendingExportFile();
        if (temporary.isFile()) temporary.delete();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("medtime-export", pendingExport != null);
        state.putString("medtime-export-kind",pendingExportKind);
        state.putBoolean("medtime-file-picker", fileCallback != null || restoredFilePicker);
        super.onSaveInstanceState(state);
    }

    private void reportExport(boolean ok, boolean cancelled) { reportExport(ok,cancelled,null,0); }
    private void reportExport(boolean ok, boolean cancelled, String kind, long savedAt) {
        if (webView == null) return;
        JSONObject detail=new JSONObject();
        try { detail.put("ok",ok); detail.put("cancelled",cancelled); detail.put("kind",kind==null?JSONObject.NULL:kind); detail.put("savedAt",savedAt); } catch (Exception ignored) {}
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('medtime-export-result',{detail:"+detail.toString()+"}))", null);
        if (ok) Toast.makeText(this, "备份已保存", Toast.LENGTH_SHORT).show();
        else if (!cancelled) Toast.makeText(this, "保存失败，请重新导出", Toast.LENGTH_SHORT).show();
    }
    private void reportTextScale() {
        if (webView!=null) webView.evaluateJavascript("window.dispatchEvent(new Event('medtime-text-scale'))",null);
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config); reportTextScale();
    }

    private void handleBack() {
        if (webView == null) { finish(); return; }
        webView.evaluateJavascript("Boolean(window.MedtimeNativeBack && window.MedtimeNativeBack())", consumed -> {
            if (!"true".equals(consumed)) finish();
        });
    }

    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() { if (webView != null) webView.onPause(); super.onPause(); }
    @Override protected void onResume() {
        super.onResume();
        AlarmScheduler.reschedule(this);
        if (webView != null) { webView.onResume(); reportAlarmStatus(); reportTextScale(); }
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (webView != null) {
            webView.removeJavascriptInterface("MedtimeAndroid");
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
