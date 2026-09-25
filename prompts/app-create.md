Crie uma aplicação Web no projeto:

`pos-graduacao/projetos/movies-and-books-recomendations/frontend`

O objetivo desta etapa é permitir que usuários indiquem suas **preferências pessoais por filmes e livros**, registrando se gostam ou não de cada item.

> **IMPORTANTE:** nesta etapa **não deve ser implementada nenhuma funcionalidade de recomendação**. O sistema apenas coleta, exibe e persiste as preferências dos usuários. A recomendação será desenvolvida posteriormente.

## 1. Análise inicial do projeto

Antes de implementar:

1. Analise a estrutura existente em:

   `pos-graduacao/projetos/movies-and-books-recomendations`

2. Analise especialmente o banco de dados já existente em:

   `pos-graduacao/projetos/movies-and-books-recomendations/database`

3. Verifique o `docker-compose` existente e os serviços que já estão em execução.

4. Reaproveite:

   * banco de dados;
   * estrutura de tabelas;
   * dados já cadastrados;
   * containers;
   * configurações existentes;

   sempre que possível.

Não crie um banco paralelo ou uma estrutura redundante sem necessidade.

5. O backend deve ser implementado em

`pos-graduacao/projetos/movies-and-books-recomendations/backend`

---

# 2. Funcionalidades

## 2.1 Filmes e livros

A aplicação deve possuir uma interface para exploração de:

* filmes;
* livros.

Deve ser possível visualizar uma lista de itens contendo, sempre que os dados estiverem disponíveis:

* imagem/capa/poster;
* título;
* ano;
* gênero/categoria;
* informações resumidas.

A interface deve ser visual e semelhante a aplicações modernas de streaming e catálogos de conteúdo.

Utilize as imagens fornecidas como **referência visual e inspiração de layout**, sem necessidade de copiá-las exatamente.

![alt text](image.png)

![alt text](image-1.png)

![alt text](image-2.png)

---

## 2.2 Detalhamento

Ao selecionar um filme ou livro, deve ser aberta uma tela ou área de detalhes apresentando as informações disponíveis sobre o item.

Para filmes, por exemplo:

* título;
* título original;
* descrição/sinopse;
* imagem/poster;
* ano;
* gêneros;
* duração;
* demais informações disponíveis no banco.

Para livros, por exemplo:

* título;
* autor;
* descrição/sinopse;
* imagem/capa;
* ano;
* categorias/gêneros;
* editora;
* demais informações disponíveis no banco.

A implementação deve se adaptar aos dados que realmente existirem no banco.

---

# 3. Preferências do usuário

Para cada filme ou livro, o usuário deve poder registrar sua preferência.

Disponibilize ações equivalentes a:

* 👍 **Gostei / Like**
* 👎 **Não gostei / Dislike**
* remover preferência anteriormente registrada.

A interface deve deixar visualmente claro qual preferência está atualmente selecionada.

A preferência deve ser persistida no banco de dados e vinculada ao usuário selecionado.

Cada usuário deve possuir suas próprias preferências independentes.

Exemplo:

```text
Usuário A
Filme X -> LIKE
Filme Y -> DISLIKE
Livro Z -> LIKE

Usuário B
Filme X -> DISLIKE
Livro Z -> LIKE
```

Ao trocar de usuário, a interface deve refletir imediatamente as preferências daquele usuário.

---

# 4. Usuários

A aplicação deve permitir selecionar qual usuário está utilizando o sistema.

Deve existir uma forma simples e visível de:

* visualizar o usuário atual;
* trocar de usuário;
* cadastrar um novo usuário.

No cadastro de usuário, disponibilizar os seguintes campos:

* nome;
* idade;
* data de nascimento;
* gênero;
* orientação sexual;
* nacionalidade;
* cidade;
* profissão.

Sempre que possível, utilize componentes adequados para cada tipo de informação:

* `date picker` para data;
* `select` quando fizer sentido;
* validação de campos;
* mensagens de erro amigáveis.

Os dados devem ser persistidos no banco.

Evite armazenar informações deriváveis de outras, salvo se a estrutura atual do banco já exigir isso. Por exemplo, se a idade puder ser calculada pela data de nascimento, prefira calcular a idade quando necessário em vez de manter informações inconsistentes.

---

# 5. Persistência

As preferências devem obrigatoriamente ser armazenadas no banco de dados existente.

O relacionamento deve permitir identificar:

* usuário;
* item;
* tipo do item (`movie` ou `book`);
* preferência (`LIKE` ou `DISLIKE`).

Caso a estrutura atual do banco já possua tabelas ou relacionamentos equivalentes, reutilize-os.

Caso seja necessário alterar o schema, faça isso de maneira compatível com a estrutura existente e utilizando migrations quando a tecnologia do projeto oferecer esse recurso.

---

# 6. Arquitetura

O projeto deve seguir os princípios de **Clean Architecture**, mantendo separadas as responsabilidades de:

* domínio;
* casos de uso/aplicação;
* infraestrutura;
* acesso a dados;
* API;
* interface Web.

Evite:

* regras de negócio dentro de controllers;
* acesso ao banco dentro de componentes do frontend;
* código fortemente acoplado ao banco;
* componentes excessivamente grandes;
* duplicação de lógica;
* mistura de responsabilidade entre camadas.

---

