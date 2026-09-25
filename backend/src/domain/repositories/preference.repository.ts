import type { MediaType } from '../entities/catalog.js';
import type {
  Preference,
  PreferenceValue,
} from '../entities/preference.js';

export abstract class PreferenceRepository {
  abstract listByUser(userId: number): Promise<Preference[]>;
  abstract upsert(
    userId: number,
    itemType: MediaType,
    itemId: number,
    preference: PreferenceValue,
  ): Promise<Preference>;
  abstract remove(
    userId: number,
    itemType: MediaType,
    itemId: number,
  ): Promise<void>;
}
