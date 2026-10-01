import { type GuildEvent, type GuildState, replay, roster } from '@agent-guild/core';
import { useEffect, useMemo, useState } from 'react';

import { fixtures, readDemoRequest } from './demo.ts';
import { type Api, type ChatInfo, api } from './api.ts';
import { ChatDrawer, CrierCard, NewChatDialog, ReportDrawer } from './chat.tsx';
import { type LiveStatus, useLiveEvents } from './live.ts';
import { Hint, SettingsButton, Toasts } from './chrome.tsx';
import { BuildingPanel, GuildPanel, HeroPanel } from './panels.tsx';
import { resolveSelection, useDrawer, useSelection } from './selection.ts';
import { useHint, useSettings } from './settings.ts';
import { useNotices } from './useNotices.ts';
import { VillageCanvas } from './VillageCanvas.tsx';

export function App() {
  const demo = useMemo(() => readDemoRequest(window.location.search), []);

  if (demo === null) {
    const token = new URLSearchParams(window.location.search).get('token');
    return token ? <Live token={token} /> : <Landing />;
  }
  if ('error' in demo) {
    return (
      <main className="page">
        <h1>Agent Guild</h1>
        <p role="alert">{demo.error}</p>
        <DemoLinks />
      </main>
    );
  }
  // Demo mode's clock is the frozen moment, so "5 min ago" reads the same on every run.
  return <Guild state={replay(demo.events, demo.t)} now={Math.min(demo.t, lastTime(demo.events))} />;
}

function Landing() {
  return (
    <main className="page">
      <h1>Agent Guild</h1>
      <p>
        To watch your own Claude Code sessions, run <code>npm start</code> in the agent-guild folder and open
        the link it prints. The link carries a token that only your machine knows.
      </p>
      <p className="muted">Or try a recorded guild:</p>
      <DemoLinks />
    </main>
  );
}

function DemoLinks() {
  return (
    <ul className="demo-links">
      {Object.keys(fixtures)
        .sort()
        .map((name) => (
          <li key={name}>
            <a href={`?demo=${name}`}>{name}</a>
          </li>
        ))}
    </ul>
  );
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Control {
  api: Api;
  chats: ChatInfo[];
  crierVersion: number;
}

const lastTime = (events: GuildEvent[]) => events.reduce((m, e) => Math.max(m, e.t), 0);

/** Wall clock in epoch seconds, refreshed every `ms` so relative times stay current. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const LIVE_LABEL: Record<LiveStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  unauthorized: 'Token rejected',
};

function Live({ token }: { token: string }) {
  const { events, status, announcements } = useLiveEvents(token);
  const client = useMemo(() => api(token), [token]);
  const state = useMemo(() => replay(events), [events]);
  const now = useNow(5_000);
  if (status === 'unauthorized') {
    return (
      <main className="page">
        <h1>Agent Guild</h1>
        <p role="alert">
          The server did not accept this link's token. It changes every time <code>npm start</code> runs, so
          open the newest link it printed.
        </p>
      </main>
    );
  }
  return (
    <Guild
      state={state}
      live={LIVE_LABEL[status]}
      connected={status === 'live'}
      now={now}
      control={
        announcements.control?.enabled
          ? { api: client, chats: announcements.chats, crierVersion: announcements.crierVersion }
          : undefined
      }
    />
  );
}

function Guild({
  state,
  live,
  connected = false,
  now,
  control,
}: {
  state: GuildState;
  live?: string;
  /** Live and holding a snapshot: only then are changes news. */
  connected?: boolean;
  now: number;
  /** Chats and the Town Crier, when the server allows them. */
  control?: Control | undefined;
}) {
  const heroes = roster(state);
  const waiting = heroes.filter((h) => h.status === 'needs_you');
  const [rawSelection, select] = useSelection();
  const selection = resolveSelection(state, rawSelection);
  const hero = selection?.kind === 'hero' ? state.heroes[selection.id] : undefined;
  const [settings, updateSettings] = useSettings();
  const [showHint, dismissHint] = useHint();
  // Notices are about things happening now, so only live mode raises them.
  const { toasts, dismiss } = useNotices(state, connected, settings);
  const [drawer, openDrawer] = useDrawer();
  const [projects, setProjects] = useState<string[]>([]);
  useEffect(() => {
    if (drawer?.kind === 'new' && control)
      control.api.control().then(
        (c) => setProjects(c.projects),
        () => {},
      );
  }, [drawer, control]);
  // Only main sessions have a Claude session id to chat with; sub-agents run inside them.
  const chatId = hero && hero.parentId === null && SESSION_ID.test(hero.id) ? hero.id : null;

  return (
    <main className="guild" data-testid="guild">
      <header className="topbar">
        <h1>Agent Guild</h1>
        {live && (
          <span className="live" data-testid="live-status">
            {live}
          </span>
        )}
        {waiting.length > 0 && (
          <p className="beacon" role="status" data-testid="beacon">
            {waiting.map((h, i) => (
              <span key={h.id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="beacon-link"
                  onClick={() => select({ kind: 'hero', id: h.id })}
                >
                  {h.name}
                </button>
              </span>
            ))}{' '}
            {waiting.length === 1 ? 'needs' : 'need'} you
          </p>
        )}
        <span className="topbar-end">
          {control && (
            <button
              type="button"
              className="send"
              onClick={() => openDrawer({ kind: 'new' })}
              data-testid="new-session"
            >
              New session
            </button>
          )}
          <SettingsButton settings={settings} onChange={updateSettings} />
        </span>
      </header>
      <div className="map-col">
        <VillageCanvas
          state={state}
          heroes={heroes}
          animate={live !== undefined}
          selected={selection}
          onSelect={select}
        />
        {showHint && <Hint onDismiss={dismissHint} />}
      </div>
      <Toasts toasts={toasts} onOpen={select} onDismiss={dismiss} />
      <aside className="panel" aria-label="Guild details">
        {hero ? (
          <HeroPanel
            state={state}
            hero={hero}
            now={now}
            onSelect={select}
            onOpenChat={control && chatId ? () => openDrawer({ kind: 'chat', id: chatId }) : undefined}
          />
        ) : selection?.kind === 'building' ? (
          <BuildingPanel state={state} location={selection.id} now={now} onSelect={select} />
        ) : (
          <GuildPanel state={state} onSelect={select}>
            {control && (
              <CrierCard
                api={control.api}
                version={control.crierVersion}
                onOpenChat={(id) => openDrawer({ kind: 'chat', id })}
                onOpenReport={(date) => openDrawer({ kind: 'report', date })}
              />
            )}
          </GuildPanel>
        )}
      </aside>
      {control && drawer?.kind === 'chat' && (
        <ChatDrawer key={drawer.id} api={control.api} id={drawer.id} onClose={() => openDrawer(null)} />
      )}
      {control && drawer?.kind === 'report' && (
        <ReportDrawer api={control.api} date={drawer.date} onClose={() => openDrawer(null)} />
      )}
      {control && drawer?.kind === 'new' && (
        <NewChatDialog
          api={control.api}
          projects={projects}
          onStarted={(id) => openDrawer({ kind: 'chat', id })}
          onCancel={() => openDrawer(null)}
        />
      )}
    </main>
  );
}
