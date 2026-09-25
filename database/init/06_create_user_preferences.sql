BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
    'Dados transacionais da aplicação, separados do catálogo importado.';

CREATE TABLE IF NOT EXISTS app.users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    birth_date DATE NOT NULL,
    gender TEXT,
    sexual_orientation TEXT,
    nationality TEXT,
    city TEXT,
    profession TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_name_not_blank CHECK (BTRIM(name) <> ''),
    CONSTRAINT users_birth_date_reasonable CHECK (birth_date >= DATE '1900-01-01'),
    CONSTRAINT users_gender_not_blank CHECK (gender IS NULL OR BTRIM(gender) <> ''),
    CONSTRAINT users_orientation_not_blank CHECK (
        sexual_orientation IS NULL OR BTRIM(sexual_orientation) <> ''
    ),
    CONSTRAINT users_nationality_not_blank CHECK (
        nationality IS NULL OR BTRIM(nationality) <> ''
    ),
    CONSTRAINT users_city_not_blank CHECK (city IS NULL OR BTRIM(city) <> ''),
    CONSTRAINT users_profession_not_blank CHECK (
        profession IS NULL OR BTRIM(profession) <> ''
    )
);

COMMENT ON COLUMN app.users.birth_date IS
    'Fonte para cálculo da idade; a idade não é persistida para evitar inconsistência.';

CREATE TABLE IF NOT EXISTS app.user_preferences (
    preference_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL
        REFERENCES app.users (user_id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    movie_id BIGINT
        REFERENCES catalog.movies (movie_id) ON DELETE CASCADE,
    book_id BIGINT
        REFERENCES catalog.books (book_id) ON DELETE CASCADE,
    preference TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_preferences_item_type CHECK (
        item_type IN ('MOVIE', 'BOOK')
    ),
    CONSTRAINT user_preferences_value CHECK (
        preference IN ('LIKE', 'DISLIKE')
    ),
    CONSTRAINT user_preferences_target_matches_type CHECK (
        (item_type = 'MOVIE' AND movie_id IS NOT NULL AND book_id IS NULL)
        OR
        (item_type = 'BOOK' AND book_id IS NOT NULL AND movie_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_movie_unique
    ON app.user_preferences (user_id, movie_id)
    WHERE movie_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_user_book_unique
    ON app.user_preferences (user_id, book_id)
    WHERE book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_preferences_user_idx
    ON app.user_preferences (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON app.users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON app.users
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON app.user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON app.user_preferences
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMIT;
