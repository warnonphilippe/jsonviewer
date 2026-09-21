import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppIcon } from '../ui/icon';
import { LoadError } from '../core/load-json';

/**
 * A refused file, with the caret frame from our own scanner.
 *
 * The frame is the useful part -- V8's own SyntaxError message carries no
 * position in the most common case -- so it gets the room, and the panel is
 * sized to fit one rather than centred as an afterthought.
 */
@Component({
  selector: 'app-error-panel',
  imports: [AppIcon],
  templateUrl: './error-panel.html',
  styleUrl: './error-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppErrorPanel {
  readonly error = input.required<LoadError>();
  readonly dismissed = output<void>();
}
