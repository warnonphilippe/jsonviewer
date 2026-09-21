import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AppIcon } from '../ui/icon';

/** The landing screen: what this opens, and the promise that it only reads. */
@Component({
  selector: 'app-empty-state',
  imports: [AppIcon],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppEmptyState {}
