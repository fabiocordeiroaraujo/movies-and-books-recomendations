BEGIN;

CREATE SCHEMA IF NOT EXISTS staging;
CREATE SCHEMA IF NOT EXISTS catalog;

COMMENT ON SCHEMA staging IS
    'Camada de entrada: preserva os valores dos CSVs antes de limpeza e conversão.';

COMMENT ON SCHEMA catalog IS
    'Camada normalizada para livros, filmes, palavras-chave, autores e categorias compartilhadas.';

COMMIT;
