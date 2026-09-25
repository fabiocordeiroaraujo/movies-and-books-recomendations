import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BookDetails,
  Category,
  MediaSummary,
  MovieDetails,
  Page,
} from '../models/catalog.model';
import { API_BASE_URL } from '../config/api.config';

export interface CatalogRequest {
  page: number;
  pageSize: number;
  query?: string;
  categoryId?: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  listMovies(request: CatalogRequest) {
    return this.http.get<Page<MediaSummary>>(`${this.baseUrl}/movies`, {
      params: this.toParams(request),
    });
  }

  getMovie(id: number) {
    return this.http.get<MovieDetails>(`${this.baseUrl}/movies/${id}`);
  }

  listBooks(request: CatalogRequest) {
    return this.http.get<Page<MediaSummary>>(`${this.baseUrl}/books`, {
      params: this.toParams(request),
    });
  }

  getBook(id: number) {
    return this.http.get<BookDetails>(`${this.baseUrl}/books/${id}`);
  }

  listCategories() {
    return this.http.get<Category[]>(`${this.baseUrl}/categories`);
  }

  private toParams(request: CatalogRequest): HttpParams {
    let params = new HttpParams()
      .set('page', request.page)
      .set('pageSize', request.pageSize);
    if (request.query) params = params.set('query', request.query);
    if (request.categoryId) {
      params = params.set('categoryId', request.categoryId);
    }
    return params;
  }
}
