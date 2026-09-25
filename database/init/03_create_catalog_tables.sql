BEGIN;

CREATE TABLE IF NOT EXISTS catalog.books (
    book_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_import_id BIGINT NOT NULL UNIQUE
        REFERENCES staging.books_csv (import_id) ON DELETE RESTRICT,
    isbn13 VARCHAR(13) NOT NULL UNIQUE,
    isbn10 VARCHAR(10) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    original_language VARCHAR(2) NOT NULL,
    subtitle TEXT,
    description TEXT,
    keywords JSONB NOT NULL,
    release_year SMALLINT,
    average_rating NUMERIC(5, 3),
    ratings_count BIGINT,
    image_url TEXT,
    page_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT books_title_not_blank CHECK (BTRIM(title) <> ''),
    CONSTRAINT books_original_language_format CHECK (
        original_language ~ '^[a-z]{2}$'
    ),
    CONSTRAINT books_isbn13_format CHECK (isbn13 ~ '^[0-9]{13}$'),
    CONSTRAINT books_isbn10_format CHECK (isbn10 ~ '^[0-9]{9}[0-9Xx]$'),
    CONSTRAINT books_release_year_range CHECK (
        release_year IS NULL OR release_year BETWEEN 1000 AND 9999
    ),
    CONSTRAINT books_average_rating_range CHECK (
        average_rating IS NULL OR average_rating BETWEEN 0 AND 10
    ),
    CONSTRAINT books_ratings_count_nonnegative CHECK (
        ratings_count IS NULL OR ratings_count >= 0
    ),
    CONSTRAINT books_page_count_nonnegative CHECK (
        page_count IS NULL OR page_count >= 0
    ),
    CONSTRAINT books_keywords_shape CHECK (
        JSONB_TYPEOF(keywords) = 'object'
        AND keywords ?& ARRAY['entidades', 'temas']
        AND keywords - 'entidades' - 'temas' = '{}'::JSONB
        AND JSONB_TYPEOF(keywords -> 'entidades') = 'array'
        AND JSONB_TYPEOF(keywords -> 'temas') = 'array'
        AND JSONB_ARRAY_LENGTH(keywords -> 'entidades') <= 8
        AND JSONB_ARRAY_LENGTH(keywords -> 'temas') <= 6
        AND NOT JSONB_PATH_EXISTS(
            keywords,
            '$.entidades[*] ? (@.type() != "string")'
        )
        AND NOT JSONB_PATH_EXISTS(
            keywords,
            '$.temas[*] ? (@.type() != "string")'
        )
    )
);

COMMENT ON TABLE catalog.books IS
    'Livros normalizados; atributos comuns seguem os mesmos nomes usados em catalog.movies.';

COMMENT ON COLUMN catalog.books.keywords IS
    'Objeto JSON com até 8 entidades e até 6 temas extraídos por LLM.';

COMMENT ON COLUMN catalog.books.average_rating IS
    'Nota média normalizada pela pipeline para a escala comum de 0 a 10.';

CREATE TABLE IF NOT EXISTS catalog.authors (
    author_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT authors_name_not_blank CHECK (BTRIM(name) <> '')
);

COMMENT ON TABLE catalog.authors IS
    'Autores identificados pelo nome disponível no Books.csv, que não fornece um ID externo.';

