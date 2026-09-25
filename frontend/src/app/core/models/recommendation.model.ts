import type { MediaSummary, PreferenceValue } from './catalog.model';
import type { User } from './user.model';

export type RecommendationTrack = 'MOVIE' | 'BOOK' | 'CROSS_MEDIA';

export interface RecommendationReason {
  code: string;
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

export interface PreferenceSummary {
  user: User;
  taste: {
    likeCount: number;
    dislikeCount: number;
    categories: Array<{ id: number; name: string; count: number }>;
    themes: Array<{ name: string; count: number }>;
    languages: Array<{ code: string; count: number }>;
    media: { BOOK: number; MOVIE: number };
    coldStart: boolean;
  };
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
