import { routes } from './app.routes';

describe('application routes', () => {
  it('lazy-loads preferences, movies and books and makes preferences the default', () => {
    expect(
      routes.find((route) => route.path === 'catalog')?.loadComponent,
    ).toBeTypeOf('function');
    expect(
      routes.find((route) => route.path === 'catalog/movies')?.loadComponent,
    ).toBeTypeOf('function');
    expect(
      routes.find((route) => route.path === 'catalog/books')?.loadComponent,
    ).toBeTypeOf('function');
    expect(routes.find((route) => route.path === 'my-preferences')?.redirectTo).toBe(
      'catalog',
    );
    expect(routes.find((route) => route.path === '')?.redirectTo).toBe(
      'catalog',
    );
  });
});
