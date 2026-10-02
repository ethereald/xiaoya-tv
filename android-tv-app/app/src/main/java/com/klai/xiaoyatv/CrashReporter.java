package com.klai.xiaoyatv;

import android.content.Context;
import android.os.Build;
import android.os.Process;

import org.json.JSONObject;

import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CrashReporter {
    private static boolean installed;

    static synchronized void install(Context context) {
        if (installed) return;
        installed = true;
        Context appContext = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                StringWriter trace = new StringWriter();
                error.printStackTrace(new PrintWriter(trace));
                JSONObject report = new JSONObject();
                report.put("version", "0.6.0");
                report.put("versionCode", 6);
                report.put("manufacturer", Build.MANUFACTURER);
                report.put("model", Build.MODEL);
                report.put("androidSdk", Build.VERSION.SDK_INT);
                report.put("thread", thread.getName());
                report.put("lastAction", appContext.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
                        .getString("last_action", "unknown"));
                report.put("exception", error.toString());
                report.put("stack", trace.toString());
                appContext.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
                        .edit().putString("last_crash", report.toString()).commit();
                Thread sender = new Thread(() -> send(appContext, report), "crash-reporter");
                sender.start();
                sender.join(2_500L);
            } catch (Throwable ignored) {}
            if (previous != null) previous.uncaughtException(thread, error);
            else {
                Process.killProcess(Process.myPid());
                System.exit(10);
            }
        });
    }

    static void action(Context context, String value) {
        try {
            context.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
                    .edit().putString("last_action", value).apply();
        } catch (Throwable ignored) {}
    }

    private static void send(Context context, JSONObject report) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(
                    ApiClient.baseUrl(context) + "/api/debug/crash").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(1_500);
            connection.setReadTimeout(1_500);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] body = report.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            connection.getResponseCode();
        } catch (Throwable ignored) {
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private CrashReporter() {}
}
