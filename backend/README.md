# Reel & Read API

API NestJS responsável pelo catálogo, usuários, preferências e recomendações. A implementação segue o fluxo `controllers → casos de uso → contratos de repositório → PostgreSQL`; nenhuma regra de acesso a dados está nos controllers e nenhum treinamento ocorre no processo HTTP.

## Executar

Com o PostgreSQL do projeto ativo na porta 5432:

```bash
npm install
npm run start:dev
```

A API fica disponível em `http://localhost:3000`.

Configuração opcional:

| Variável | Padrão |
|---|---|
| `PORT` | `3000` |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |
| `DB_NAME` | `recommendations` |
| `DB_USER` | `recommendations` |
| `DB_PASSWORD` | `recommendations_dev` |
| `DB_POOL_SIZE` | `10` |
| `DB_SSL` | `false` |
| `CORS_ORIGINS` | origens locais do Angular |

## Validar

```bash
npm run build
npm run lint
npm test
```

Consulte a documentação geral e a lista de endpoints em [README.MD](../README.MD).
