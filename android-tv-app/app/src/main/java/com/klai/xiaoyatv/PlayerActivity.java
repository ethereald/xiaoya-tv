package com.klai.xiaoyatv;

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends AppCompatActivity {
    private ExoPlayer player;
    private PlayerView playerView;
    private String id;
    private int episode;
    private long requestedStartPosition;
    private boolean startPositionApplied;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        id = getIntent().getStringExtra("id");
        episode = getIntent().getIntExtra("episode", 0);
        requestedStartPosition = Math.max(0L, getIntent().getLongExtra("start_position", 0L));
        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setControllerShowTimeoutMs(5000);
        setContentView(playerView);
        initializePlayer();
    }

    private void initializePlayer() {
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY && !startPositionApplied) {
                    startPositionApplied = true;
                    long duration = player.getDuration();
                    long position = requestedStartPosition;
                    if (duration > 0) position = Math.min(position, Math.max(0L, duration - 1_000L));
                    if (position > 0) player.seekTo(position);
                }
            }
            @Override public void onPlayerError(PlaybackException error) {
                Log.e("XiaoyaPlayer", "播放失敗：" + error.getErrorCodeName(), error);
            }
        });
        MediaItem media = new MediaItem.Builder()
                .setUri(getIntent().getStringExtra("url"))
                .setMediaId(id + ":" + episode)
                .build();
        player.setMediaItem(media);
        player.prepare();
        player.play();
    }

    @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (player != null && (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND)) {
            seekBy(-15_000);
            return true;
        }
        if (player != null && (keyCode == KeyEvent.KEYCODE_DPAD_RIGHT || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD)) {
            seekBy(15_000);
            return true;
        }
        if (player != null && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)) {
            if (player.isPlaying()) player.pause(); else player.play();
            playerView.showController();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void seekBy(long amount) {
        long duration = player.getDuration();
        long target = Math.max(0, player.getCurrentPosition() + amount);
        if (duration > 0) target = Math.min(duration - 1, target);
        player.seekTo(target);
        playerView.showController();
    }

    private void saveState() {
        if (player == null || id == null) return;
        try {
            long position = Math.max(0L, player.getCurrentPosition());
            long duration = player.getDuration();
            LibraryStore.saveResume(this, id, episode,
                    duration > 0 && position > duration - 30_000 ? 0 : position);
            LibraryStore.recordHistory(this, new Models.Movie(
                    id,
                    getIntent().getStringExtra("title"),
                    getIntent().getStringExtra("poster"),
                    getIntent().getStringExtra("description"),
                    getIntent().getStringExtra("year")));
        } catch (RuntimeException error) {
            Log.e("XiaoyaPlayer", "無法儲存播放進度", error);
        }
    }

    @Override protected void onStop() { saveState(); super.onStop(); }
    @Override protected void onDestroy() {
        if (player != null) { player.release(); player = null; }
        super.onDestroy();
    }
}
