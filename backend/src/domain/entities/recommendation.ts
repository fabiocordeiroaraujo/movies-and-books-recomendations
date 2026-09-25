import type { MediaSummary, MediaType } from './catalog.js';
import type { PreferenceValue } from './preference.js';

export type RecommendationTrack = 'MOVIE' | 'BOOK' | 'CROSS_MEDIA';

export interface RecommendationReason {
  code:
    | 'SIMILAR_TO_LIKED'
    | 'SIMILAR_USERS_LIKED'
    | 'SHARED_THEME'
    | 'SHARED_CATEGORY'
    | 'SHARED_ENTITY'
    | 'CROSS_MEDIA_DISCOVERY'
    | 'PREFERRED_LANGUAGE'
    | 'QUALITY_FALLBACK';
  label: string;
}

export interface RecommendedItem extends MediaSummary {
  score: number;
  reasons: RecommendationReason[];
}

export interface RecommendationList {
  items: RecommendedItem[];
  generatedAt: string;
  strategy:
    | 'NEURAL_TWO_TOWER'
    | 'CONTENT_HYBRID'
    | 'NEIGHBOR_FALLBACK'
    | 'ONLY_DISLIKES_FALLBACK'
    | 'POPULARITY_FALLBACK';
  modelVersion: string | null;
  stale: boolean;
}

export interface EnrichedPreference extends MediaSummary {
  preference: PreferenceValue;
  updatedAt: string;
}

export interface TasteSummary {
  likeCount: number;
  dislikeCount: number;
  categories: Array<{ id: number; name: string; count: number }>;
  themes: Array<{ name: string; count: number }>;
  languages: Array<{ code: string; count: number }>;
  media: { BOOK: number; MOVIE: number };
  coldStart: boolean;
}

export interface PreferenceSummaryData {
  taste: TasteSummary;
  preferences: EnrichedPreference[];
}

export interface RecommendationStatus {
  available: boolean;
  modelVersion: string | null;
  modelName: string | null;
  generatedAt: string | null;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  neuralModelActive: boolean;
}

export interface RecommendationQuery {
  type: RecommendationTrack;
  limit: number;
}

export interface SimilarItemsQuery {
  itemType: MediaType;
  itemId: number;
  targetType?: MediaType;
  limit: number;
}

export interface InteractionEventInput {
  eventType: 'IMPRESSION' | 'OPEN_DETAILS';
  itemType: MediaType;
  itemId: number;
  modelVersion?: string;
  context?: Record<string, unknown>;
}