# 7. Comunicação Frontend → Backend

O frontend **nunca deve acessar o banco de dados diretamente**.

A comunicação obrigatoriamente deve seguir:

```text
Frontend
   ↓
Backend / API
   ↓
Application / Use Cases
   ↓
Repositories
   ↓
Banco de Dados
```

Toda operação deve ser realizada por meio do backend, incluindo:

* listar filmes;
* listar livros;
* buscar detalhes;
* listar usuários;
* cadastrar usuários;
* consultar preferências;
* registrar Like;
* registrar Dislike;
* remover preferência.

---

# 8. API

Crie ou adapte endpoints REST adequados para suportar as operações necessárias.

Exemplos conceituais:

```text
GET    /movies
GET    /movies/:id

GET    /books
GET    /books/:id

GET    /users
POST   /users
GET    /users/:id

GET    /users/:id/preferences

PUT    /users/:userId/movies/:movieId/preference
DELETE /users/:userId/movies/:movieId/preference

PUT    /users/:userId/books/:bookId/preference
DELETE /users/:userId/books/:bookId/preference
```

Esses endpoints são apenas uma referência. Adapte-os à arquitetura e aos padrões já existentes no projeto.

Evite criar endpoints redundantes ou inconsistentes.

---

# 9. Interface

A interface deve ter aparência moderna, responsiva e agradável.

Utilize como inspiração visual as imagens fornecidas.

Priorize:

* cards para filmes e livros;
* capas/posters em destaque;
* navegação simples;
* boa hierarquia visual;
* estados de hover;
* feedback visual para Like/Dislike;
* visualização clara do usuário atualmente selecionado;
* modal, drawer ou página própria para detalhes;
* estados de loading;
* estados vazios;
* tratamento visual de erros;
* responsividade.

A aplicação deve funcionar adequadamente tanto em desktop quanto em telas menores.

---

# 10. Organização da aplicação

Prefira componentes reutilizáveis.

Exemplos conceituais:

```text
MovieCard
BookCard
MediaCard
MediaGrid
MediaDetails
LikeButton
DislikeButton
PreferenceButtons
UserSelector
UserForm
Header
Loading
EmptyState
ErrorState
```

Evite duplicar componentes de filmes e livros quando uma abstração compartilhada fizer sentido.

---

# 11. Experiência do usuário

O fluxo esperado é:

```text
1. Usuário acessa a aplicação

2. Seleciona um usuário existente
   OU
   cadastra um novo usuário

3. Navega entre:
   - Filmes
   - Livros

4. Visualiza os itens disponíveis

5. Abre detalhes de um item

6. Marca:
   👍 Gostei
   ou
   👎 Não gostei

7. A preferência é persistida no backend

8. Ao acessar novamente a aplicação,
   as preferências permanecem registradas.

9. Ao mudar de usuário,
   as preferências exibidas mudam de acordo com o novo usuário.
```

---

# 12. Qualidade do código

A implementação deve:

* manter tipagem adequada;
* evitar `any` desnecessário;
* evitar código duplicado;
* manter nomes claros;
* criar componentes pequenos e reutilizáveis;
* separar regras de negócio da interface;
* tratar erros corretamente;
* evitar valores mágicos;
* manter configuração em arquivos apropriados;
* seguir os padrões já existentes no projeto.

Não substitua tecnologias existentes sem uma razão técnica concreta.

---

# 13. Escopo explicitamente excluído

**NÃO IMPLEMENTAR NESTA ETAPA:**

* algoritmo de recomendação;
* recomendação baseada em usuário;
* recomendação baseada em conteúdo;
* collaborative filtering;
* content-based filtering;
* machine learning;
* embeddings;
* busca vetorial;
* similaridade entre usuários;
* similaridade entre filmes;
* similaridade entre livros;
* ranking personalizado;
* tela de "Recomendados para você".

O objetivo desta fase é **somente construir a base de usuários, catálogo e coleta de preferências** que futuramente poderá alimentar o sistema de recomendação.

---

# 14. Critérios de conclusão

Considere a tarefa concluída somente quando for possível:

* iniciar o ambiente usando a infraestrutura existente;
* carregar filmes existentes no banco;
* carregar livros existentes no banco;
* visualizar suas imagens/capas quando disponíveis;
* abrir os detalhes de um filme;
* abrir os detalhes de um livro;
* listar usuários;
* cadastrar um usuário;
* trocar o usuário ativo;
* marcar um filme como Like;
* marcar um filme como Dislike;
* marcar um livro como Like;
* marcar um livro como Dislike;
* alterar uma preferência;
* remover uma preferência;
* atualizar a página e verificar que as preferências continuam persistidas;
* trocar de usuário e visualizar as preferências específicas daquele usuário;
* garantir que o frontend não tenha nenhum acesso direto ao banco;
* garantir que a aplicação esteja organizada segundo os princípios de Clean Architecture;
* garantir que nenhuma funcionalidade de recomendação tenha sido implementada.

Antes de finalizar, execute a aplicação e valide os principais fluxos de ponta a ponta.


Use as imagens abaixo como inspiração de layout.

OBSERVAÇÃO: NÃO IMPLEMENTE NADA RELACIONADO A RECOMENDAÇÃO NESSE MOMENTO.

![alt text](image.png)
![alt text](image-1.png)
![alt text](image-2.png)