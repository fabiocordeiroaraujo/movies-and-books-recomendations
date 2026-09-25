# Reel & Read Web

Interface Angular 22 para explorar filmes e livros, visualizar detalhes, cadastrar e trocar perfis e registrar Like ou Dislike. O frontend se comunica somente com a API NestJS.

## Executar

Com a API disponível em `http://localhost:3000`:

```bash
npm install
npm start
```

A interface fica disponível em `http://localhost:4200`. O host da API é derivado do host usado para abrir a página e utiliza a porta 3000.

## Validar

```bash
npm run build
npm test -- --watch=false
```

A aplicação usa componentes standalone, rotas lazy, signals, formulários reativos, estados de loading/erro/vazio e controles com foco e semântica acessíveis.
