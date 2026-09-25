import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CatalogNavigation } from './catalog-navigation';

describe('CatalogNavigation', () => {
  it('shows preferences, movies and books in the requested order', async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogNavigation],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(CatalogNavigation);
    fixture.detectChanges();
    await fixture.whenStable();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a'),
    );

    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Minhas Preferências',
      'Filmes',
      'Livros',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/catalog',
      '/catalog/movies',
      '/catalog/books',
    ]);
  });
});
