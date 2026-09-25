import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../config/api.config';
import type {
  PreferenceSummary,
  RecommendationList,
  RecommendationStatus,
  RecommendationTrack,
} from '../models/recommendation.model';
import type { MediaType } from '../models/catalog.model';

export interface InteractionEventRequest {
  eventType: 'IMPRESSION' | 'OPEN_DETAILS';
  itemType: MediaType;
  itemId: number;
  modelVersion?: string;
  context?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class RecommendationsApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(userId: number, type: RecommendationTrack, limit = 20) {
    return this.http.get<RecommendationList>(`${this.baseUrl}/users/${userId}/recommendations`, {
      params: new HttpParams().set('type', type).set('limit', limit),
    });
  }

  preferenceSummary(userId: number) {
    return this.http.get<PreferenceSummary>(`${this.baseUrl}/users/${userId}/preference-summary`);
  }

  status() {
    return this.http.get<RecommendationStatus>(`${this.baseUrl}/recommendation/status`);
  }

  recordInteractions(userId: number, events: InteractionEventRequest[]) {
    return this.http.post<{ accepted: number }>(`${this.baseUrl}/users/${userId}/interactions`, {
      events,
    });
  }
}
