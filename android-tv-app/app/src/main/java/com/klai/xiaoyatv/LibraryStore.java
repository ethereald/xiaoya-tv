package com.klai.xiaoyatv;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class LibraryStore {
    private static final String FAVORITE_IDS = "favorite_ids_v2";
    private static final String FAVORITE_ITEM_PREFIX = "favorite_item_v2:";
    private static final String FAVORITE_TIME_PREFIX = "favorite_time_v2:";

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("library", Context.MODE_PRIVATE);
    }

    static boolean isFavorite(Context context, String id) {
        if (id == null || id.isEmpty()) return false;
        migrateLegacyFavorites(context);
        try { return prefs(context).getStringSet(FAVORITE_IDS, java.util.Collections.emptySet()).contains(id); }
        catch (Throwable ignored) { return false; }
    }

    static synchronized boolean toggleFavorite(Context context, Models.Movie movie) {
        if (movie == null || movie.id.isEmpty()) return false;
        migrateLegacyFavorites(context);
        SharedPreferences preferences = prefs(context);
        Set<String> ids;
        try { ids = new HashSet<>(preferences.getStringSet(FAVORITE_IDS, java.util.Collections.emptySet())); }
        catch (Throwable ignored) { ids = new HashSet<>(); }
        boolean saved;
        SharedPreferences.Editor editor = preferences.edit();
        if (ids.remove(movie.id)) {
            saved = false;
            editor.remove(FAVORITE_ITEM_PREFIX + movie.id);
            editor.remove(FAVORITE_TIME_PREFIX + movie.id);
        } else {
            saved = true;
            ids.add(movie.id);
            editor.putString(FAVORITE_ITEM_PREFIX + movie.id, movieJson(movie));
            editor.putLong(FAVORITE_TIME_PREFIX + movie.id, System.currentTimeMillis());
        }
        editor.putStringSet(FAVORITE_IDS, ids);
        if (!editor.commit()) throw new IllegalStateException("Unable to save favourites");
        return saved;
    }

    static List<Models.Movie> favorites(Context context) {
        migrateLegacyFavorites(context);
        SharedPreferences preferences = prefs(context);
        List<Models.Movie> output = new ArrayList<>();
        Set<String> ids;
        try { ids = new HashSet<>(preferences.getStringSet(FAVORITE_IDS, java.util.Collections.emptySet())); }
        catch (Throwable ignored) { return output; }
        for (String id : ids) {
            try {
                JSONObject item = new JSONObject(preferences.getString(FAVORITE_ITEM_PREFIX + id, "{}"));
                if (!item.optString("id").isEmpty()) output.add(movieFromJson(item));
            } catch (Throwable ignored) {}
        }
        output.sort(Comparator.comparingLong(
                movie -> -preferences.getLong(FAVORITE_TIME_PREFIX + movie.id, 0L)));
        return output;
    }

    static void clearFavorites(Context context) {
        SharedPreferences preferences = prefs(context);
        SharedPreferences.Editor editor = preferences.edit().remove(FAVORITE_IDS).remove("favorites");
        for (String key : preferences.getAll().keySet()) {
            if (key.startsWith(FAVORITE_ITEM_PREFIX) || key.startsWith(FAVORITE_TIME_PREFIX)) editor.remove(key);
        }
        editor.commit();
    }

    static List<Models.Movie> history(Context context) { return readMovies(context, "history"); }

    static void recordHistory(Context context, Models.Movie movie) {
        if (movie == null || movie.id.isEmpty()) return;
        List<Models.Movie> values = history(context);
        removeMovie(values, movie.id);
        values.add(0, movie);
        if (values.size() > 80) values = new ArrayList<>(values.subList(0, 80));
        writeMovies(context, "history", values);
    }

    static long resume(Context context, String id, int episode) {
        String key = resumeKey(id, episode);
        try {
            return Math.max(0L, prefs(context).getLong(key, 0L));
        } catch (ClassCastException incompatibleValue) {
            Object value = prefs(context).getAll().get(key);
            try { return Math.max(0L, Long.parseLong(String.valueOf(value))); }
            catch (Exception ignored) {
                prefs(context).edit().remove(key).apply();
                return 0L;
            }
        }
    }

    static void saveResume(Context context, String id, int episode, long position) {
        if (id == null || id.isEmpty()) return;
        prefs(context).edit().putLong(resumeKey(id, episode), Math.max(0L, position)).apply();
    }

    static void removeHistory(Context context, String id) {
        List<Models.Movie> values = history(context);
        removeMovie(values, id);
        writeMovies(context, "history", values);
        removeResumeEntries(context, id);
    }

    static void clearHistory(Context context) {
        prefs(context).edit().remove("history").apply();
        removeResumeEntries(context, null);
    }

    private static void removeResumeEntries(Context context, String id) {
        String prefix = id == null ? "resume:" : "resume:" + id + ":";
        SharedPreferences preferences = prefs(context);
        SharedPreferences.Editor editor = preferences.edit();
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            if (entry.getKey().startsWith(prefix)) editor.remove(entry.getKey());
        }
        editor.apply();
    }

    private static List<Models.Movie> readMovies(Context context, String key) {
        List<Models.Movie> output = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(prefs(context).getString(key, "[]"));
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null && !item.optString("id").isEmpty()) output.add(new Models.Movie(
                        item.optString("id"), item.optString("title"), item.optString("poster"),
                        item.optString("description"), item.optString("year")));
            }
        } catch (Exception ignored) {}
        return output;
    }

    private static void writeMovies(Context context, String key, List<Models.Movie> values) {
        JSONArray array = new JSONArray();
        try {
            for (Models.Movie movie : values) {
                if (movie == null || movie.id.isEmpty()) continue;
                JSONObject item = new JSONObject();
                item.put("id", movie.id);
                item.put("title", movie.title);
                item.put("poster", movie.poster);
                item.put("description", movie.description);
                item.put("year", movie.year);
                array.put(item);
            }
        } catch (Exception ignored) {}
        prefs(context).edit().putString(key, array.toString()).apply();
    }

    private static String movieJson(Models.Movie movie) {
        try {
            JSONObject item = new JSONObject();
            item.put("id", movie.id);
            item.put("title", movie.title);
            item.put("poster", movie.poster);
            item.put("description", movie.description);
            item.put("year", movie.year);
            return item.toString();
        } catch (Exception ignored) {
            return "{}";
        }
    }

    private static Models.Movie movieFromJson(JSONObject item) {
        return new Models.Movie(item.optString("id"), item.optString("title"), item.optString("poster"),
                item.optString("description"), item.optString("year"));
    }

    private static synchronized void migrateLegacyFavorites(Context context) {
        SharedPreferences preferences = prefs(context);
        if (preferences.contains(FAVORITE_IDS) || !preferences.contains("favorites")) return;
        SharedPreferences.Editor editor = preferences.edit().remove("favorites");
        Set<String> ids = new HashSet<>();
        try {
            long time = System.currentTimeMillis();
            for (Models.Movie movie : readMovies(context, "favorites")) {
                if (movie == null || movie.id.isEmpty()) continue;
                ids.add(movie.id);
                editor.putString(FAVORITE_ITEM_PREFIX + movie.id, movieJson(movie));
                editor.putLong(FAVORITE_TIME_PREFIX + movie.id, time--);
            }
        } catch (Throwable ignored) {
            ids.clear();
        }
        editor.putStringSet(FAVORITE_IDS, ids).commit();
    }

    private static String resumeKey(String id, int episode) {
        return "resume:" + (id == null ? "" : id) + ":" + episode;
    }

    private static boolean removeMovie(List<Models.Movie> values, String id) {
        if (id == null) return false;
        for (int index = values.size() - 1; index >= 0; index--) {
            Models.Movie value = values.get(index);
            if (value != null && id.equals(value.id)) {
                values.remove(index);
                return true;
            }
        }
        return false;
    }

    private LibraryStore() {}
}
