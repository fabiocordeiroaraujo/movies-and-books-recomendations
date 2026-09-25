import type { MediaType } from './catalog.js';

export type PreferenceValue = 'LIKE' | 'DISLIKE';

export interface Preference {
  itemType: MediaType;
  itemId: number;
  preference: PreferenceValue;
  updatedAt: string;
}
