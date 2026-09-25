BEGIN;

CREATE INDEX IF NOT EXISTS books_title_lower_idx
    ON catalog.books (LOWER(title));

CREATE INDEX IF NOT EXISTS books_release_year_idx
    ON catalog.books (release_year);

CREATE INDEX IF NOT EXISTS books_rating_popularity_idx
    ON catalog.books (average_rating DESC, ratings_count DESC);

CREATE INDEX IF NOT EXISTS books_keywords_gin_idx
    ON catalog.books USING GIN (keywords JSONB_PATH_OPS);

CREATE INDEX IF NOT EXISTS authors_name_lower_idx
    ON catalog.authors (LOWER(name));

CREATE INDEX IF NOT EXISTS book_authors_author_idx
    ON catalog.book_authors (author_id, book_id);

CREATE INDEX IF NOT EXISTS book_category_assignments_category_idx
    ON catalog.book_category_assignments (category_id, book_id);

CREATE INDEX IF NOT EXISTS movies_title_lower_idx
    ON catalog.movies (LOWER(title));

CREATE INDEX IF NOT EXISTS movies_original_title_lower_idx
    ON catalog.movies (LOWER(original_title));

CREATE INDEX IF NOT EXISTS movies_release_year_idx
    ON catalog.movies (release_year);

CREATE INDEX IF NOT EXISTS movies_rating_popularity_idx
    ON catalog.movies (average_rating DESC, ratings_count DESC, popularity DESC);

CREATE INDEX IF NOT EXISTS movies_keywords_gin_idx
    ON catalog.movies USING GIN (keywords JSONB_PATH_OPS);

CREATE INDEX IF NOT EXISTS movie_category_assignments_category_idx
    ON catalog.movie_category_assignments (category_id, movie_id);

COMMIT;
