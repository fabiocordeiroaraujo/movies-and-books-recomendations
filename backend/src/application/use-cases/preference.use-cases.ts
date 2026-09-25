import { Injectable } from '@nestjs/common';
import { EntityNotFoundError } from '../../domain/entities/application-error.js';
import type { MediaType } from '../../domain/entities/catalog.js';
import type {
  Preference,
  PreferenceValue,
} from '../../domain/entities/preference.js';
import { CatalogRepository } from '../../domain/repositories/catalog.repository.js';
import { PreferenceRepository } from '../../domain/repositories/preference.repository.js';
import { UserRepository } from '../../domain/repositories/user.repository.js';

@Injectable()
export class PreferenceUseCases {
  constructor(
    private readonly preferences: PreferenceRepository,
    private readonly users: UserRepository,
    private readonly catalog: CatalogRepository,
  ) {}

  async listByUser(userId: number): Promise<Preference[]> {
    await this.assertUserExists(userId);
    return this.preferences.listByUser(userId);
  }

  async set(
    userId: number,
    itemType: MediaType,
    itemId: number,
    preference: PreferenceValue,
  ): Promise<Preference> {
    await Promise.all([
      this.assertUserExists(userId),
      this.assertItemExists(itemType, itemId),
    ]);
    return this.preferences.upsert(userId, itemType, itemId, preference);
  }

  async remove(
    userId: number,
    itemType: MediaType,
    itemId: number,
  ): Promise<void> {
    await this.assertUserExists(userId);
    return this.preferences.remove(userId, itemType, itemId);
  }

  private async assertUserExists(userId: number): Promise<void> {
    if (!(await this.users.findById(userId))) {
      throw new EntityNotFoundError('Usuário não encontrado.');
    }
  }

  private async assertItemExists(
    itemType: MediaType,
    itemId: number,
  ): Promise<void> {
    const item =
      itemType === 'MOVIE'
        ? await this.catalog.findMovieById(itemId)
        : await this.catalog.findBookById(itemId);

    if (!item) {
      throw new EntityNotFoundError(
        itemType === 'MOVIE' ? 'Filme não encontrado.' : 'Livro não encontrado.',
      );
    }
  }
}
