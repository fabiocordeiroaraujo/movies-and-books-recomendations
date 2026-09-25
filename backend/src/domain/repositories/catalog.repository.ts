import type {
  Book,
  CatalogQuery,
  Category,
  MediaSummary,
  Movie,
  Page,
} from '../entities/catalog.js';

export abstract class CatalogRepository {
  abstract listMovies(query: CatalogQuery): Promise<Page<MediaSummary>>;
  abstract findMovieById(id: number): Promise<Movie | null>;
  abstract listBooks(query: CatalogQuery): Promise<Page<MediaSummary>>;
  abstract findBookById(id: number): Promise<Book | null>;
  abstract listCategories(): Promise<Category[]>;
}
