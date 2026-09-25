import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  MediaDetails,
  MediaSummary,
  MediaType,
  PreferenceValue,
} from '../../core/models/catalog.model';
import type {
  PreferenceSummary,
  RecommendationList,
  RecommendationTrack,
} from '../../core/models/recommendation.model';
import { AppStateService } from '../../core/services/app-state.service';
import { CatalogApiService } from '../../core/services/catalog-api.service';
import { RecommendationsApiService } from '../../core/services/recommendations-api.service';
import { MediaCard } from '../../shared/media-card/media-card';
import { MediaDetailsComponent } from '../../shared/media-details/media-details';
import { RecommendationReasonComponent } from '../../shared/recommendation-reason/recommendation-reason';
import { CatalogNavigation } from '../../shared/catalog-navigation/catalog-navigation';

type PreferenceTab = 'LIKE' | 'DISLIKE';
type MediaFilter = 'ALL' | MediaType;
type DisplayedRecommendationTrack = Exclude<RecommendationTrack, 'CROSS_MEDIA'>;

@Component({
  selector: 'app-my-preferences-page',
  imports: [
    CatalogNavigation,
    DatePipe,
    MediaCard,
    MediaDetailsComponent,
    RecommendationReasonComponent,
  ],
  templateUrl: './my-preferences-page.html',
  styleUrl: './my-preferences-page.css',
})
export class MyPreferencesPage {
  private readonly recommendationsApi = inject(RecommendationsApiService);
  private readonly catalogApi = inject(CatalogApiService);
  protected readonly state = inject(AppStateService);
  private readonly detailsDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('detailsDialog');
  private requestSequence = 0;

  protected readonly tracks: readonly DisplayedRecommendationTrack[] = ['MOVIE', 'BOOK'];
  protected readonly summary = signal<PreferenceSummary | null>(null);
  protected readonly recommendations = signal<
    Partial<Record<RecommendationTrack, RecommendationList>>
  >({});
  protected readonly railErrors = signal<Partial<Record<RecommendationTrack, string>>>({});
  protected readonly loading = signal(false);
  protected readonly summaryError = signal<string | null>(null);
  protected readonly preferenceTab = signal<PreferenceTab>('LIKE');
  protected readonly mediaFilter = signal<MediaFilter>('ALL');
  protected readonly details = signal<MediaDetails | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);

  protected readonly visiblePreferences = computed(() => {
    const tab = this.preferenceTab();
    const media = this.mediaFilter();
    return (this.summary()?.preferences ?? []).filter(
      (item) => item.preference === tab && (media === 'ALL' || item.type === media),
    );
  });

  constructor() {
    effect(() => {
      const userId = this.state.activeUserId();
      untracked(() => void this.load(userId));
    });
  }

  protected rail(type: RecommendationTrack): RecommendationList | undefined {
    return this.recommendations()[type];
  }

  protected railTitle(type: DisplayedRecommendationTrack): string {
    return type === 'MOVIE' ? 'Filmes para você' : 'Livros para você';
  }

  protected strategyLabel(strategy: RecommendationList['strategy']): string {
    const labels: Record<RecommendationList['strategy'], string> = {
      NEURAL_TWO_TOWER: 'Ranking neural',
      CONTENT_HYBRID: 'Seu perfil de gosto',
      NEIGHBOR_FALLBACK: 'Parecidos com o que você gostou',
      ONLY_DISLIKES_FALLBACK: 'Populares, evitando rejeições',
      POPULARITY_FALLBACK: 'Populares e bem avaliados',
    };
    return labels[strategy];
  }

  protected async changePreference(item: MediaSummary, preference: PreferenceValue): Promise<void> {
    await this.state.togglePreference(item.type, item.id, preference);
    await this.load(this.state.activeUserId());
  }

  protected async openDetails(item: MediaSummary): Promise<void> {
    this.details.set(null);
    this.detailError.set(null);
    this.detailLoading.set(true);
    this.detailsDialog().nativeElement.showModal();
    try {
      const details: MediaDetails =
        item.type === 'MOVIE'
          ? await firstValueFrom(this.catalogApi.getMovie(item.id))
          : await firstValueFrom(this.catalogApi.getBook(item.id));
      this.details.set(details);
      const userId = this.state.activeUserId();
      if (userId) {
        void firstValueFrom(
          this.recommendationsApi.recordInteractions(userId, [
            {
              eventType: 'OPEN_DETAILS',
              itemType: item.type,
              itemId: item.id,
              context: { source: 'MY_PREFERENCES' },
            },
          ]),
        ).catch(() => undefined);
      }
    } catch {
      this.detailError.set('Não foi possível carregar os detalhes deste item.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected closeDetails(): void {
    this.detailsDialog().nativeElement.close();
  }

  protected closeDetailsFromBackdrop(event: MouseEvent): void {
    if (event.target === this.detailsDialog().nativeElement) this.closeDetails();
  }

  protected resetDetails(): void {
    this.details.set(null);
    this.detailError.set(null);
  }

  protected retry(): void {
    void this.load(this.state.activeUserId());
  }

  protected updateMediaFilter(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'ALL' || value === 'MOVIE' || value === 'BOOK') {
      this.mediaFilter.set(value);
    }
  }

  protected scrollRecommendations(viewport: HTMLElement, direction: -1 | 1): void {
    const card = viewport.querySelector<HTMLElement>('.recommendation-card');
    const cardWidth = card?.getBoundingClientRect().width ?? viewport.clientWidth * 0.8;
    const styles = getComputedStyle(viewport);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 16;
    const visibleCards = Math.max(1, Math.floor(viewport.clientWidth / (cardWidth + gap)));
    viewport.scrollBy({
      left: direction * visibleCards * (cardWidth + gap),
      behavior: 'smooth',
    });
  }

  private async load(userId: number | null): Promise<void> {
    const sequence = ++this.requestSequence;
    this.summary.set(null);
    this.recommendations.set({});
    this.railErrors.set({});
    this.summaryError.set(null);
    if (!userId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    const [summaryResult, ...railResults] = await Promise.allSettled([
      firstValueFrom(this.recommendationsApi.preferenceSummary(userId)),
      ...this.tracks.map((track) =>
        firstValueFrom(this.recommendationsApi.list(userId, track, 12)),
      ),
    ]);
    if (sequence !== this.requestSequence || this.state.activeUserId() !== userId) {
      return;
    }
    if (summaryResult.status === 'fulfilled') {
      this.summary.set(summaryResult.value);
    } else {
      this.summaryError.set('Não foi possível carregar o resumo deste perfil.');
    }
    const loaded: Partial<Record<RecommendationTrack, RecommendationList>> = {};
    const errors: Partial<Record<RecommendationTrack, string>> = {};
    railResults.forEach((result, index) => {
      const track = this.tracks[index];
      if (result.status === 'fulfilled') loaded[track] = result.value;
      else errors[track] = 'Este trilho não pôde ser carregado.';
    });
    this.recommendations.set(loaded);
    this.railErrors.set(errors);
    this.loading.set(false);
    const impressions = this.tracks.flatMap((track) => {
      const result = loaded[track];
      return (result?.items ?? []).map((item) => ({
        eventType: 'IMPRESSION' as const,
        itemType: item.type,
        itemId: item.id,
        modelVersion: result?.modelVersion ?? undefined,
        context: { track, strategy: result?.strategy },
      }));
    });
    if (impressions.length > 0) {
      void firstValueFrom(this.recommendationsApi.recordInteractions(userId, impressions)).catch(
        () => undefined,
      );
    }
  }
}
