import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { AppStateService } from '../../core/services/app-state.service';
import { CatalogApiService } from '../../core/services/catalog-api.service';
import { RecommendationsApiService } from '../../core/services/recommendations-api.service';
import { MyPreferencesPage } from './my-preferences-page';

describe('MyPreferencesPage', () => {
  it('shows the onboarding state when no user exists', async () => {
    const state = {
      users: signal([]).asReadonly(),
      loadingUsers: signal(false).asReadonly(),
      activeUserId: signal<number | null>(null).asReadonly(),
      activeUser: signal(null).asReadonly(),
      preferenceFor: () => null,
      isPreferencePending: () => false,
      togglePreference: () => Promise.resolve(),
      reportError: () => undefined,
    };
    await TestBed.configureTestingModule({
      imports: [MyPreferencesPage],
      providers: [
        provideRouter([]),
        { provide: AppStateService, useValue: state },
        { provide: CatalogApiService, useValue: {} },
        { provide: RecommendationsApiService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(MyPreferencesPage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Crie seu primeiro perfil',
    );

    const accessibility = await axe.run(fixture.nativeElement as HTMLElement, {
      rules: {
        // JSDOM has no canvas implementation, so visual contrast is checked in-browser.
        'color-contrast': { enabled: false },
      },
    });
    expect(accessibility.violations).toEqual([]);
  });
});
