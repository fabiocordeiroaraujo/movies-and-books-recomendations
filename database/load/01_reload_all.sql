\set ON_ERROR_STOP on

-- Carga integral e reproduzível dos dois CSVs montados em /imports.
-- ATENÇÃO: seed destrutivo de execução única; apaga staging, catalog,
-- preferências, eventos e todos os artefatos derivados de recomendação.

BEGIN;

TRUNCATE TABLE
    recommendation.api_request_metrics,
    recommendation.user_recommendations,
    recommendation.user_profiles,
    recommendation.item_embeddings,
    recommendation.training_runs,
    recommendation.model_versions,
    app.interaction_events,
    app.user_preferences,
    catalog.book_authors,
    catalog.book_category_assignments,
    catalog.movie_category_assignments,
    catalog.category_classification_rules,
    catalog.authors,
    catalog.books,
    catalog.movies,
    catalog.categories,
    staging.books_csv,
    staging.tmdb_movies_csv
RESTART IDENTITY;

COPY staging.books_csv (
    isbn13,
    isbn10,
    title,
    original_language,
    subtitle,
    authors,
    categories,
    thumbnail,
    description,
    published_year,
    average_rating,
    num_pages,
    ratings_count,
    keywords
)
FROM '/imports/Books.csv'
WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8');

COPY staging.tmdb_movies_csv (
    tmdb_id,
    title,
    original_title,
    original_language,
    overview,
    release_date,
    release_year,
    adult,
    video,
    popularity,
    vote_average,
    vote_count,
    genre_ids,
    genre_names,
    poster_path,
    poster_url,
    backdrop_path,
    backdrop_url,
    tmdb_url,
    fetched_at,
    keywords
)
FROM '/imports/TMDB_movies.csv'
WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8');

INSERT INTO catalog.books (
    source_import_id,
    isbn13,
    isbn10,
    title,
    original_language,
    subtitle,
    description,
    keywords,
    release_year,
    average_rating,
    ratings_count,
    image_url,
    page_count
)
SELECT
    import_id,
    BTRIM(isbn13),
    BTRIM(isbn10),
    BTRIM(title),
    BTRIM(original_language),
    NULLIF(BTRIM(subtitle), ''),
    NULLIF(BTRIM(description), ''),
    BTRIM(keywords)::JSONB,
    NULLIF(BTRIM(published_year), '')::SMALLINT,
    NULLIF(BTRIM(average_rating), '')::NUMERIC(5, 3),
    NULLIF(BTRIM(ratings_count), '')::BIGINT,
    NULLIF(BTRIM(thumbnail), ''),
    NULLIF(BTRIM(num_pages), '')::INTEGER
FROM staging.books_csv;

WITH parsed_authors AS (
    SELECT DISTINCT BTRIM(parsed.author_name) AS name
    FROM staging.books_csv AS source
    CROSS JOIN LATERAL regexp_split_to_table(
        COALESCE(source.authors, ''),
        ';'
    ) AS parsed(author_name)
    WHERE NULLIF(BTRIM(parsed.author_name), '') IS NOT NULL
)
INSERT INTO catalog.authors (name)
SELECT name
FROM parsed_authors;

WITH parsed_authors AS (
    SELECT
        source.import_id,
        BTRIM(parsed.author_name) AS name,
        MIN(parsed.author_order)::SMALLINT AS author_order
    FROM staging.books_csv AS source
    CROSS JOIN LATERAL regexp_split_to_table(
        COALESCE(source.authors, ''),
        ';'
    ) WITH ORDINALITY AS parsed(author_name, author_order)
    WHERE NULLIF(BTRIM(parsed.author_name), '') IS NOT NULL
    GROUP BY source.import_id, BTRIM(parsed.author_name)
)
INSERT INTO catalog.book_authors (book_id, author_id, author_order)
SELECT book.book_id, author.author_id, parsed.author_order
FROM parsed_authors AS parsed
JOIN catalog.books AS book
    ON book.source_import_id = parsed.import_id
JOIN catalog.authors AS author
    ON author.name = parsed.name;

