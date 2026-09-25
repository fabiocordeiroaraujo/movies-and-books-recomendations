import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { PreferenceUseCases } from '../../application/use-cases/preference.use-cases.js';
import { SetPreferenceDto } from '../dto/set-preference.dto.js';

@Controller('users/:userId')
export class PreferencesController {
  constructor(private readonly preferences: PreferenceUseCases) {}

  @Get('preferences')
  list(@Param('userId', ParseIntPipe) userId: number) {
    return this.preferences.listByUser(userId);
  }

  @Put('movies/:itemId/preference')
  setMovie(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() input: SetPreferenceDto,
  ) {
    return this.preferences.set(userId, 'MOVIE', itemId, input.preference);
  }

  @Delete('movies/:itemId/preference')
  @HttpCode(204)
  removeMovie(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.preferences.remove(userId, 'MOVIE', itemId);
  }

  @Put('books/:itemId/preference')
  setBook(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() input: SetPreferenceDto,
  ) {
    return this.preferences.set(userId, 'BOOK', itemId, input.preference);
  }

  @Delete('books/:itemId/preference')
  @HttpCode(204)
  removeBook(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.preferences.remove(userId, 'BOOK', itemId);
  }
}
