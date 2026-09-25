# Recomendações: arquitetura e operação

O Reel & Read usa recuperação vetorial e ranking híbrido em duas camadas. O frontend nunca acessa vetores e a API nunca treina modelos durante uma requisição.

## Componentes

- PostgreSQL 17 com pgvector 0.8.1 armazena versões, embeddings, perfis e recomendações materializadas.
- O worker Python usa `intfloat/multilingual-e5-small` na revisão fixa `614241f622f53c4eeff9890bdc4f31cfecc418b3` e gera vetores normalizados de 384 dimensões.
- A API NestJS lê a versão ativa. Se um perfil estiver desatualizado, calcula o baseline com os embeddings ativos; se ainda não houver embeddings, usa popularidade com exclusão dos itens avaliados.
- O ranker TensorFlow/Keras de duas torres só treina com pelo menos 1.000 interações e 100 usuários ativos. A promoção exige ganho de `NDCG@10` ou `Precision@10` sobre a similaridade de conteúdo; até lá o baseline continua ativo.
- O Angular oferece Minhas Preferências em `/catalog`, ao lado das abas Filmes e Livros, com resumo de gosto, preferências enriquecidas e trilhos separados.

## Ranking híbrido

O ranking combina sinais de conteúdo e filtragem colaborativa. Universo ou franquia continua sendo o maior sinal individual (24%): os termos do título são normalizados sem diferença de caixa ou acento e precisam ser corroborados pelas entidades nomeadas do item. Isso conecta `Narnia` a `Nárnia` sem transformar palavras genéricas, como “novo” ou “morte”, em franquias. Categoria, tema/palavra-chave e personagem ou entidade nomeada valem 17% cada. Similaridade com o perfil e proximidade com o like mais parecido valem 4% cada, e qualidade bayesiana vale 5%.

O sinal colaborativo vale 12%. Para cada perfil, o sistema seleciona no máximo 25 outros usuários com similaridade vetorial de gosto a partir de 65%. Likes desses vizinhos geram afinidade para o item e dislikes geram conflito; ambos são ponderados pela proximidade entre os perfis e sofrem suavização para que um único vizinho não domine o ranking. Itens curtidos por vizinhos entram no conjunto de candidatos mesmo quando estão fora do top semântico. Nenhuma identidade ou preferência individual de outro usuário é exposta pela API: o frontend recebe somente a explicação agregada **“Usuários parecidos com você gostaram disto”**.

As preferências de livros e filmes são consideradas em conjunto nos dois trilhos. Assim, gostar de um livro de Nárnia aumenta diretamente a pontuação dos filmes da mesma franquia, e o inverso também ocorre.

Likes e dislikes são contados separadamente. Um sinal rejeitado reduz a afinidade positiva e também gera penalidade explícita: até 35% por conflito de categoria, 25% por título/franquia, 20% por tema, 20% por personagem/entidade, 15% por rejeição dos usuários similares e 10% por proximidade semântica com dislikes. Assim, compartilhar uma categoria rejeitada, como Terror, não é compensado apenas por uma similaridade textual ou colaborativa alta.

Os pesos ficam registrados em `recommendation.model_versions.hyperparameters`. O worker e o cálculo imediato da API usam a mesma fórmula; este último é aplicado enquanto o perfil está marcado como desatualizado. O conjunto inicial de candidatos foi ampliado para 600 itens antes do reranking e da diversificação.

A diversificação reduz repetições da mesma franquia para intercalar universos relevantes, mas nunca considera itens com menos de 40% do melhor score daquele trilho. Dessa forma, variedade não promove uma obra sem relação apenas para preencher a lista.

## Atualizar um banco existente

```bash
./scripts/migrate_database.sh
```

As migrations são reaplicáveis e registradas em `app.schema_migrations`. Elas não removem catálogo, usuários ou preferências. O alias legado `categorie_ids` permanece na view durante a transição para `category_ids`.

Para validar que extensões, vetores e dados podem ser restaurados em um banco temporário:

```bash
./scripts/verify_backup_restore.sh
```

## Executar o worker

O primeiro ciclo baixa o modelo E5 e processa todo o catálogo. Os ciclos seguintes copiam embeddings cujo hash canônico não mudou e recalculam somente os demais.

```bash
docker compose --profile worker build recommendation-worker
docker compose --profile worker run --rm recommendation-worker
```

O job usa `pg_try_advisory_lock`, registra seu estado em `recommendation.training_runs` e só ativa a versão candidata em uma transação após validar a cobertura. Uma falha marca a candidata como rejeitada e preserva a versão ativa anterior.

## Agenda

[`deploy/recommendation-cronjob.yaml`](../deploy/recommendation-cronjob.yaml) agenda o comando diariamente às 03:00 em `America/Recife`, usa `concurrencyPolicy: Forbid`, backoff, timeout e volumes persistentes para cache e artefatos. Antes de aplicar o manifesto, publique a imagem com o nome configurado, crie o Secret `reel-and-read-recommendation-db` e os dois PVCs referenciados.

## API

| Método | Rota |
|---|---|
| `GET` | `/users/:userId/recommendations?type=MOVIE\|BOOK\|CROSS_MEDIA&limit=20` |
| `GET` | `/users/:userId/preference-summary` |
| `POST` | `/users/:userId/interactions` |
| `GET` | `/items/:type/:itemId/similar?targetType=MOVIE\|BOOK&limit=20` |
| `GET` | `/recommendation/status` |

As explicações são derivadas de componentes reais do score. A data de nascimento nunca entra diretamente: o worker deriva apenas a década etária e a reduz à faixa de `0,00` a `0,10`, mantendo esse sinal com baixa magnitude. Cidade, profissão, gênero e orientação sexual não aparecem em motivos nem entram no primeiro ranker.

As requisições do módulo gravam somente rota, status, duração e uso de fallback em `recommendation.api_request_metrics`. P50, P95 e percentual de fallback podem ser calculados sem registrar usuário ou conteúdo pessoal.

## Verificações

```bash
# Banco
docker compose exec -T postgres psql -U recommendations -d recommendations \
  -c "SELECT * FROM app.schema_migrations ORDER BY applied_at"

# Worker (na imagem reproduzível)
docker compose --profile worker run --rm --no-deps \
  --entrypoint python recommendation-worker -m unittest discover -s tests -v

# Aplicação
(cd backend && npm run build && npm run lint && npm test)
(cd frontend && npm run build && npm test -- --watch=false)
```
