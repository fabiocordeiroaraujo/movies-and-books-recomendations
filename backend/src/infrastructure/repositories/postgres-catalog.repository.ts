import { Injectable } from '@nestjs/common';
import type {
  Book,
  CatalogQuery,
  Category,
  Keywords,
  MediaSummary,
  Movie,
  Page,
} from '../../domain/entities/catalog.js';
import { CatalogRepository } from '../../domain/repositories/catalog.repository.js';
import { DatabaseService } from '../database/database.service.js';

interface SummaryRow {
  id: string;
  title: string;
  description: string | null;
  release_year: number | null;
  average_rating: string | null;
  ratings_count: string | null;
  image_url: string | null;
  categories: Category[];
}

interface MovieRow extends SummaryRow {
  original_title: string;
  original_language: string;
  release_date: string;
  backdrop_image_url: string | null;
  popularity: string;
  source_url: string;
  keywords: Keywords;
}

interface BookRow extends SummaryRow {
  original_language: string;
  subtitle: string | null;
  isbn10: string;
  isbn13: string;
  page_count: number | null;
  authors: string[];
  keywords: Keywords;
}

interface CountRow {
  total: string;
}

interface CategoryRow {
  id: number;
  name: string;
}

@Injectable()
export class PostgresCatalogRepository extends CatalogRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async listMovies(query: CatalogQuery): Promise<Page<MediaSummary>> {
    const { where, values } = this.movieFilters(query);
    const offset = (query.page - 1) * query.pageSize;
    const listValues = [...values, query.pageSize, offset];
    const limitParameter = values.length + 1;
    const offsetParameter = values.length + 2;

    const [rows, countRows] = await Promise.all([
      this.database.query<SummaryRow>(
        `SELECT
          movie.movie_id AS id,
          movie.title,
          movie.description,
          movie.release_year,
          movie.average_rating,
          movie.ratings_count,
          movie.image_url,
          COALESCE((
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT('id', category.category_id, 'name', category.name)
              ORDER BY assignment.category_order
            )
            FROM catalog.movie_category_assignments AS assignment
            JOIN catalog.categories AS category
              ON category.category_id = assignment.category_id
            WHERE assignment.movie_id = movie.movie_id
          ), '[]'::JSON) AS categories
        FROM catalog.movies AS movie
        ${where}
        ORDER BY movie.popularity DESC, movie.ratings_count DESC, movie.movie_id
        LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        listValues,
      ),
      this.database.query<CountRow>(
        `SELECT COUNT(*) AS total FROM catalog.movies AS movie ${where}`,
        values,
      ),
    ]);

    return this.toPage(
      rows.map((row) => this.mapSummary(row, 'MOVIE')),
      countRows[0]?.total ?? '0',
      query,
    );
  }

  async findMovieById(id: number): Promise<Movie | null> {
    const rows = await this.database.query<MovieRow>(
      `SELECT
        movie.movie_id AS id,
        movie.title,
        movie.original_title,
        movie.original_language,
        movie.description,
        movie.keywords,
        movie.release_date::TEXT,
        movie.release_year,
        movie.average_rating,
        movie.ratings_count,
        movie.image_url,
        movie.backdrop_image_url,
        movie.popularity,
        movie.source_url,
        COALESCE((
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT('id', category.category_id, 'name', category.name)
            ORDER BY assignment.category_order
          )
          FROM catalog.movie_category_assignments AS assignment
          JOIN catalog.categories AS category
            ON category.category_id = assignment.category_id
          WHERE assignment.movie_id = movie.movie_id
        ), '[]'::JSON) AS categories
      FROM catalog.movies AS movie
      WHERE movie.movie_id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      ...this.mapSummary(row, 'MOVIE'),
      type: 'MOVIE',
      originalTitle: row.original_title,
      originalLanguage: row.original_language,
      releaseDate: row.release_date,
      backdropImageUrl: row.backdrop_image_url,
      popularity: Number(row.popularity),
      sourceUrl: row.source_url,
      keywords: row.keywords,
    };
  }

