import { Injectable } from '@nestjs/common';
import { EntityNotFoundError } from '../../domain/entities/application-error.js';
import type {
  InteractionEventInput,
  RecommendationQuery,
  SimilarItemsQuery,
} from '../../domain/entities/recommendation.js';
import { RecommendationRepository } from '../../domain/repositories/recommendation.repository.js';
import { UserRepository } from '../../domain/repositories/user.repository.js';
import { calculateAge } from '../../domain/entities/user.js';

@Injectable()
export class RecommendationUseCases {
  constructor(
    private readonly recommendations: RecommendationRepository,
    private readonly users: UserRepository,
  ) {}

  async listForUser(userId: number, query: RecommendationQuery) {
    await this.assertUser(userId);
    return this.recommendations.listForUser(userId, query);
  }

  async getPreferenceSummary(userId: number) {
    const user = await this.assertUser(userId);
    const summary = await this.recommendations.getPreferenceSummary(userId);
    return {
      user: { ...user, age: calculateAge(user.birthDate) },
      ...summary,
    };
  }

  listSimilar(query: SimilarItemsQuery) {
    return this.recommendations.listSimilar(query);
  }

  getStatus() {
    return this.recommendations.getStatus();
  }

  async recordEvents(userId: number, events: InteractionEventInput[]) {
    await this.assertUser(userId);
    return {
      accepted: await this.recommendations.recordEvents(userId, events),
    };
  }

  private async assertUser(userId: number) {
    const user = await this.users.findById(userId);
    if (!user) throw new EntityNotFoundError('Usuário não encontrado.');
    return user;
  }
}
