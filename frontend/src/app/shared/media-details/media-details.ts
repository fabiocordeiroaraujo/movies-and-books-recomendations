import { Component, computed, input, output, signal } from '@angular/core';
import type {
  BookDetails,
  MediaDetails,
  MovieDetails,
  PreferenceValue,
} from '../../core/models/catalog.model';
import { PreferenceButtons } from '../preference-buttons/preference-buttons';

@Component({
  selector: 'app-media-details',
  imports: [PreferenceButtons],
  template: `
    @let media = item();
    @let movie = movieDetails();
    @let book = bookDetails();
    <article class="details">
      <div class="visual">
        @if (movie?.backdropImageUrl) {
          <img
            class="backdrop"
            [src]="movie!.backdropImageUrl"
            alt=""
            width="1280"
            height="720"
          />
        }
        <div class="backdrop-shade"></div>
        @if (media.imageUrl && !imageFailed()) {
          <img
            class="poster"
            [src]="media.imageUrl"
            [alt]="'Capa de ' + media.title"
            width="320"
            height="480"
            (error)="imageFailed.set(true)"
          />
        } @else {
          <div class="poster poster-placeholder" aria-hidden="true">Sem imagem</div>
        }
      </div>

      <div class="content">
        <span class="eyebrow">{{ media.type === 'MOVIE' ? 'Filme' : 'Livro' }}</span>
        <h2 id="details-title">{{ media.title }}</h2>

        @if (movie && movie.originalTitle !== media.title) {
          <p class="subtitle">Título original: {{ movie.originalTitle }}</p>
        }
        @if (book?.subtitle) {
          <p class="subtitle">{{ book!.subtitle }}</p>
        }

        <div class="facts" aria-label="Informações principais">
          @if (media.releaseYear) {
            <span>{{ media.releaseYear }}</span>
          }
          @if (media.averageRating !== null) {
            <span class="rating">
              ★ {{ media.averageRating.toFixed(1) }}/{{ media.ratingScale }}
            </span>
          }
          @if (movie) {
            <span>{{ movie.originalLanguage.toUpperCase() }}</span>
          } @else if (book) {
            @if (book.pageCount) {
              <span>{{ book.pageCount }} páginas</span>
            }
          }
        </div>

        @if (media.categories.length > 0) {
          <div class="chips" aria-label="Categorias">
            @for (category of media.categories; track category.id) {
              <span>{{ category.name }}</span>
            }
          </div>
        }

        @if (book && book.authors.length > 0) {
          <p class="authors">
            <strong>{{ book.authors.length > 1 ? 'Autores' : 'Autor' }}:</strong>
            {{ book.authors.join(', ') }}
          </p>
        }

        <section class="synopsis" aria-labelledby="synopsis-title">
          <h3 id="synopsis-title">Sinopse</h3>
          <p>{{ media.description || 'Sinopse não disponível para este item.' }}</p>
        </section>

        <app-preference-buttons
          [preference]="preference()"
          [disabled]="!hasUser()"
          [pending]="pending()"
          (changed)="preferenceChanged.emit($event)"
        />
        @if (!hasUser()) {
          <p class="profile-hint">Selecione um perfil para registrar sua preferência.</p>
        } @else if (preference()) {
          <p class="profile-hint">Clique novamente na opção selecionada para removê-la.</p>
        }

        <dl class="technical">
          @if (book) {
            <div><dt>ISBN-13</dt><dd>{{ book.isbn13 }}</dd></div>
            <div><dt>ISBN-10</dt><dd>{{ book.isbn10 }}</dd></div>
          } @else if (movie) {
            <div><dt>Lançamento</dt><dd>{{ movie.releaseDate }}</dd></div>
            <div><dt>Popularidade</dt><dd>{{ movie.popularity.toFixed(1) }}</dd></div>
          }
          @if (media.ratingsCount !== null) {
            <div>
              <dt>Avaliações</dt>
              <dd>{{ media.ratingsCount.toLocaleString('pt-BR') }}</dd>
            </div>
          }
        </dl>

        @if (media.keywords.temas.length > 0) {
          <div class="topics">
            <h3>Temas</h3>
            <p>{{ media.keywords.temas.join(' · ') }}</p>
          </div>
        }

        @if (movie) {
          <a class="source-link" [href]="movie.sourceUrl" target="_blank" rel="noopener">
            Ver fonte no TMDB
            <span aria-hidden="true">↗</span>
          </a>
        }
      </div>
    </article>
  `,
  styleUrl: './media-details.css',
})
export class MediaDetailsComponent {
  readonly item = input.required<MediaDetails>();
  readonly preference = input<PreferenceValue | null>(null);
  readonly hasUser = input(false);
  readonly pending = input(false);
  readonly preferenceChanged = output<PreferenceValue>();
  protected readonly imageFailed = signal(false);
  protected readonly movieDetails = computed<MovieDetails | null>(() => {
    const media = this.item();
    return media.type === 'MOVIE' ? media : null;
  });
  protected readonly bookDetails = computed<BookDetails | null>(() => {
    const media = this.item();
    return media.type === 'BOOK' ? media : null;
  });
}
