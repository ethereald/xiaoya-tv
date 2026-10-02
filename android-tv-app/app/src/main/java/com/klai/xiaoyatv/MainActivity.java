package com.klai.xiaoyatv;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private MovieAdapter movieAdapter;
    private CategoryAdapter categoryAdapter;
    private CategoryAdapter categoryGroupAdapter;
    private RecyclerView categoryGroups;
    private RecyclerView movieGrid;
    private TextView heading;
    private TextView status;
    private EditText search;
    private Button previousPage;
    private Button nextPage;
    private Button removeHistory;
    private Button clearHistory;
    private final List<Models.Category> allCategories = new ArrayList<>();
    private String selectedCategory = "";
    private String localView = "";
    private boolean historyDeleteMode;
    private boolean categoriesStarted;
    private int page = 1;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        CrashReporter.install(this);
        getWindow().setStatusBarColor(0xFF090D17);
        buildUi();
        if (ApiClient.hasConfiguredBaseUrl(this)) startCategories();
        else showStartupHostPrompt();
    }

    @Override protected void onResume() {
        super.onResume();
        if ("收藏".equals(localView)) showFavorites();
        if ("播放記錄".equals(localView)) showLocal("播放記錄", LibraryStore.history(this));
    }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(18), dp(24), dp(12));
        root.setBackgroundColor(0xFF090D17);
        root.setFocusableInTouchMode(true);
        root.requestFocus();

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView logo = new TextView(this);
        logo.setText("小鴨影視");
        logo.setTextSize(28);
        logo.setTextColor(Color.WHITE);
        logo.setPadding(0, 0, dp(25), 0);
        top.addView(logo, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(56)));

        search = new EditText(this);
        search.setSingleLine(true);
        search.setHint("搜尋片名");
        search.setTextColor(Color.WHITE);
        search.setHintTextColor(0xFF8993A7);
        search.setBackground(MovieAdapter.background(0xFF151B2B, dp(10)));
        search.setPadding(dp(18), 0, dp(18), 0);
        search.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        search.setOnEditorActionListener((view, action, event) -> {
            if (action == EditorInfo.IME_ACTION_SEARCH) { performSearch(); return true; }
            return false;
        });
        top.addView(search, new LinearLayout.LayoutParams(0, dp(48), 1f));
        top.addView(button("搜尋", view -> performSearch()));
        top.addView(button("收藏", view -> showFavorites()));
        top.addView(button("記錄", view -> showLocal("播放記錄", LibraryStore.history(this))));
        top.addView(button("設定", view -> showSettings()));
        root.addView(top, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)));

        categoryGroups = new RecyclerView(this);
        categoryGroups.setLayoutManager(new LinearLayoutManager(this, RecyclerView.HORIZONTAL, false));
        categoryGroupAdapter = new CategoryAdapter(this::selectCategoryGroup);
        categoryGroups.setAdapter(categoryGroupAdapter);
        root.addView(categoryGroups, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(58)));

        RecyclerView categories = new RecyclerView(this);
        categories.setLayoutManager(new GridLayoutManager(this, 2, RecyclerView.HORIZONTAL, false));
        categoryAdapter = new CategoryAdapter(this::selectCategory);
        categories.setAdapter(categoryAdapter);
        root.addView(categories, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(112)));

        LinearLayout labelRow = new LinearLayout(this);
        labelRow.setGravity(Gravity.CENTER_VERTICAL);
        heading = new TextView(this);
        heading.setText("正在連線…");
        heading.setTextSize(22);
        heading.setTextColor(Color.WHITE);
        labelRow.addView(heading, new LinearLayout.LayoutParams(0, dp(48), 1f));
        status = new TextView(this);
        status.setTextColor(0xFFAAB3C5);
        labelRow.addView(status);
        removeHistory = button("刪除單項", view -> toggleHistoryDeleteMode());
        removeHistory.setVisibility(View.GONE);
        labelRow.addView(removeHistory);
        clearHistory = button("清除全部", view -> confirmClearHistory());
        clearHistory.setVisibility(View.GONE);
        labelRow.addView(clearHistory);
        previousPage = button("上一頁", view -> loadPage(Math.max(1, page - 1)));
        previousPage.setVisibility(View.GONE);
        labelRow.addView(previousPage);
        nextPage = button("下一頁", view -> loadPage(page + 1));
        nextPage.setVisibility(View.GONE);
        labelRow.addView(nextPage);
        root.addView(labelRow);

        movieGrid = new RecyclerView(this);
        movieGrid.setLayoutManager(new GridLayoutManager(this, 5));
        movieGrid.setHasFixedSize(true);
        movieAdapter = new MovieAdapter(this::openMovie);
        movieGrid.setAdapter(movieAdapter);
        root.addView(movieGrid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);
    }

    private Button button(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setBackground(MovieAdapter.background(0xFF26324B, dp(10)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        params.setMargins(dp(8), 0, 0, 0);
        button.setLayoutParams(params);
        button.setOnClickListener(listener);
        button.setOnFocusChangeListener((view, focused) -> button.setBackground(MovieAdapter.background(focused ? 0xFF5B8CFF : 0xFF26324B, dp(10))));
        return button;
    }

    private void loadCategories() {
        status.setText("連線至 " + ApiClient.baseUrl(this));
        ApiClient.categories(this, new ApiClient.Callback<List<Models.Category>>() {
            @Override public void onSuccess(List<Models.Category> values) {
                allCategories.clear();
                allCategories.addAll(values);
                List<Models.Category> groups = new ArrayList<>();
                for (Models.Category category : values) {
                    if (category.id.length() == 2) groups.add(category);
                }
                categoryGroupAdapter.replace(groups);
                status.setText(values.size() + " 個分類");
                if (!groups.isEmpty()) {
                    selectCategoryGroup(groups.get(0));
                    categoryGroups.post(() -> {
                        RecyclerView.ViewHolder first = categoryGroups.findViewHolderForAdapterPosition(0);
                        if (first != null) first.itemView.requestFocus();
                    });
                }
            }
            @Override public void onError(String message) { showError("無法載入分類：" + message); }
        });
    }

    private void showStartupHostPrompt() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(ApiClient.baseUrl(this));
        input.setSelectAllOnFocus(true);
        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("連線至小鴨影視")
                .setMessage("請確認主機位址。測試伺服器已預先填入。")
                .setView(input)
                .setPositiveButton("連線", (value, which) -> {
                    ApiClient.setBaseUrl(this, input.getText().toString());
                    startCategories();
                })
                .setNegativeButton("使用預設值", (value, which) -> {
                    ApiClient.setBaseUrl(this, ApiClient.DEFAULT_BASE_URL);
                    startCategories();
                })
                .create();
        dialog.setOnCancelListener(value -> startCategories());
        dialog.show();
    }

    private void startCategories() {
        if (categoriesStarted) return;
        categoriesStarted = true;
        loadCategories();
    }

    private void selectCategoryGroup(Models.Category group) {
        categoryGroupAdapter.select(group.id);
        List<Models.Category> children = new ArrayList<>();
        children.add(new Models.Category(group.id, "全部" + group.name));
        for (Models.Category category : allCategories) {
            if (!category.id.equals(group.id) && category.id.startsWith(group.id)) children.add(category);
        }
        categoryAdapter.replace(children);
        selectCategory(children.get(0));
    }

    private void selectCategory(Models.Category category) {
        leaveLocalView();
        selectedCategory = category.id;
        page = 1;
        categoryAdapter.select(category.id);
        heading.setText(category.name);
        movieAdapter.replace(Collections.emptyList());
        loadPage(1);
    }

    private void loadPage(int targetPage) {
        if (selectedCategory.isEmpty()) return;
        status.setText("載入中…");
        previousPage.setEnabled(false);
        nextPage.setEnabled(false);
        ApiClient.catalog(this, selectedCategory, targetPage, new ApiClient.Callback<List<Models.Movie>>() {
            @Override public void onSuccess(List<Models.Movie> values) {
                if (values.isEmpty()) {
                    status.setText("已經是最後一頁");
                    previousPage.setEnabled(true);
                    nextPage.setVisibility(View.GONE);
                    return;
                }
                page = targetPage;
                movieAdapter.replace(values);
                status.setText("第 " + page + " 頁 · " + values.size() + " 項");
                previousPage.setVisibility(page > 1 ? View.VISIBLE : View.GONE);
                previousPage.setEnabled(true);
                nextPage.setVisibility(View.VISIBLE);
                nextPage.setEnabled(true);
                movieGrid.scrollToPosition(0);
                focusFirstMovie();
            }
            @Override public void onError(String message) {
                previousPage.setEnabled(true);
                nextPage.setEnabled(true);
                showError("載入失敗：" + message);
            }
        });
    }

    private void performSearch() {
        String query = search.getText().toString().trim();
        if (query.isEmpty()) return;
        leaveLocalView();
        heading.setText("搜尋：" + query);
        status.setText("搜尋中…");
        previousPage.setVisibility(View.GONE);
        nextPage.setVisibility(View.GONE);
        movieAdapter.replace(Collections.emptyList());
        ApiClient.search(this, query, new ApiClient.Callback<List<Models.Movie>>() {
            @Override public void onSuccess(List<Models.Movie> values) { movieAdapter.replace(values); status.setText(values.size() + " 個結果"); }
            @Override public void onError(String message) { showError("搜尋失敗：" + message); }
        });
    }

    private void showLocal(String title, List<Models.Movie> values) {
        localView = title;
        historyDeleteMode = false;
        heading.setText(title);
        status.setText(values.size() + " 項");
        previousPage.setVisibility(View.GONE);
        nextPage.setVisibility(View.GONE);
        boolean isHistory = "播放記錄".equals(title);
        removeHistory.setVisibility(isHistory ? View.VISIBLE : View.GONE);
        clearHistory.setVisibility(isHistory ? View.VISIBLE : View.GONE);
        removeHistory.setText("刪除單項");
        movieAdapter.replace(values);
        focusFirstMovie();
    }

    private void showFavorites() {
        CrashReporter.action(this, "open_favorites");
        try {
            showLocal("收藏", LibraryStore.favorites(this));
        } catch (Throwable error) {
            LibraryStore.clearFavorites(this);
            showLocal("收藏", Collections.emptyList());
            showError("收藏資料已重設，請重新加入收藏。" );
        }
    }

    private void openMovie(Models.Movie movie) {
        if ("播放記錄".equals(localView) && historyDeleteMode) {
            new AlertDialog.Builder(this)
                    .setTitle("移除播放記錄")
                    .setMessage("要移除《" + movie.title + "》及其播放進度嗎？")
                    .setPositiveButton("移除", (dialog, which) -> {
                        LibraryStore.removeHistory(this, movie.id);
                        showLocal("播放記錄", LibraryStore.history(this));
                    })
                    .setNegativeButton("取消", null)
                    .show();
            return;
        }
        Intent intent = new Intent(this, DetailActivity.class);
        intent.putExtra("id", movie.id);
        intent.putExtra("title", movie.title);
        intent.putExtra("poster", movie.poster);
        startActivity(intent);
    }

    private void toggleHistoryDeleteMode() {
        historyDeleteMode = !historyDeleteMode;
        removeHistory.setText(historyDeleteMode ? "取消刪除" : "刪除單項");
        heading.setText(historyDeleteMode ? "播放記錄 · 選擇要刪除的項目" : "播放記錄");
        status.setText(historyDeleteMode ? "按下影片即可移除" : LibraryStore.history(this).size() + " 項");
    }

    private void confirmClearHistory() {
        new AlertDialog.Builder(this)
                .setTitle("清除全部播放記錄")
                .setMessage("這也會清除所有已儲存的播放進度。")
                .setPositiveButton("全部清除", (dialog, which) -> {
                    LibraryStore.clearHistory(this);
                    showLocal("播放記錄", Collections.emptyList());
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void leaveLocalView() {
        localView = "";
        historyDeleteMode = false;
        if (removeHistory != null) removeHistory.setVisibility(View.GONE);
        if (clearHistory != null) clearHistory.setVisibility(View.GONE);
    }

    private void focusFirstMovie() {
        if (movieGrid == null || movieAdapter.getItemCount() == 0) return;
        movieGrid.post(() -> {
            RecyclerView.ViewHolder first = movieGrid.findViewHolderForAdapterPosition(0);
            if (first != null) first.itemView.requestFocus();
            else movieGrid.requestFocus();
        });
    }

    private void showSettings() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(ApiClient.baseUrl(this));
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle("Relay 位址")
                .setMessage("例如 http://10.0.0.105:8787")
                .setView(input)
                .setPositiveButton("儲存", (dialog, which) -> { ApiClient.setBaseUrl(this, input.getText().toString()); loadCategories(); })
                .setNegativeButton("取消", null)
                .show();
    }

    private void showError(String message) {
        status.setText(message);
    }

    private int dp(int value) { return MovieAdapter.dp(this, value); }
}
