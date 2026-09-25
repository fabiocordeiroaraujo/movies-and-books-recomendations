import { Injectable } from '@nestjs/common';
import { EntityNotFoundError } from '../../domain/entities/application-error.js';
import type {
  Book,
  CatalogQuery,
  Category,
  MediaSummary,
  Movie,
  Page,
} from '../../domain/entities/catalog.js';
import { CatalogRepository } from '../../domain/repositories/catalog.repository.js';

@Injectable()
export class CatalogUseCases {
  constructor(private readonly catalogRepository: CatalogRepository) {}

  listMovies(query: CatalogQuery): Promise<Page<MediaSummary>> {
    return this.catalogRepository.listMovies(query);
  }

  async getMovie(id: number): Promise<Movie> {
    const movie = await this.catalogRepository.findMovieById(id);
    if (!movie) {
      throw new EntityNotFoundError('Filme não encontrado.');
    }
    return movie;
  }

  listBooks(query: CatalogQuery): Promise<Page<MediaSummary>> {
    return this.catalogRepository.listBooks(query);
  }

  async getBook(id: number): Promise<Book> {
    const book = await this.catalogRepository.findBookById(id);
    if (!book) {
      throw new EntityNotFoundError('Livro não encontrado.');
    }
    return book;
  }

  listCategories(): Promise<Category[]> {
    return this.catalogRepository.listCategories();
  }
}