INSERT INTO catalog.movies (
    source_import_id,
    tmdb_id,
    title,
    original_title,
    original_language,
    description,
    keywords,
    release_date,
    release_year,
    average_rating,
    ratings_count,
    image_path,
    image_url,
    backdrop_image_path,
    backdrop_image_url,
    adult,
    video,
    popularity,
    source_url,
    source_fetched_at
)
SELECT
    import_id,
    BTRIM(tmdb_id)::BIGINT,
    BTRIM(title),
    BTRIM(original_title),
    BTRIM(original_language),
    NULLIF(BTRIM(overview), ''),
    BTRIM(keywords)::JSONB,
    BTRIM(release_date)::DATE,
    BTRIM(release_year)::SMALLINT,
    BTRIM(vote_average)::NUMERIC(5, 3),
    BTRIM(vote_count)::BIGINT,
    BTRIM(poster_path),
    BTRIM(poster_url),
    NULLIF(BTRIM(backdrop_path), ''),
    NULLIF(BTRIM(backdrop_url), ''),
    BTRIM(adult)::BOOLEAN,
    BTRIM(video)::BOOLEAN,
    BTRIM(popularity)::NUMERIC(18, 6),
    BTRIM(tmdb_url),
    BTRIM(fetched_at)::TIMESTAMPTZ
FROM staging.tmdb_movies_csv;

WITH parsed_categories AS (
    SELECT DISTINCT
        BTRIM(category_id.value)::INTEGER AS category_id,
        BTRIM(category_name.value) AS name
    FROM staging.tmdb_movies_csv AS source
    CROSS JOIN LATERAL unnest(
        string_to_array(COALESCE(source.genre_ids, ''), '|')
    ) WITH ORDINALITY AS category_id(value, position)
    JOIN LATERAL unnest(
        string_to_array(COALESCE(source.genre_names, ''), '|')
    ) WITH ORDINALITY AS category_name(value, position)
        ON category_name.position = category_id.position
    WHERE NULLIF(BTRIM(category_id.value), '') IS NOT NULL
      AND NULLIF(BTRIM(category_name.value), '') IS NOT NULL
)
INSERT INTO catalog.categories (category_id, name)
SELECT category_id, name
FROM parsed_categories;

INSERT INTO catalog.category_classification_rules (
    category_id,
    priority,
    rule_name,
    match_pattern,
    description
)
VALUES
    (27, 10, 'horror',
        'horror|ghost|vampire|demon|exorc|occult|dracula|witchcraft',
        'Terror, fantasmas, vampiros, demônios e ocultismo.'),
    (878, 20, 'science_fiction',
        'science fiction|interplanetary|other planets|human-alien|cloning|dystopia|star trek|mars [(]planet[)]|otherland',
        'Ficção científica, viagens espaciais, alienígenas, clonagem e distopias.'),
    (14, 30, 'fantasy',
        'fantasy|fairy|magic|mytholog|dragon|elves|angel|imaginary|legendary|arthurian|folklore|baggins|discworld|chrestomanci',
        'Fantasia, magia, mitologia, criaturas e lugares imaginários.'),
    (9648, 40, 'mystery',
        'detective|mystery|poirot|marple|crime investigation',
        'Mistério, investigação e histórias de detetive.'),
    (80, 50, 'crime',
        'true crime|organized crime|criminal|crime|murder|assassin|gang|outlaw|cocaine industry|black market|bail bond',
        'Crimes, criminosos, assassinatos e organizações criminosas.'),
    (53, 60, 'thriller',
        'thriller|suspense|espionage|intelligence service|conspirac|terrorist|psycho',
        'Suspense, espionagem, conspiração e thriller psicológico.'),
    (37, 70, 'western',
        'western|cowboy|frontier|pioneer life',
        'Faroeste, caubóis e vida na fronteira.'),
    (10752, 80, 'war',
        '(^|[^a-z])war([^a-z]|$)|battle|holocaust|crusade|military|antisemit|slave insurrection',
        'Guerras, batalhas, conflitos militares e seus efeitos.'),
    (12, 90, 'adventure',
        'adventure|explorer|voyage|shipwreck|sea stor|survival|airplane crash|arctic region|everest',
        'Aventuras, explorações, viagens e sobrevivência.'),
    (10749, 100, 'romance',
        'romance|(^|[^a-z])love([^a-z]|$)|courtship|dating|adultery|seduction|man-woman relationship|chick lit|first loves',
        'Romance, amor, namoro e relacionamentos amorosos.'),
    (35, 110, 'comedy',
        'comedy|humor|humour|humorous|wit',
        'Comédia, humor e sátira.'),
    (10402, 120, 'music',
        '(^|[^a-z])music|musician|rock group|cellist|ballet',
        'Música, músicos, grupos musicais, dança e balé.'),
    (16, 130, 'animation',
        'comic|graphic novel|animation|pictorial',
        'Quadrinhos, romances gráficos, animação e narrativas pictóricas.'),
    (10770, 140, 'tv_movie',
        'television|motion picture|feature film|performing arts|film producer|actors and actresses',
        'Cinema, televisão, artes cênicas e produção audiovisual.'),
    (10751, 150, 'family',
        'juvenile|children|family|families|parent|baby|teen|adolesc|friendship|animal|pet|boys|girls|christmas',
        'Obras juvenis, infantis, familiares e sobre relações familiares.'),
    (36, 160, 'history',
        'history|historical|ancient|archaeolog|stone age|empire|president|political',
        'História, períodos históricos, arqueologia e história política.'),
    (28, 170, 'action',
        '(^|[^a-z])action([^a-z]|$)|sports|aeronautics|accident|bombing|escape',
        'Ação, esportes, acidentes, fugas e situações de risco.'),
    (18, 180, 'drama',
        'fiction|drama|poetry|literary|literature|short stor|novel|tragedy|relationship',
        'Ficção geral, drama, poesia, literatura e relações humanas.'),
    (99, 999, 'documentary_fallback',
        '.*',
        'Não ficção ou assunto sem equivalente mais específico na taxonomia.' );

