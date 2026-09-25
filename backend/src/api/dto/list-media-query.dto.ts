import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toNumber = ({ value }: TransformFnParams): unknown =>
  value === undefined ? undefined : Number(value);

export class ListMediaQueryDto {
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(48)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  categoryId?: number;
}
