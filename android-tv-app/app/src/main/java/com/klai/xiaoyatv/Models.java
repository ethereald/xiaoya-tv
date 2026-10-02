package com.klai.xiaoyatv;

import java.util.ArrayList;
import java.util.List;

final class Models {
    static final class Category {
        final String id;
        final String name;
        Category(String id, String name) { this.id = clean(id); this.name = clean(name); }
    }

    static final class Movie {
        final String id;
        final String title;
        final String poster;
        final String description;
        final String year;
        Movie(String id, String title, String poster, String description, String year) {
            this.id = clean(id);
            this.title = clean(title);
            this.poster = clean(poster);
            this.description = clean(description);
            this.year = clean(year);
        }
    }

    static final class Episode {
        final int index;
        final String label;
        Episode(int index, String label) { this.index = index; this.label = clean(label); }
    }

    static final class Detail {
        final Movie movie;
        final String category;
        final List<Episode> episodes;
        Detail(Movie movie, String category, List<Episode> episodes) {
            this.movie = movie;
            this.category = clean(category);
            this.episodes = episodes == null ? new ArrayList<>() : episodes;
        }
    }

    private static String clean(String value) { return value == null ? "" : value; }

    private Models() {}
}
