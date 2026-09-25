import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CatalogUseCases } from '../../application/use-cases/catalog.use-cases.js';
import type { CatalogQuery } from '../../domain/entities/catalog.js';
import { ListMediaQueryDto } from '../dto/list-media-query.dto.js';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogUseCases) {}

  @Get('movies')
  listMovies(@Query() query: ListMediaQueryDto) {
    return this.catalog.listMovies(this.toQuery(query));
  }

  @Get('movies/:id')
  getMovie(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.getMovie(id);
  }

  @Get('books')
  listBooks(@Query() query: ListMediaQueryDto) {
    return this.catalog.listBooks(this.toQuery(query));
  }

  @Get('books/:id')
  getBook(@Param('id', ParseIntPipe) id: number) {
    return this.catalog.getBook(id);
  }

  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  private toQuery(query: ListMediaQueryDto): CatalogQuery {
    const normalizedSearch = query.query?.trim();
    return {
      page: query.page,
      pageSize: query.pageSize,
      query: normalizedSearch || undefined,
      categoryId: query.categoryId,
    };
  }
}
