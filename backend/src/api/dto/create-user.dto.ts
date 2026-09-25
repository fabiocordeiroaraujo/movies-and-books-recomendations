import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome.' })
  @MaxLength(120)
  name: string;

  @IsDateString({}, { message: 'Informe uma data de nascimento válida.' })
  birthDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sexualOrientation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  profession?: string;
}
