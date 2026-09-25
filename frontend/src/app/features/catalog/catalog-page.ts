import {
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import type {
  Category,
  MediaDetails,
  MediaSummary,
  MediaType,
  Page,
  PreferenceValue,
} from '../../core/models/catalog.model';
import { AppStateService } from '../../core/services/app-state.service';
import { CatalogApiService } from '../../core/services/catalog-api.service';
import { RecommendationsApiService } from '../../core/services/recommendations-api.service';
import { MediaCard } from '../../shared/media-card/media-card';
import { MediaDetailsComponent } from '../../shared/media-details/media-details';
import { CatalogNavigation } from '../../shared/catalog-navigation/catalog-navigation';

@Component({
  selector: 'app-catalog-page',
  imports: [CatalogNavigation, MediaCard, MediaDetailsComponent],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.css',
})
export class CatalogPage implements OnInit {
  private readonly api = inject(CatalogApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly recommendationsApi = inject(RecommendationsApiService);
  protected readonly state = inject(AppStateService);
  private readonly detailsDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('detailsDialog');
  private requestSequence = 0;

  protected readonly activeType = signal<MediaType>('MOVIE');
  protected readonly query = signal('');
  protected readonly selectedCategory = signal<number | null>(null);
  protected readonly pageNumber = signal(1);
  protected readonly page = signal<Page<MediaSummary> | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly loading = signal(true);
  protected readonly catalogError = signal<string | null>(null);
  protected readonly details = signal<MediaDetails | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly skeletons = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  protected readonly sectionTitle = computed(() =>
    this.activeType() === 'MOVIE' ? 'Filmes em destaque' : 'Livros para explorar',
  );
  protected readonly resultLabel = computed(() => {
    const total = this.page()?.total ?? 0;
    const noun = this.activeType() === 'MOVIE' ? 'filmes' : 'livros';
    return `${total.toLocaleString('pt-BR')} ${noun}`;
  });

  ngOnInit(): void {
    const mediaType: unknown = this.route.snapshot.data['mediaType'];
    this.activeType.set(mediaType === 'BOOK' ? 'BOOK' : 'MOVIE');
    void this.loadCategories();
    void this.loadCatalog();
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected updateCategory(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedCategory.set(Number.isInteger(value) && value > 0 ? value : null);
    this.pageNumber.set(1);
    void this.loadCatalog();
  }

  protected search(): void {
    this.pageNumber.set(1);
    void this.loadCatalog();
  }

  protected clearFilters(): void {
    this.query.set('');
    this.selectedCategory.set(null);
    this.pageNumber.set(1);
    void this.loadCatalog();
  }

  protected goToPage(page: number): void {
    const totalPages = this.page()?.totalPages ?? 1;
    if (page < 1 || page > totalPages || page === this.pageNumber()) return;
    this.pageNumber.set(page);
    void this.loadCatalog();
    globalThis.scrollTo?.({ top: 300, behavior: 'smooth' });
  }

  protected async openDetails(item: MediaSummary): Promise<void> {
    this.details.set(null);
    this.detailError.set(null);
    this.detailLoading.set(true);
    this.detailsDialog().nativeElement.showModal();
    try {
      const details: MediaDetails =
        item.type === 'MOVIE'
          ? await firstValueFrom(this.api.getMovie(item.id))
          : await firstValueFrom(this.api.getBook(item.id));
      this.details.set(details);
      const userId = this.state.activeUserId();
      if (userId) {
        void firstValueFrom(
          this.recommendationsApi.recordInteractions(userId, [
            {
              eventType: 'OPEN_DETAILS',
              itemType: item.type,
              itemId: item.id,
              context: { source: 'CATALOG' },
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

  protected resetDetails(): void {
    this.details.set(null);
    this.detailError.set(null);
  }

  protected closeDetailsFromBackdrop(event: MouseEvent): void {
    if (event.target === this.detailsDialog().nativeElement) this.closeDetails();
  }

  protected changePreference(
    item: MediaSummary | MediaDetails,
    preference: PreferenceValue,
  ): void {
    void this.state.togglePreference(item.type, item.id, preference);
  }

  private async loadCategories(): Promise<void> {
    try {
      this.categories.set(await firstValueFrom(this.api.listCategories()));
    } catch {
      this.categories.set([]);
    }
  }

  private async loadCatalog(): Promise<void> {
    const requestId = ++this.requestSequence;
    this.loading.set(true);
    this.catalogError.set(null);
    const request = {
      page: this.pageNumber(),
      pageSize: 20,
      query: this.query().trim() || undefined,
      categoryId: this.selectedCategory() ?? undefined,
    };

    try {
      const result = await firstValueFrom(
        this.activeType() === 'MOVIE'
          ? this.api.listMovies(request)
          : this.api.listBooks(request),
      );
      if (requestId === this.requestSequence) this.page.set(result);
    } catch {
      if (requestId === this.requestSequence) {
        this.catalogError.set(
          'Não foi possível carregar o catálogo. Verifique se a API está ativa.',
        );
      }
    } finally {
      if (requestId === this.requestSequence) this.loading.set(false);
    }
  }
}
