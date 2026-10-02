package com.klai.xiaoyatv;

import android.content.Context;
import android.graphics.Color;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

final class CategoryAdapter extends RecyclerView.Adapter<CategoryAdapter.Holder> {
    interface Listener { void onCategory(Models.Category category); }
    private final Listener listener;
    private final List<Models.Category> values = new ArrayList<>();
    private String selectedId = "";

    CategoryAdapter(Listener listener) { this.listener = listener; }
    void replace(List<Models.Category> categories) { values.clear(); values.addAll(categories); notifyDataSetChanged(); }
    void select(String id) { selectedId = id; notifyDataSetChanged(); }

    @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        Context context = parent.getContext();
        TextView text = new TextView(context);
        text.setTextColor(Color.WHITE);
        text.setTextSize(16);
        text.setGravity(Gravity.CENTER);
        text.setFocusable(true);
        text.setClickable(true);
        text.setPadding(MovieAdapter.dp(context, 22), 0, MovieAdapter.dp(context, 22), 0);
        RecyclerView.LayoutParams params = new RecyclerView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, MovieAdapter.dp(context, 52));
        params.setMargins(MovieAdapter.dp(context, 5), 0, MovieAdapter.dp(context, 5), 0);
        text.setLayoutParams(params);
        return new Holder(text);
    }

    @Override public void onBindViewHolder(@NonNull Holder holder, int position) {
        Models.Category category = values.get(position);
        holder.text.setText(category.name);
        boolean selected = category.id.equals(selectedId);
        holder.text.setBackground(MovieAdapter.background(selected ? 0xFF365FB8 : 0xFF151B2B, MovieAdapter.dp(holder.text.getContext(), 12)));
        holder.text.setOnClickListener(view -> listener.onCategory(category));
        holder.text.setOnFocusChangeListener((view, focused) ->
                holder.text.setBackground(MovieAdapter.background(focused ? 0xFF5B8CFF : (selected ? 0xFF365FB8 : 0xFF151B2B), MovieAdapter.dp(view.getContext(), 12))));
    }

    @Override public int getItemCount() { return values.size(); }
    static final class Holder extends RecyclerView.ViewHolder {
        final TextView text;
        Holder(TextView text) { super(text); this.text = text; }
    }
}
