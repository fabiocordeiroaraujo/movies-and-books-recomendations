import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { RecommendationUseCases } from '../../application/use-cases/recommendation.use-cases.js';
import type { MediaType } from '../../domain/entities/catalog.js';
import {
  ListRecommendationsQueryDto,
  ListSimilarQueryDto,
} from '../dto/list-recommendations-query.dto.js';
import { RecordInteractionsDto } from '../dto/record-interactions.dto.js';
import { RecommendationMetricsInterceptor } from '../recommendation-metrics.interceptor.js';

enum MediaTypeParameter {
  MOVIE = 'MOVIE',
  BOOK = 'BOOK',
}

@Controller()
@UseInterceptors(RecommendationMetricsInterceptor)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationUseCases) {}

  @Get('users/:userId/recommendations')
  listForUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: ListRecommendationsQueryDto,
  ) {
    return this.recommendations.listForUser(userId, query);
  }

  @Get('users/:userId/preference-summary')
  getPreferenceSummary(@Param('userId', ParseIntPipe) userId: number) {
    return this.recommendations.getPreferenceSummary(userId);
  }

  @Post('users/:userId/interactions')
  recordInteractions(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() input: RecordInteractionsDto,
  ) {
    return this.recommendations.recordEvents(userId, input.events);
  }

  @Get('items/:type/:itemId/similar')
  listSimilar(
    @Param('type', new ParseEnumPipe(MediaTypeParameter)) type: MediaType,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query() query: ListSimilarQueryDto,
  ) {
    return this.recommendations.listSimilar({
      itemType: type,
      itemId,
      targetType: query.targetType,
      limit: query.limit,
    });
  }

  @Get('recommendation/status')
  getStatus() {
    return this.recommendations.getStatus();
  }
}
