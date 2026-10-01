import { useRef } from 'react';

import type { Settings } from './settings.ts';
import type { Toast } from './useNotices.ts';

/** Page furniture around the map: toasts, the settings dialog, the first-run hint. */

export function Toasts({
  toasts,
  onOpen,
  onDismiss,
}: {
  toasts: Toast[];
  /** Open what a toast is about: its hero, a building's page, or the inbox for a decision. */
  onOpen: (t: Toast) => void;
  onDismiss: (key: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <ol className="toasts" aria-live="polite" data-testid="toasts">
      {toasts.slice(-5).map((t) => (
        <li key={t.key} className={`toast toast-${t.kind}`}>
          <button
            type="button"
            className="toast-body"
            onClick={() => {
              onOpen(t);
              onDismiss(t.key);
            }}
          >
            {t.text}
          </button>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.key)}>
            ×
          </button>
        </li>
      ))}
    </ol>
  );
}

export function SettingsButton({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  const toggleDesktop = async (on: boolean) => {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Older browsers: the toggle still records the wish.
      }
    }
    onChange({ desktop: on });
  };

  const denied = 'Notification' in window && Notification.permission === 'denied';

  return (
    <>
      <button
        type="button"
        className="chip"
        onClick={() => dialog.current?.showModal()}
        data-testid="open-settings"
      >
        Settings
      </button>
      <dialog ref={dialog} className="settings" aria-labelledby="settings-title" data-testid="settings">
        <h2 id="settings-title">Settings</h2>
        <p className="muted small">Saved in this browser only.</p>
        <label>
          <input
            type="checkbox"
            checked={settings.sound}
            onChange={(e) => onChange({ sound: e.target.checked })}
          />
          Play a sound with notices
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.finished}
            onChange={(e) => onChange({ finished: e.target.checked })}
          />
          Tell me when a session finishes a turn
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.comings}
            onChange={(e) => onChange({ comings: e.target.checked })}
          />
          Tell me when a session joins or leaves
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.desktop}
            disabled={denied}
            onChange={(e) => void toggleDesktop(e.target.checked)}
          />
          Desktop notifications while this tab is in the background
        </label>
        {denied && (
          <p className="muted small">
            This browser has blocked notifications for the guild; allow them in its site settings.
          </p>
        )}
        <p className="muted small">
          &ldquo;Needs you&rdquo; notices always show; they are the reason the guild exists.
        </p>
        <form method="dialog">
          <button type="submit" className="back">
            Done
          </button>
        </form>
      </dialog>
    </>
  );
}

export function Hint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <p className="hint-bar" data-testid="hint">
      Click a hero to see their session, or a building to see who works there. <kbd>Esc</kbd> goes back.
      <button type="button" className="link" onClick={onDismiss}>
        Got it
      </button>
    </p>
  );
}
