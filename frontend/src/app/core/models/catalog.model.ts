export type MediaType = 'MOVIE' | 'BOOK';
export type PreferenceValue = 'LIKE' | 'DISLIKE';

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

export interface MovieDetails extends MediaSummary {
  type: 'MOVIE';
  originalTitle: string;
  originalLanguage: string;
  releaseDate: string;
  backdropImageUrl: string | null;
  popularity: number;
  sourceUrl: string;
  keywords: Keywords;
}

export interface BookDetails extends MediaSummary {
  type: 'BOOK';
  subtitle: string | null;
  isbn10: string;
  isbn13: string;
  pageCount: number | null;
  authors: string[];
  keywords: Keywords;
}

export type MediaDetails = MovieDetails | BookDetails;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Preference {
  itemType: MediaType;
  itemId: number;
  preference: PreferenceValue;
  updatedAt: string;
}
