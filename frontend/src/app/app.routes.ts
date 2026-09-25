import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'catalog',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/my-preferences/my-preferences-page').then(
        (component) => component.MyPreferencesPage,
      ),
  },
  {
    path: 'catalog/movies',
    loadComponent: () =>
      import('./features/catalog/catalog-page').then(
        (component) => component.CatalogPage,
      ),
    data: { mediaType: 'MOVIE' },
  },
  {
    path: 'catalog/books',
    loadComponent: () =>
      import('./features/catalog/catalog-page').then(
        (component) => component.CatalogPage,
      ),
    data: { mediaType: 'BOOK' },
  },
  { path: 'my-preferences', pathMatch: 'full', redirectTo: 'catalog' },
  { path: 'movies', pathMatch: 'full', redirectTo: 'catalog/movies' },
  { path: 'books', pathMatch: 'full', redirectTo: 'catalog/books' },
  { path: '', pathMatch: 'full', redirectTo: 'catalog' },
  { path: '**', redirectTo: 'catalog' },
];
