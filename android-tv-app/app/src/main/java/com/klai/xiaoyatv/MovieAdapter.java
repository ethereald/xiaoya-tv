package com.klai.xiaoyatv;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

final class MovieAdapter extends RecyclerView.Adapter<MovieAdapter.Holder> {
    interface Listener { void onMovie(Models.Movie movie); }
    private final Listener listener;
    private final List<Models.Movie> values = new ArrayList<>();

    MovieAdapter(Listener listener) { this.listener = listener; }

    void replace(List<Models.Movie> movies) { values.clear(); values.addAll(movies); notifyDataSetChanged(); }

    @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        Context context = parent.getContext();
        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setFocusable(true);
        root.setClickable(true);
        root.setPadding(dp(context, 7), dp(context, 7), dp(context, 7), dp(context, 9));
        RecyclerView.LayoutParams params = new RecyclerView.LayoutParams(dp(context, 210), dp(context, 330));
        params.setMargins(dp(context, 8), dp(context, 8), dp(context, 8), dp(context, 12));
        root.setLayoutParams(params);

        ImageView poster = new ImageView(context);
        poster.setScaleType(ImageView.ScaleType.CENTER_CROP);
        root.addView(poster, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 270)));
        TextView title = new TextView(context);
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setGravity(Gravity.CENTER);
        title.setMaxLines(2);
        root.addView(title, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 48)));
        return new Holder(root, poster, title);
    }

    @Override public void onBindViewHolder(@NonNull Holder holder, int position) {
        Models.Movie movie = values.get(position);
        holder.title.setText(movie.title);
        ImageLoader.load(holder.poster, movie.poster);
        holder.itemView.setOnClickListener(view -> listener.onMovie(movie));
        holder.itemView.setOnFocusChangeListener((view, focused) -> {
            view.animate().scaleX(focused ? 1.07f : 1f).scaleY(focused ? 1.07f : 1f).setDuration(120).start();
            holder.itemView.setBackground(background(focused ? 0xFF5B8CFF : 0xFF151B2B, dp(view.getContext(), 10)));
        });
        holder.itemView.setBackground(background(0xFF151B2B, dp(holder.itemView.getContext(), 10)));
    }

    @Override public int getItemCount() { return values.size(); }

    static final class Holder extends RecyclerView.ViewHolder {
        final ImageView poster;
        final TextView title;
        Holder(View view, ImageView poster, TextView title) { super(view); this.poster = poster; this.title = title; }
    }

    static GradientDrawable background(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    static int dp(Context context, int value) { return Math.round(value * context.getResources().getDisplayMetrics().density); }
}
