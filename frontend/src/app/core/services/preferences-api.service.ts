import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../config/api.config';
import type {
  MediaType,
  Preference,
  PreferenceValue,
} from '../models/catalog.model';

@Injectable({ providedIn: 'root' })
export class PreferencesApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  list(userId: number) {
    return this.http.get<Preference[]>(
      `${this.baseUrl}/users/${userId}/preferences`,
    );
  }

  set(
    userId: number,
    type: MediaType,
    itemId: number,
    preference: PreferenceValue,
  ) {
    return this.http.put<Preference>(this.preferenceUrl(userId, type, itemId), {
      preference,
    });
  }

  remove(userId: number, type: MediaType, itemId: number) {
    return this.http.delete<void>(this.preferenceUrl(userId, type, itemId));
  }

  private preferenceUrl(
    userId: number,
    type: MediaType,
    itemId: number,
  ): string {
    const collection = type === 'MOVIE' ? 'movies' : 'books';
    return `${this.baseUrl}/users/${userId}/${collection}/${itemId}/preference`;
  }
}
