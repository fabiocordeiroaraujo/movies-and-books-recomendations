import { Component, inject, OnInit, viewChild } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AppStateService } from './core/services/app-state.service';
import { UserFormComponent } from './features/user-form/user-form';
import { UserSelector } from './shared/user-selector/user-selector';

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    UserSelector,
    UserFormComponent,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly state = inject(AppStateService);
  private readonly userForm = viewChild.required(UserFormComponent);

  ngOnInit(): void {
    void this.state.initialize();
  }

  protected selectUser(id: number): void {
    void this.state.selectUser(id);
  }

  protected openUserForm(): void {
    this.userForm().open();
  }
}
