import { type GuildEvent, type GuildState, replay, roster } from '@agent-guild/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { fixtures, readDemoRequest } from './demo.ts';
import { type Api, type ChatInfo, api } from './api.ts';
import { ChatDrawer, CrierCard, CrownDialog, NewChatDialog, ReportDrawer } from './chat.tsx';
import { type LiveStatus, useLiveEvents } from './live.ts';
import { Hint, SettingsButton, Toasts } from './chrome.tsx';
import { BuildingPanel, GuildPanel, HeroPanel } from './panels.tsx';
import { LibraryPage } from './library.tsx';
import { resolveSelection, useDrawer, usePage, usePanelTab, useSelection } from './selection.ts';
import { SkillsPanel } from './skills.tsx';
import { browserStore, takeToken } from './token.ts';
import { useHint, useSettings } from './settings.ts';
import { useNotices } from './useNotices.ts';
import { VillageCanvas } from './VillageCanvas.tsx';
import type { Selection } from './village.ts';

export function App() {
  const demo = useMemo(() => readDemoRequest(window.location.search), []);
  const token = useMemo(() => {
    if (demo !== null) return null;
    const { token, cleanHref } = takeToken(window.location.href, browserStore);
    if (cleanHref !== null) window.history.replaceState(null, '', cleanHref);
    return token;
  }, [demo]);

  if (demo === null) return token ? <Live token={token} /> : <Landing />;
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
  /** The server offers "skip all permission checks". */
  allowBypass: boolean;
  /** The King's session, once crowned. */
  kingId: string | null;
  /** Reviewed skills waiting on the user, and a counter that ticks when the Archive changes. */
  skills: { waiting: number; version: number };
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
  useEffect(() => {
    // A rejected token is no use next time either; the newest link replaces it.
    if (status === 'unauthorized') browserStore.clear();
  }, [status]);
  if (status === 'unauthorized') {
    return (
      <main className="page">
        <h1>Agent Guild</h1>
        <p role="alert">
          The server did not accept this link's token. Open the link the guild printed when it started (
          <code>scripts/autostart-wsl.sh link</code> prints it again). If you deleted{' '}
          <code>~/.agent-guild/token</code>, the guild made a new one on its next start.
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
          ? {
              api: client,
              chats: announcements.chats,
              crierVersion: announcements.crierVersion,
              allowBypass: announcements.control.allowBypass === true,
              kingId: announcements.king?.id ?? null,
              skills: announcements.skills,
            }
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
  const [rawSelection, selectRaw] = useSelection();
  const [tab, openTab] = usePanelTab();
  const [page, openPage] = usePage();
  // Picking something on the map shows it, so it brings the Guild tab back. The Library
  // has a page of its own, where the librarians are.
  const select = useCallback(
    (s: Selection | null) => {
      if (s?.kind === 'building' && s.id === 'library') {
        openPage('library');
        return;
      }
      if (s) {
        openTab('guild');
        openPage('village');
      }
      selectRaw(s);
    },
    [openTab, openPage, selectRaw],
  );
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
              className="send king-button"
              onClick={() =>
                openDrawer(control.kingId ? { kind: 'chat', id: control.kingId } : { kind: 'king' })
              }
              data-testid="talk-to-king"
            >
              ♛ Talk to the King
            </button>
          )}
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
      {page === 'library' ? (
        <LibraryPage
          state={state}
          now={now}
          animate={live !== undefined}
          onBack={() => openPage('village')}
          onSelectHero={(id) => select({ kind: 'hero', id })}
          control={
            control && {
              api: control.api,
              version: control.skills.version,
              onTalk: (id) => openDrawer({ kind: 'chat', id }),
              onOpenSkills: () => {
                openTab('skills');
                openPage('village');
              },
            }
          }
        />
      ) : (
        <>
          <div className="map-col">
            <VillageCanvas
              state={state}
              heroes={heroes}
              animate={live !== undefined}
              selected={selection}
              onSelect={select}
              onTalk={control ? (id) => openDrawer({ kind: 'chat', id }) : undefined}
              canTalk={(h) => h.parentId === null && SESSION_ID.test(h.id)}
              clock={live === undefined ? now : undefined}
              libraryWaiting={control?.skills.waiting}
            />
            {showHint && <Hint onDismiss={dismissHint} />}
          </div>
          <Toasts toasts={toasts} onOpen={select} onDismiss={dismiss} />
          <aside className="panel" aria-label="Guild details">
            {control && (
              <div className="panel-tabs" role="tablist" aria-label="Side panel">
                <button
                  type="button"
                  role="tab"
                  className="panel-tab"
                  aria-selected={tab === 'guild'}
                  onClick={() => openTab('guild')}
                  data-testid="tab-guild"
                >
                  Guild
                </button>
                <button
                  type="button"
                  role="tab"
                  className="panel-tab"
                  aria-selected={tab === 'skills'}
                  onClick={() => openTab('skills')}
                  data-testid="tab-skills"
                >
                  Skills
                  {control.skills.waiting > 0 && (
                    <span className="tab-badge" aria-label={`${control.skills.waiting} to review`}>
                      {control.skills.waiting}
                    </span>
                  )}
                </button>
              </div>
            )}
            {control && tab === 'skills' ? (
              <SkillsPanel api={control.api} version={control.skills.version} now={now} />
            ) : hero ? (
              <HeroPanel
                state={state}
                hero={hero}
                now={now}
                onSelect={select}
                onOpenChat={control && chatId ? () => openDrawer({ kind: 'chat', id: chatId }) : undefined}
              />
            ) : selection?.kind === 'building' ? (
              <BuildingPanel
                state={state}
                location={selection.id}
                now={now}
                onSelect={select}
                onOpenArchive={control && selection.id === 'library' ? () => openTab('skills') : undefined}
              />
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
        </>
      )}
      {control && drawer?.kind === 'chat' && (
        <ChatDrawer key={drawer.id} api={control.api} id={drawer.id} onClose={() => openDrawer(null)} />
      )}
      {control && drawer?.kind === 'report' && (
        <ReportDrawer api={control.api} date={drawer.date} onClose={() => openDrawer(null)} />
      )}
      {control && drawer?.kind === 'king' && (
        <CrownDialog
          api={control.api}
          onCrowned={(id) => openDrawer({ kind: 'chat', id })}
          onCancel={() => openDrawer(null)}
        />
      )}
      {control && drawer?.kind === 'new' && (
        <NewChatDialog
          api={control.api}
          projects={projects}
          allowBypass={control.allowBypass}
          onStarted={(id) => openDrawer({ kind: 'chat', id })}
          onCancel={() => openDrawer(null)}
        />
      )}
    </main>
  );
}
