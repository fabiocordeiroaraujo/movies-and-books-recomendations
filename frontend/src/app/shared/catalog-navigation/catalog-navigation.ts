import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-catalog-navigation',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="catalog-navigation" aria-label="Seções do catálogo">
      <a
        routerLink="/catalog"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 20.5S4 16 4 9.5A4.5 4.5 0 0 1 12 6.7a4.5 4.5 0 0 1 8 2.8c0 6.5-8 11-8 11Z" />
        </svg>
        Minhas Preferências
      </a>
      <a routerLink="/catalog/movies" routerLinkActive="active">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3 6h18v13H3zM7 6l2-3m4 3 2-3m4 3 2-3" />
        </svg>
        Filmes
      </a>
      <a routerLink="/catalog/books" routerLinkActive="active">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17Zm0 17A2.5 2.5 0 0 1 6.5 19H20" />
        </svg>
        Livros
      </a>
    </nav>
  `,
  styleUrl: './catalog-navigation.css',
})
export class CatalogNavigation {}