WITH parsed_categories AS (
    SELECT
        source.import_id,
        BTRIM(category_id.value)::INTEGER AS category_id,
        category_id.position::SMALLINT AS category_order
    FROM staging.tmdb_movies_csv AS source
    CROSS JOIN LATERAL unnest(
        string_to_array(COALESCE(source.genre_ids, ''), '|')
    ) WITH ORDINALITY AS category_id(value, position)
    WHERE NULLIF(BTRIM(category_id.value), '') IS NOT NULL
)
INSERT INTO catalog.movie_category_assignments (movie_id, category_id, category_order)
SELECT movie.movie_id, category.category_id, category.category_order
FROM parsed_categories AS category
JOIN catalog.movies AS movie
    ON movie.source_import_id = category.import_id;

INSERT INTO catalog.book_category_assignments (
    book_id,
    category_id,
    category_order,
    source_category,
    classification_rule_id
)
SELECT
    book.book_id,
    classification.category_id,
    1,
    BTRIM(source.categories),
    classification.classification_rule_id
FROM staging.books_csv AS source
JOIN catalog.books AS book
    ON book.source_import_id = source.import_id
CROSS JOIN LATERAL (
    SELECT rule.classification_rule_id, rule.category_id
    FROM catalog.category_classification_rules AS rule
    WHERE LOWER(BTRIM(source.categories)) ~ rule.match_pattern
    ORDER BY rule.priority
    LIMIT 1
) AS classification
WHERE NULLIF(BTRIM(source.categories), '') IS NOT NULL;

COMMIT;

ANALYZE catalog.books;
ANALYZE catalog.movies;
ANALYZE catalog.authors;
ANALYZE catalog.book_authors;
ANALYZE catalog.categories;
ANALYZE catalog.category_classification_rules;
ANALYZE catalog.book_category_assignments;
ANALYZE catalog.movie_category_assignments;

SELECT 'staging.books_csv' AS relation, COUNT(*) AS rows FROM staging.books_csv
UNION ALL
SELECT 'staging.tmdb_movies_csv', COUNT(*) FROM staging.tmdb_movies_csv
UNION ALL
SELECT 'catalog.books', COUNT(*) FROM catalog.books
UNION ALL
SELECT 'catalog.movies', COUNT(*) FROM catalog.movies
UNION ALL
SELECT 'catalog.authors', COUNT(*) FROM catalog.authors
UNION ALL
SELECT 'catalog.categories', COUNT(*) FROM catalog.categories
UNION ALL
SELECT 'catalog.classified_books', COUNT(*) FROM catalog.book_category_assignments
ORDER BY relation;
