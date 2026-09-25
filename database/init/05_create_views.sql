BEGIN;

CREATE OR REPLACE VIEW catalog.items AS
SELECT
    'BOOK'::TEXT AS item_type,
    book_id AS item_id,
    isbn13::TEXT AS source_id,
    title,
    original_language,
    description,
    keywords,
    release_year,
    average_rating,
    10.0::NUMERIC AS rating_scale,
    ratings_count,
    image_url,
    source_import_id
FROM catalog.books
UNION ALL
SELECT
    'MOVIE'::TEXT AS item_type,
    movie_id AS item_id,
    tmdb_id::TEXT AS source_id,
    title,
    original_language,
    description,
    keywords,
    release_year,
    average_rating,
    10.0::NUMERIC AS rating_scale,
    ratings_count,
    image_url,
    source_import_id
FROM catalog.movies;

COMMENT ON VIEW catalog.items IS
    'Leitura unificada de livros e filmes com nomes de colunas padronizados.';

CREATE OR REPLACE VIEW catalog.recommendation_items AS
select
	isbn13::TEXT AS source_id,
    'Book'::TEXT AS type,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.book_category_assignments AS assignment
        WHERE assignment.book_id = book.book_id
        ORDER BY assignment.category_order
    ) AS categorie_ids,
    book.title,
    book.original_language,
    ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(book.keywords -> 'entidades')
    ) AS entidades,
    ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(book.keywords -> 'temas')
    ) AS temas,
    book.release_year AS year,
    book.average_rating AS vote_average,
    book.ratings_count AS vote_count
FROM catalog.books AS book
UNION ALL
select
	tmdb_id::TEXT AS source_id,
    'Movie'::TEXT AS type,
    ARRAY(
        SELECT assignment.category_id
        FROM catalog.movie_category_assignments AS assignment
        WHERE assignment.movie_id = movie.movie_id
        ORDER BY assignment.category_order
    ) AS categorie_ids,
    movie.title,
    movie.original_language,
    ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(movie.keywords -> 'entidades')
    ) AS entidades,
    ARRAY(
        SELECT JSONB_ARRAY_ELEMENTS_TEXT(movie.keywords -> 'temas')
    ) AS temas,
    movie.release_year AS year,
    movie.average_rating AS vote_average,
    movie.ratings_count AS vote_count
FROM catalog.movies AS movie;

COMMENT ON VIEW catalog.recommendation_items IS
    'Lista única para recomendação, com uma linha por livro ou filme e campos multivalorados como arrays.';

COMMENT ON COLUMN catalog.recommendation_items.categorie_ids IS
    'IDs de todas as categorias do item, em ordem; array vazio quando não há classificação.';

COMMENT ON COLUMN catalog.recommendation_items.entidades IS
    'Entidades extraídas da descrição, preservando a ordem do JSON de origem.';

COMMENT ON COLUMN catalog.recommendation_items.temas IS
    'Temas extraídos da descrição, preservando a ordem do JSON de origem.';

COMMENT ON COLUMN catalog.recommendation_items.vote_average IS
    'Nota comparável na escala comum de 0 a 10 para Book e Movie.';

COMMIT;
