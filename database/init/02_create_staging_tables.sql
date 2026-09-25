BEGIN;

CREATE TABLE IF NOT EXISTS staging.books_csv (
    import_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    isbn13 TEXT,
    isbn10 TEXT,
    title TEXT,
    original_language TEXT,
    subtitle TEXT,
    authors TEXT,
    categories TEXT,
    thumbnail TEXT,
    description TEXT,
    published_year TEXT,
    average_rating TEXT,
    num_pages TEXT,
    ratings_count TEXT,
    keywords TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE staging.books_csv IS
    'Espelho das 14 colunas do Books.csv processado. Campos textuais preservam ISBN, JSON e valores vazios.';

CREATE TABLE IF NOT EXISTS staging.tmdb_movies_csv (
    import_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tmdb_id TEXT,
    title TEXT,
    original_title TEXT,
    original_language TEXT,
    overview TEXT,
    release_date TEXT,
    release_year TEXT,
    adult TEXT,
    video TEXT,
    popularity TEXT,
    vote_average TEXT,
    vote_count TEXT,
    genre_ids TEXT,
    genre_names TEXT,
    poster_path TEXT,
    poster_url TEXT,
    backdrop_path TEXT,
    backdrop_url TEXT,
    tmdb_url TEXT,
    fetched_at TEXT,
    keywords TEXT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE staging.tmdb_movies_csv IS
    'Espelho das 21 colunas do TMDB_movies.csv processado pela pipeline.';

COMMIT;
