# Preparação e carga dos dados

## 1. Arquivos e responsabilidades

```text
Original_Books.csv       fonte imutável de livros
Original_TMDB_movies.csv fonte imutável de filmes
          ↓
run_data_pipeline.sh     transformações reproduzíveis
          ↓
Books.csv                livros prontos para carga
TMDB_movies.csv          filmes prontos para carga
          ↓
01_reload_all.sql        seed inicial do PostgreSQL
```

Não edite manualmente os arquivos processados. Uma correção deve ser feita no script ou no prompt e a pipeline deve ser executada novamente.

## 2. Executar a pipeline

Confirme que o Codex CLI está instalado e autenticado na máquina:

```bash
codex --version
codex login # execute apenas se ainda não houver uma sessão autenticada
```

Depois execute:

```bash
./scripts/run_data_pipeline.sh
```

A pipeline usa fixamente:

- modelo `gpt-5.6-luna`;
- esforço de raciocínio `medium`;
- execução não interativa por `codex exec`;
- sandbox somente leitura;
- sessão efêmera;
- saída validada por JSON Schema.

Ela não usa a API diretamente nem lê `OPENAI_API_KEY` do `.env`. A autenticação é a sessão já salva pelo Codex instalado. Os scripts Python não instalam bibliotecas: usam somente a biblioteca padrão do Python 3.10 ou superior.

### Etapas

1. `estimate_languages.py` lê as fontes, adiciona idioma aos livros e só estima idioma de filme quando a fonte estiver vazia;
2. `normalize_ratings.py` multiplica notas conhecidas de livros por 2 e preserva notas e ausências dos filmes;
3. `extract_keywords_llm.py` extrai entidades e temas em lotes;
4. `validate_processed_data.py` compara resultado e fonte;
5. somente após todas as validações os dois CSVs finais são publicados.

Os intermediários e o cache ficam em `csv/.pipeline-work/`, diretório ignorado pelo Git. Se uma chamada falhar, execute o mesmo comando novamente: entradas já concluídas e ainda válidas serão recuperadas do cache.

Os tamanhos dos lotes podem ser reduzidos se um lote for grande demais para o contexto disponível:

```bash
LANGUAGE_BATCH_SIZE=20 KEYWORD_BATCH_SIZE=6 ./scripts/run_data_pipeline.sh
```

Alterar o texto de entrada, o prompt, o modelo ou o esforço muda o hash e invalida somente as entradas afetadas.

## 3. Revisar antes da carga

A validação automática detecta formato e integridade estrutural, mas não substitui revisão semântica. Antes de carregar uma nova versão:

1. selecione amostras aleatórias e casos difíceis;
2. confira títulos curtos, nomes próprios e títulos multilíngues;
3. confira itens sem descrição;
4. compare keywords com o texto fornecido;
5. registre os checksums e a versão dos prompts;
6. aprove ou rejeite o lote como um todo.

## 4. Inicializar o banco

Os arquivos de `database/init` são aplicados automaticamente apenas quando o volume PostgreSQL é criado pela primeira vez:

```bash
docker compose up -d --wait postgres
```

Em produção, `database/load/01_reload_all.sql` é um **seed destrutivo de execução única**. Ele deve ser executado somente durante a inicialização da base, depois da aprovação dos CSVs e antes da coleta de usuários e preferências.

Para desenvolvimento, o invólucro abaixo valida o contrato, pede confirmação e executa a carga:

```bash
./scripts/load_database.sh
```

Uso não interativo em um ambiente descartável:

```bash
./scripts/load_database.sh --yes
```

O SQL também pode ser executado manualmente:

```bash
docker compose exec -T postgres \
  psql -U recommendations -d recommendations \
  < database/load/01_reload_all.sql
```

O seed trunca catálogo, staging e preferências. Ele não é uma rotina de deploy, atualização incremental ou reprocessamento de produção.

## 5. Mudança estrutural atual

O novo catálogo adiciona idioma aos livros e muda a restrição de suas notas para 0–10. Como o projeto ainda permite perda do banco atual, recrie o volume de desenvolvimento depois de gerar os CSVs:

```bash
docker compose down -v
docker compose up -d --wait postgres
./scripts/load_database.sh
```

`docker compose down -v` remove os dados do volume. Não use esse procedimento numa base com dados que devam ser preservados.

## 6. Conferências SQL

```sql
SELECT COUNT(*) FROM catalog.books;  -- 6810
SELECT COUNT(*) FROM catalog.movies; -- 1999

SELECT MIN(average_rating), MAX(average_rating)
FROM catalog.books;

SELECT item_type, MIN(average_rating), MAX(average_rating), MIN(rating_scale)
FROM catalog.items
GROUP BY item_type;

SELECT original_language, COUNT(*)
FROM catalog.items
GROUP BY original_language
ORDER BY COUNT(*) DESC;

SELECT item_type, source_id, title, keywords -> 'temas' AS temas
FROM catalog.items
WHERE keywords @> '{"temas": ["magia"]}'::JSONB;
```

O resultado esperado de `rating_scale` é 10 para os dois tipos. Os 43 livros sem avaliação permanecem `NULL`.

## 7. Atualizações futuras

Quando a aplicação estiver em produção, uma atualização de catálogo deverá usar um fluxo incremental diferente do seed:

- fazer `upsert` por `isbn13` ou `tmdb_id`;
- preservar IDs internos e preferências;
- versionar o lote e seus checksums;
- recalcular somente os dados derivados afetados;
- nunca executar `TRUNCATE` em preferências.
