import type {
  InteractionEventInput,
  PreferenceSummaryData,
  RecommendationList,
  RecommendationQuery,
  RecommendationStatus,
  SimilarItemsQuery,
} from '../entities/recommendation.js';

export abstract class RecommendationRepository {
  abstract listForUser(
    userId: number,
    query: RecommendationQuery,
  ): Promise<RecommendationList>;
  abstract getPreferenceSummary(userId: number): Promise<PreferenceSummaryData>;
  abstract listSimilar(query: SimilarItemsQuery): Promise<RecommendationList>;
  abstract getStatus(): Promise<RecommendationStatus>;
  abstract recordEvents(
    userId: number,
    events: InteractionEventInput[],
  ): Promise<number>;
}
