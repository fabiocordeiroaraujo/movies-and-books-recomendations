import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type {
  RecommendationTrack,
} from '../../domain/entities/recommendation.js';

const toNumber = ({ value }: TransformFnParams): unknown =>
  value === undefined ? undefined : Number(value);

export class ListRecommendationsQueryDto {
  @IsIn(['MOVIE', 'BOOK', 'CROSS_MEDIA'])
  type: RecommendationTrack = 'MOVIE';

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class ListSimilarQueryDto {
  @IsOptional()
  @IsIn(['MOVIE', 'BOOK'])
  targetType?: 'MOVIE' | 'BOOK';

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}
