package com.klai.xiaoyatv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ApiClient {
    interface Callback<T> { void onSuccess(T value); void onError(String message); }

    static final String DEFAULT_BASE_URL = "http://10.0.0.105:8787";
    private static final ExecutorService EXECUTOR = Executors.newFixedThreadPool(4);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    static String baseUrl(Context context) {
        return context.getSharedPreferences("settings", Context.MODE_PRIVATE)
                .getString("base_url", DEFAULT_BASE_URL).replaceAll("/+$", "");
    }

    static boolean hasConfiguredBaseUrl(Context context) {
        return context.getSharedPreferences("settings", Context.MODE_PRIVATE).contains("base_url");
    }

    static void setBaseUrl(Context context, String value) {
        String normalized = value.trim().replaceAll("/+$", "");
        if (normalized.isEmpty()) normalized = DEFAULT_BASE_URL;
        if (!normalized.matches("(?i)^https?://.*")) normalized = "http://" + normalized;
        context.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().putString("base_url", normalized).apply();
    }

    static String streamUrl(Context context, String id, int episode) {
        return baseUrl(context) + "/api/relay/" + encode(id) + "/" + episode + "/stream.m3u8?source=0";
    }

    static void categories(Context context, Callback<List<Models.Category>> callback) {
        get(context, "/api/categories", json -> {
            List<Models.Category> output = new ArrayList<>();
            JSONArray values = json.optJSONArray("categories");
            if (values != null) for (int i = 0; i < values.length(); i++) {
                JSONObject item = values.optJSONObject(i);
                if (item != null) output.add(new Models.Category(
                        item.optString("id"), traditionalCategoryName(item.optString("name"))));
            }
            return output;
        }, callback);
    }

    static void catalog(Context context, String category, int page, Callback<List<Models.Movie>> callback) {
        get(context, "/api/catalog?category=" + encode(category) + "&page=" + page, json -> {
            List<Models.Movie> output = new ArrayList<>();
            JSONArray values = json.optJSONArray("items");
            if (values != null) for (int i = 0; i < values.length(); i++) {
                JSONObject item = values.optJSONObject(i);
                if (item != null) output.add(movie(item));
            }
            return output;
        }, callback);
    }

    static void search(Context context, String query, Callback<List<Models.Movie>> callback) {
        get(context, "/api/search?q=" + encode(query), json -> {
            List<Models.Movie> output = new ArrayList<>();
            JSONArray values = json.optJSONArray("results");
            if (values != null) for (int i = 0; i < values.length(); i++) {
                JSONObject item = values.optJSONObject(i);
                if (item != null) output.add(new Models.Movie(
                        item.optString("id"), item.optString("title"), item.optString("poster"),
                        item.optString("desc"), item.optString("year")));
            }
            return output;
        }, callback);
    }

    static void detail(Context context, String id, Callback<Models.Detail> callback) {
        get(context, "/api/media/" + encode(id), json -> {
            JSONObject value = json.getJSONObject("detail");
            Models.Movie movie = new Models.Movie(value.optString("id"), value.optString("title"),
                    value.optString("poster"), value.optString("description"), value.optString("year"));
            List<Models.Episode> episodes = new ArrayList<>();
            JSONArray list = value.optJSONArray("episodes");
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject episode = list.optJSONObject(i);
                if (episode != null) episodes.add(new Models.Episode(episode.optInt("index"), episode.optString("label")));
            }
            return new Models.Detail(movie, value.optString("category"), episodes);
        }, callback);
    }

    private interface Parser<T> { T parse(JSONObject json) throws Exception; }

    private static <T> void get(Context context, String path, Parser<T> parser, Callback<T> callback) {
        String endpoint = baseUrl(context) + path;
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Accept", "application/json");
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                StringBuilder body = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) body.append(line);
                }
                if (status < 200 || status >= 300) throw new Exception("HTTP " + status + ": " + body);
                T value = parser.parse(new JSONObject(body.toString()));
                MAIN.post(() -> callback.onSuccess(value));
            } catch (Exception error) {
                MAIN.post(() -> callback.onError(error.getMessage() == null ? error.toString() : error.getMessage()));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static Models.Movie movie(JSONObject item) {
        return new Models.Movie(item.optString("id"), item.optString("title"), item.optString("poster"),
                item.optString("description"), item.optString("year"));
    }

    private static String encode(String value) {
        try { return URLEncoder.encode(value, "UTF-8").replace("+", "%20"); }
        catch (Exception ignored) { return value; }
    }

    private static String traditionalCategoryName(String value) {
        if (value == null || value.isEmpty()) return "";
        StringBuilder output = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '鸭': output.append('鴨'); break;
                case '视': output.append('視'); break;
                case '电': output.append('電'); break;
                case '连': output.append('連'); break;
                case '续': output.append('續'); break;
                case '剧': output.append('劇'); break;
                case '综': output.append('綜'); break;
                case '艺': output.append('藝'); break;
                case '动': output.append('動'); break;
                case '爱': output.append('愛'); break;
                case '战': output.append('戰'); break;
                case '争': output.append('爭'); break;
                case '纪': output.append('紀'); break;
                case '录': output.append('錄'); break;
                case '画': output.append('畫'); break;
                case '悬': output.append('懸'); break;
                case '欧': output.append('歐'); break;
                case '湾': output.append('灣'); break;
                case '台': output.append('臺'); break;
                case '韩': output.append('韓'); break;
                case '国': output.append('國'); break;
                case '亚': output.append('亞'); break;
                case '内': output.append('內'); break;
                case '东': output.append('東'); break;
                case '陆': output.append('陸'); break;
                case '历': output.append('歷'); break;
                case '产': output.append('產'); break;
                case '装': output.append('裝'); break;
                default: output.append(character);
            }
        }
        return output.toString();
    }

    private ApiClient() {}
}
