import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import type { InteractionEventInput } from '../../domain/entities/recommendation.js';

class InteractionEventDto implements InteractionEventInput {
  @IsIn(['IMPRESSION', 'OPEN_DETAILS'])
  eventType: 'IMPRESSION' | 'OPEN_DETAILS';

  @IsIn(['MOVIE', 'BOOK'])
  itemType: 'MOVIE' | 'BOOK';

  @IsInt()
  @Min(1)
  itemId: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  modelVersion?: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class RecordInteractionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => InteractionEventDto)
  events: InteractionEventDto[];
}
