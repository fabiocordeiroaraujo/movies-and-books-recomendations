import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AppStateService } from './core/services/app-state.service';

const users = signal([]);
const activeUserId = signal<number | null>(null);
const error = signal<string | null>(null);
const fakeState = {
  users: users.asReadonly(),
  activeUserId: activeUserId.asReadonly(),
  activeUser: signal(null).asReadonly(),
  loadingUsers: signal(false).asReadonly(),
  error: error.asReadonly(),
  initialize: () => Promise.resolve(),
  selectUser: () => Promise.resolve(),
  createUser: () => Promise.reject(new Error('not used')),
  clearError: () => error.set(null),
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AppStateService, useValue: fakeState },
      ],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the product brand', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand')?.textContent).toContain('Reel');
    expect(compiled.querySelector('.brand')?.textContent).toContain('Read');
  });

});
