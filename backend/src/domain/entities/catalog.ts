export type MediaType = 'MOVIE' | 'BOOK';

export interface Category {
  id: number;
  name: string;
}

export interface Keywords {
  entidades: string[];
  temas: string[];
}

export interface MediaSummary {
  id: number;
  type: MediaType;
  title: string;
  description: string | null;
  releaseYear: number | null;
  averageRating: number | null;
  ratingScale: number;
  ratingsCount: number | null;
  imageUrl: string | null;
  categories: Category[];
}

export interface Movie extends MediaSummary {
  type: 'MOVIE';
  originalTitle: string;
  originalLanguage: string;
  releaseDate: string;
  backdropImageUrl: string | null;
  popularity: number;
  sourceUrl: string;
  keywords: Keywords;
}

export interface Book extends MediaSummary {
  type: 'BOOK';
  originalLanguage: string;
  subtitle: string | null;
  isbn10: string;
  isbn13: string;
  pageCount: number | null;
  authors: string[];
  keywords: Keywords;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CatalogQuery {
  page: number;
  pageSize: number;
  query?: string;
  categoryId?: number;
}
