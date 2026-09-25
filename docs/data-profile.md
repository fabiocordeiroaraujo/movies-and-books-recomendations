# Perfil e contrato dos dados

Perfil revisado em 21 de setembro de 2026. É importante separar **fontes originais** de **arquivos processados**, pois eles têm funções diferentes.

## Fontes imutáveis

| Arquivo | Registros | Colunas | Identificador |
|---|---:|---:|---|
| `csv/Original_Books.csv` | 6.810 | 12 | `isbn13` e `isbn10` |
| `csv/Original_TMDB_movies.csv` | 1.999 | 20 | `tmdb_id` |

Esses arquivos são o ponto de partida reproduzível. A pipeline os lê, mas nunca os sobrescreve.

### Livros

- 6.810 ISBN-13 válidos e únicos;
- 6.810 ISBN-10 válidos e únicos;
- 4.470 nomes distintos de autores;
- 567 categorias de origem;
- anos de publicação entre 1853 e 2019;
- notas entre 0 e 5 na fonte.

Ausências relevantes:

| Campo | Ausências |
|---|---:|
| `subtitle` | 4.429 |
| `thumbnail` | 329 |
| `description` | 262 |
| `categories` | 99 |
| `authors` | 72 |
| `published_year` | 6 |
| `average_rating` | 43 |
| `num_pages` | 43 |
| `ratings_count` | 43 |

Uma ausência é mantida como ausência. Em particular, os 43 livros sem nota não recebem zero, porque zero seria uma avaliação conhecida e mudaria o significado do dado.

### Filmes

- 1.999 `tmdb_id` únicos;
- todos os registros atuais têm `original_language` preenchido;
- há 29 idiomas originais e 19 gêneros;
- `vote_average` já está na escala de 0 a 10;
- `release_year` corresponde a `release_date` em todos os registros.

Ausências relevantes:

| Campo | Ausências |
|---|---:|
| `overview` | 123 |
| `genre_ids` / `genre_names` | 6 |
| `backdrop_path` / `backdrop_url` | 16 |

## Arquivos processados

| Arquivo | Transformações esperadas |
|---|---|
| `csv/Books.csv` | `original_language`, nota 0–10 e `keywords` por LLM |
| `csv/TMDB_movies.csv` | idiomas ausentes estimados e `keywords` por LLM |

O contrato final é:

- nenhum ID ou campo de origem pode mudar, exceto os campos declaradamente derivados;
- todo item deve possuir `original_language` em código ISO 639-1 minúsculo;
- `average_rating` de livro deve ser exatamente a nota original multiplicada por 2;
- `vote_average` de filme deve ser preservada;
- todas as notas conhecidas devem ficar entre 0 e 10;
- `keywords` deve ser um JSON com somente `entidades` e `temas`;
- são permitidas até 8 entidades e 6 temas, sem strings vazias ou repetidas;
- a quantidade e a ordem dos itens devem permanecer iguais às fontes.

## Estado da regeneração

A pipeline com esse contrato está implementada e a integração com o Codex CLI instalado foi validada com uma inferência real. Os arquivos processados só passam a representar o novo método depois da execução completa de `./scripts/run_data_pipeline.sh`. Até essa execução, não se deve usar estatísticas das antigas keywords por regex como avaliação do novo extrator.

Depois da execução, registre pelo menos:

- checksum SHA-256 das duas fontes e dos dois resultados;
- data da execução;
- modelo `gpt-5.6-luna` e esforço `medium`;
- versão dos prompts;
- quantidade de respostas reaproveitadas do cache;
- distribuição de idiomas;
- médias e ausências de entidades e temas;
- uma revisão humana estratificada de livros e filmes.

## Limitações conhecidas

O idioma de um livro inferido somente pelo título é uma estimativa. Nomes próprios e títulos muito curtos podem ser ambíguos. O campo é útil como sinal, mas não deve ser tratado como metadado editorial confirmado.

As keywords geradas por LLM também podem conter omissões ou interpretações discutíveis. O JSON Schema garante formato e limites, não verdade semântica. Por isso, a avaliação humana e o versionamento do prompt fazem parte do processo.
