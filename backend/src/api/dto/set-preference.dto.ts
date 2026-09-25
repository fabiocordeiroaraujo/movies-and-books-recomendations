import { IsIn } from 'class-validator';
import type { PreferenceValue } from '../../domain/entities/preference.js';

export class SetPreferenceDto {
  @IsIn(['LIKE', 'DISLIKE'], {
    message: 'A preferência deve ser LIKE ou DISLIKE.',
  })
  preference: PreferenceValue;
}
