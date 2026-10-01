import type { GuildState } from '@agent-guild/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type Notice, type NoticeKind, diffNotices } from './notices.ts';
import type { Settings } from './settings.ts';

export interface Toast extends Notice {
  /** When it goes away on its own, in ms since page load; null = stays until dismissed. */
  expiresAt: number | null;
}

const LIFETIME: Record<NoticeKind, number | null> = {
  needs_you: null,
  finished: 8_000,
  arrived: 6_000,
  left: 6_000,
};

/** Turns guild changes into toasts, a chime and (in the background) a desktop notice. */
export function useNotices(state: GuildState, enabled: boolean, settings: Settings) {
  const prev = useRef<GuildState | null>(null);
  const seen = useRef(new Set<string>());
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!enabled) {
      // Not connected (or demo mode): forget the baseline, so the next snapshot is taken
      // as history rather than as a burst of things that just happened.
      prev.current = null;
      return;
    }
    const notices = diffNotices(prev.current, state).filter((n) => {
      if (seen.current.has(n.key)) return false;
      if (n.kind === 'finished' && !settings.finished) return false;
      if ((n.kind === 'arrived' || n.kind === 'left') && !settings.comings) return false;
      return true;
    });
    prev.current = state;
    if (notices.length === 0) return;

    const now = performance.now();
    for (const n of notices) seen.current.add(n.key);
    setToasts((t) => [
      ...t.filter((x) => x.expiresAt === null || x.expiresAt > now),
      ...notices.map((n) => ({
        ...n,
        expiresAt: LIFETIME[n.kind] === null ? null : now + LIFETIME[n.kind]!,
      })),
    ]);

    const loudest = notices.some((n) => n.kind === 'needs_you') ? 'needs_you' : notices[0]!.kind;
    if (settings.sound) chime(loudest);
    if (settings.desktop && document.hidden) desktop(notices);
  }, [state, enabled, settings]);

  // Expire timed toasts.
  useEffect(() => {
    const timed = toasts.filter((t) => t.expiresAt !== null);
    if (timed.length === 0) return;
    const next = Math.min(...timed.map((t) => t.expiresAt!)) - performance.now();
    const id = setTimeout(
      () => setToasts((t) => t.filter((x) => x.expiresAt === null || x.expiresAt > performance.now())),
      Math.max(0, next) + 20,
    );
    return () => clearTimeout(id);
  }, [toasts]);

  const dismiss = useCallback((key: string) => setToasts((t) => t.filter((x) => x.key !== key)), []);
  return { toasts, dismiss };
}

let audio: AudioContext | null = null;

/** A short synthesized chime: no audio files to ship or license. */
function chime(kind: NoticeKind): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const notes = kind === 'needs_you' ? [660, 880] : kind === 'finished' ? [523] : [440];
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const start = audio!.currentTime + i * 0.14;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(audio!.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    // No audio device, or the browser has not allowed sound yet.
  }
}

function desktop(notices: Notice[]): void {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (const n of notices) new Notification('Agent Guild', { body: n.text, tag: n.key });
  } catch {
    // Notifications unsupported here.
  }
}
