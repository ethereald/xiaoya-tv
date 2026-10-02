package com.klai.xiaoyatv;

import android.content.Intent;
import android.content.DialogInterface;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

public class DetailActivity extends AppCompatActivity {
    private LinearLayout root;
    private TextView loading;
    private String id;
    private Button lastFocusedButton;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        id = getIntent().getStringExtra("id");
        buildLoading();
        ApiClient.detail(this, id, new ApiClient.Callback<Models.Detail>() {
            @Override public void onSuccess(Models.Detail detail) { render(detail); }
            @Override public void onError(String message) { loading.setText("載入失敗：" + message); }
        });
    }

    @Override protected void onResume() {
        super.onResume();
        restoreFocus();
    }

    private void buildLoading() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(0xFF090D17);
        loading = new TextView(this);
        loading.setText("正在載入…");
        loading.setTextSize(22);
        loading.setTextColor(Color.WHITE);
        root.addView(loading);
        setContentView(root);
    }

    private void render(Models.Detail detail) {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(0xFF090D17);
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(42), dp(30), dp(42), dp(40));
        scroll.addView(page);

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        ImageView poster = new ImageView(this);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        top.addView(poster, new LinearLayout.LayoutParams(dp(270), dp(390)));
        ImageLoader.load(poster, detail.movie.poster);

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        info.setPadding(dp(32), 0, 0, 0);
        TextView title = text(detail.movie.title, 32, Color.WHITE);
        info.addView(title);
        info.addView(text((detail.category + "  " + detail.movie.year).trim(), 18, 0xFFAAB3C5));
        TextView description = text(detail.movie.description, 18, 0xFFD6DBE7);
        description.setPadding(0, dp(18), 0, dp(18));
        info.addView(description);

        Button favorite = actionButton("");
        lastFocusedButton = favorite;
        updateFavoriteButton(favorite, detail.movie);
        favorite.setOnClickListener(view -> {
            CrashReporter.action(this, "toggle_favorite:" + detail.movie.id);
            lastFocusedButton = favorite;
            try {
                LibraryStore.toggleFavorite(this, detail.movie);
                updateFavoriteButton(favorite, detail.movie);
            } catch (Throwable error) {
                favorite.setText("收藏失敗");
            }
        });
        info.addView(favorite, new LinearLayout.LayoutParams(dp(180), dp(54)));
        top.addView(info, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        page.addView(top);

        TextView episodeTitle = text("選集", 24, Color.WHITE);
        episodeTitle.setPadding(0, dp(30), 0, dp(14));
        page.addView(episodeTitle);
        GridLayout episodes = new GridLayout(this);
        episodes.setColumnCount(6);
        for (Models.Episode episode : detail.episodes) {
            Button button = actionButton(episode.label.isEmpty() ? "第 " + (episode.index + 1) + " 集" : episode.label);
            GridLayout.LayoutParams params = new GridLayout.LayoutParams();
            params.width = dp(190);
            params.height = dp(56);
            params.setMargins(0, 0, dp(12), dp(12));
            button.setLayoutParams(params);
            button.setOnClickListener(view -> {
                lastFocusedButton = button;
                play(detail.movie, episode);
            });
            episodes.addView(button);
        }
        page.addView(episodes);
        setContentView(scroll);
        restoreFocus();
    }

    private void play(Models.Movie movie, Models.Episode episode) {
        long position = LibraryStore.resume(this, movie.id, episode.index);
        if (position > 10_000L) {
            String episodeName = episode.label.isEmpty() ? "第 " + (episode.index + 1) + " 集" : episode.label;
            AlertDialog dialog = new AlertDialog.Builder(this)
                    .setTitle(episodeName)
                    .setMessage("上次播放至 " + formatTime(position))
                    .setPositiveButton("繼續播放", (ignoredDialog, which) -> playAt(movie, episode, position))
                    .setNegativeButton("從頭播放", (ignoredDialog, which) -> playAt(movie, episode, 0L))
                    .setNeutralButton("取消", null)
                    .create();
            dialog.setOnShowListener(value -> dialog.getButton(DialogInterface.BUTTON_POSITIVE).requestFocus());
            dialog.show();
        } else {
            playAt(movie, episode, 0L);
        }
    }

    private void playAt(Models.Movie movie, Models.Episode episode, long position) {
        LibraryStore.recordHistory(this, movie);
        Intent intent = new Intent(this, PlayerActivity.class);
        intent.putExtra("id", movie.id);
        intent.putExtra("title", movie.title);
        intent.putExtra("poster", movie.poster);
        intent.putExtra("description", movie.description);
        intent.putExtra("year", movie.year);
        intent.putExtra("episode", episode.index);
        intent.putExtra("episode_label", episode.label);
        intent.putExtra("url", ApiClient.streamUrl(this, movie.id, episode.index));
        intent.putExtra("start_position", Math.max(0L, position));
        startActivity(intent);
    }

    private String formatTime(long milliseconds) {
        long totalSeconds = Math.max(0L, milliseconds / 1_000L);
        long hours = totalSeconds / 3_600L;
        long minutes = (totalSeconds % 3_600L) / 60L;
        long seconds = totalSeconds % 60L;
        return hours > 0
                ? String.format(java.util.Locale.getDefault(), "%d:%02d:%02d", hours, minutes, seconds)
                : String.format(java.util.Locale.getDefault(), "%d:%02d", minutes, seconds);
    }

    private void updateFavoriteButton(Button button, Models.Movie movie) {
        button.setText(LibraryStore.isFavorite(this, movie.id) ? "★ 已收藏" : "☆ 收藏");
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value == null ? "" : value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private Button actionButton(String value) {
        Button button = new Button(this);
        button.setText(value);
        button.setTextColor(Color.WHITE);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setBackground(MovieAdapter.background(0xFF26324B, dp(10)));
        button.setOnFocusChangeListener((view, focused) -> button.setBackground(MovieAdapter.background(focused ? 0xFF5B8CFF : 0xFF26324B, dp(10))));
        return button;
    }

    private void restoreFocus() {
        if (lastFocusedButton != null) lastFocusedButton.post(() -> lastFocusedButton.requestFocus());
    }

    private int dp(int value) { return MovieAdapter.dp(this, value); }
}