CREATE TABLE IF NOT EXISTS catalog.book_authors (
    book_id BIGINT NOT NULL
        REFERENCES catalog.books (book_id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL
        REFERENCES catalog.authors (author_id) ON DELETE RESTRICT,
    author_order SMALLINT NOT NULL,
    PRIMARY KEY (book_id, author_id),
    CONSTRAINT book_authors_order_unique UNIQUE (book_id, author_order),
    CONSTRAINT book_authors_order_positive CHECK (author_order > 0)
);

CREATE TABLE IF NOT EXISTS catalog.movies (
    movie_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_import_id BIGINT NOT NULL UNIQUE
        REFERENCES staging.tmdb_movies_csv (import_id) ON DELETE RESTRICT,
    tmdb_id BIGINT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL,
    original_language VARCHAR(2) NOT NULL,
    description TEXT,
    keywords JSONB NOT NULL,
    release_date DATE NOT NULL,
    release_year SMALLINT NOT NULL,
    average_rating NUMERIC(5, 3) NOT NULL,
    ratings_count BIGINT NOT NULL,
    image_path TEXT NOT NULL,
    image_url TEXT NOT NULL,
    backdrop_image_path TEXT,
    backdrop_image_url TEXT,
    adult BOOLEAN NOT NULL,
    video BOOLEAN NOT NULL,
    popularity NUMERIC(18, 6) NOT NULL,
    source_url TEXT NOT NULL,
    source_fetched_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT movies_tmdb_id_positive CHECK (tmdb_id > 0),
    CONSTRAINT movies_title_not_blank CHECK (BTRIM(title) <> ''),
    CONSTRAINT movies_original_title_not_blank CHECK (BTRIM(original_title) <> ''),
    CONSTRAINT movies_original_language_format CHECK (
        original_language ~ '^[a-z]{2}$'
    ),
    CONSTRAINT movies_release_year_range CHECK (release_year BETWEEN 1000 AND 9999),
    CONSTRAINT movies_release_year_matches_date CHECK (
        release_year = EXTRACT(YEAR FROM release_date)::SMALLINT
    ),
    CONSTRAINT movies_average_rating_range CHECK (average_rating BETWEEN 0 AND 10),
    CONSTRAINT movies_ratings_count_nonnegative CHECK (ratings_count >= 0),
    CONSTRAINT movies_image_path_format CHECK (image_path ~ '^/'),
    CONSTRAINT movies_image_url_https CHECK (image_url ~ '^https://'),
    CONSTRAINT movies_backdrop_image_pair CHECK (
        (backdrop_image_path IS NULL AND backdrop_image_url IS NULL)
        OR (BTRIM(backdrop_image_path) <> '' AND backdrop_image_url ~ '^https://')
    ),
    CONSTRAINT movies_popularity_nonnegative CHECK (popularity >= 0),
    CONSTRAINT movies_source_url_matches_id CHECK (
        source_url = 'https://www.themoviedb.org/movie/' || tmdb_id::TEXT
    ),
    CONSTRAINT movies_keywords_shape CHECK (
        JSONB_TYPEOF(keywords) = 'object'
        AND keywords ?& ARRAY['entidades', 'temas']
        AND keywords - 'entidades' - 'temas' = '{}'::JSONB
        AND JSONB_TYPEOF(keywords -> 'entidades') = 'array'
        AND JSONB_TYPEOF(keywords -> 'temas') = 'array'
        AND JSONB_ARRAY_LENGTH(keywords -> 'entidades') <= 8
        AND JSONB_ARRAY_LENGTH(keywords -> 'temas') <= 6
        AND NOT JSONB_PATH_EXISTS(
            keywords,
            '$.entidades[*] ? (@.type() != "string")'
        )
        AND NOT JSONB_PATH_EXISTS(
            keywords,
            '$.temas[*] ? (@.type() != "string")'
        )
    )
);

COMMENT ON TABLE catalog.movies IS
    'Filmes normalizados; vote_average, vote_count, overview e poster foram padronizados.';

COMMENT ON COLUMN catalog.movies.tmdb_id IS
    'Identificador oficial e estável do filme no TMDB.';

COMMENT ON COLUMN catalog.movies.image_path IS
    'Caminho de pôster retornado pelo TMDB, preservado para permitir outros tamanhos.';

COMMENT ON COLUMN catalog.movies.keywords IS
    'Objeto JSON com até 8 entidades e até 6 temas extraídos por LLM.';

CREATE TABLE IF NOT EXISTS catalog.categories (
    category_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT categories_id_positive CHECK (category_id > 0),
    CONSTRAINT categories_name_not_blank CHECK (BTRIM(name) <> '')
);

COMMENT ON TABLE catalog.categories IS
    'Taxonomia compartilhada por filmes e livros, baseada nos gêneros oficiais do TMDB.';

CREATE TABLE IF NOT EXISTS catalog.category_classification_rules (
    classification_rule_id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id INTEGER NOT NULL
        REFERENCES catalog.categories (category_id) ON DELETE RESTRICT,
    priority SMALLINT NOT NULL UNIQUE,
    rule_name TEXT NOT NULL UNIQUE,
    match_pattern TEXT NOT NULL,
    description TEXT NOT NULL,
    CONSTRAINT category_rules_priority_positive CHECK (priority > 0),
    CONSTRAINT category_rules_name_not_blank CHECK (BTRIM(rule_name) <> ''),
    CONSTRAINT category_rules_pattern_not_blank CHECK (BTRIM(match_pattern) <> ''),
    CONSTRAINT category_rules_description_not_blank CHECK (BTRIM(description) <> '')
);

COMMENT ON TABLE catalog.category_classification_rules IS
    'Regras regex, em ordem de prioridade, que convertem categorias originais de livros para a taxonomia compartilhada.';

CREATE TABLE IF NOT EXISTS catalog.book_category_assignments (
    book_id BIGINT NOT NULL
        REFERENCES catalog.books (book_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL
        REFERENCES catalog.categories (category_id) ON DELETE RESTRICT,
    category_order SMALLINT NOT NULL DEFAULT 1,
    source_category TEXT NOT NULL,
    classification_rule_id SMALLINT NOT NULL
        REFERENCES catalog.category_classification_rules (classification_rule_id) ON DELETE RESTRICT,
    PRIMARY KEY (book_id, category_id),
    CONSTRAINT book_category_assignments_order_unique UNIQUE (book_id, category_order),
    CONSTRAINT book_category_assignments_order_positive CHECK (category_order > 0),
    CONSTRAINT book_category_assignments_source_not_blank CHECK (BTRIM(source_category) <> '')
);

COMMENT ON TABLE catalog.book_category_assignments IS
    'Classificação de livros na taxonomia TMDB, preservando o rótulo original e a regra usada.';

CREATE TABLE IF NOT EXISTS catalog.movie_category_assignments (
    movie_id BIGINT NOT NULL
        REFERENCES catalog.movies (movie_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL
        REFERENCES catalog.categories (category_id) ON DELETE RESTRICT,
    category_order SMALLINT NOT NULL,
    PRIMARY KEY (movie_id, category_id),
    CONSTRAINT movie_category_assignments_order_unique UNIQUE (movie_id, category_order),
    CONSTRAINT movie_category_assignments_order_positive CHECK (category_order > 0)
);

COMMIT;