  async listBooks(query: CatalogQuery): Promise<Page<MediaSummary>> {
    const { where, values } = this.bookFilters(query);
    const offset = (query.page - 1) * query.pageSize;
    const listValues = [...values, query.pageSize, offset];
    const limitParameter = values.length + 1;
    const offsetParameter = values.length + 2;

    const [rows, countRows] = await Promise.all([
      this.database.query<SummaryRow>(
        `SELECT
          book.book_id AS id,
          book.title,
          book.description,
          book.release_year,
          book.average_rating,
          book.ratings_count,
          book.image_url,
          COALESCE((
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT('id', category.category_id, 'name', category.name)
              ORDER BY assignment.category_order
            )
            FROM catalog.book_category_assignments AS assignment
            JOIN catalog.categories AS category
              ON category.category_id = assignment.category_id
            WHERE assignment.book_id = book.book_id
          ), '[]'::JSON) AS categories
        FROM catalog.books AS book
        ${where}
        ORDER BY book.ratings_count DESC NULLS LAST, book.average_rating DESC NULLS LAST, book.book_id
        LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        listValues,
      ),
      this.database.query<CountRow>(
        `SELECT COUNT(*) AS total FROM catalog.books AS book ${where}`,
        values,
      ),
    ]);

    return this.toPage(
      rows.map((row) => this.mapSummary(row, 'BOOK')),
      countRows[0]?.total ?? '0',
      query,
    );
  }

  async findBookById(id: number): Promise<Book | null> {
    const rows = await this.database.query<BookRow>(
      `SELECT
        book.book_id AS id,
        book.title,
        book.original_language,
        book.subtitle,
        book.description,
        book.keywords,
        book.release_year,
        book.average_rating,
        book.ratings_count,
        book.image_url,
        book.isbn10,
        book.isbn13,
        book.page_count,
        ARRAY(
          SELECT author.name
          FROM catalog.book_authors AS relation
          JOIN catalog.authors AS author ON author.author_id = relation.author_id
          WHERE relation.book_id = book.book_id
          ORDER BY relation.author_order
        ) AS authors,
        COALESCE((
          SELECT JSON_AGG(
            JSON_BUILD_OBJECT('id', category.category_id, 'name', category.name)
            ORDER BY assignment.category_order
          )
          FROM catalog.book_category_assignments AS assignment
          JOIN catalog.categories AS category
            ON category.category_id = assignment.category_id
          WHERE assignment.book_id = book.book_id
        ), '[]'::JSON) AS categories
      FROM catalog.books AS book
      WHERE book.book_id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;

    return {
      ...this.mapSummary(row, 'BOOK'),
      type: 'BOOK',
      originalLanguage: row.original_language,
      subtitle: row.subtitle,
      isbn10: row.isbn10,
      isbn13: row.isbn13,
      pageCount: row.page_count,
      authors: row.authors,
      keywords: row.keywords,
    };
  }

  async listCategories(): Promise<Category[]> {
    return this.database.query<CategoryRow>(
      `SELECT category_id AS id, name
       FROM catalog.categories
       ORDER BY name`,
    );
  }

  private movieFilters(query: CatalogQuery): {
    where: string;
    values: unknown[];
  } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.query) {
      values.push(`%${query.query}%`);
      conditions.push(
        `(movie.title ILIKE $${values.length} OR movie.original_title ILIKE $${values.length})`,
      );
    }
    if (query.categoryId) {
      values.push(query.categoryId);
      conditions.push(`EXISTS (
        SELECT 1 FROM catalog.movie_category_assignments AS filtered_category
        WHERE filtered_category.movie_id = movie.movie_id
          AND filtered_category.category_id = $${values.length}
      )`);
    }
    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values,
    };
  }

  private bookFilters(query: CatalogQuery): {
    where: string;
    values: unknown[];
  } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (query.query) {
      values.push(`%${query.query}%`);
      conditions.push(`book.title ILIKE $${values.length}`);
    }
    if (query.categoryId) {
      values.push(query.categoryId);
      conditions.push(`EXISTS (
        SELECT 1 FROM catalog.book_category_assignments AS filtered_category
        WHERE filtered_category.book_id = book.book_id
          AND filtered_category.category_id = $${values.length}
      )`);
    }
    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      values,
    };
  }

  private mapSummary(
    row: SummaryRow,
    type: 'MOVIE' | 'BOOK',
  ): MediaSummary {
    return {
      id: Number(row.id),
      type,
      title: row.title,
      description: row.description,
      releaseYear: row.release_year,
      averageRating:
        row.average_rating === null ? null : Number(row.average_rating),
      ratingScale: 10,
      ratingsCount:
        row.ratings_count === null ? null : Number(row.ratings_count),
      imageUrl: row.image_url,
      categories: row.categories,
    };
  }

  private toPage(
    items: MediaSummary[],
    rawTotal: string,
    query: CatalogQuery,
  ): Page<MediaSummary> {
    const total = Number(rawTotal);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
