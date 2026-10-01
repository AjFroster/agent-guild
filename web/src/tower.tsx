import { useMemo, useState } from 'react';

import { type Api, ApiError, type PortalInfo, type PortalStatus } from './api.ts';
import { ago } from './panels.tsx';
import {
  type TowerPick,
  describeTower,
  drawTowerScene,
  portalLook,
  portalUrl,
  samePick,
  towerModel,
  towerPick,
} from './towerScene.ts';
import { BuildingPage } from './BuildingPage.tsx';

/**
 * The Tower page, reached by clicking the Tower on the map (docs/TOWER.md). On top, the
 * Tower's grounds as a Tiny Swords scene (towerScene.ts), with the Portal Keeper's plaza: a
 * portal for every service listening on a local port; clicking one opens it. Below, the
 * portals as a list to open, rename, pin or hide, and the wizards to come.
 */

const LOOK_LABEL = {
  purple: "A Knight's service",
  green: 'Website',
  blue: 'Not checked',
  closed: 'Not a website',
} as const;

const WIZARDS = [
  { name: 'Seer', about: "Researches a Knight's question on the web and in docs; answers with sources." },
  { name: 'Archmage', about: 'Counsel for a stuck Knight, on a stronger model. Advice only, never edits.' },
  {
    name: 'Enchanter',
    about: "Casts identify: a fresh-eyes review of a Knight's changes before it calls them done.",
  },
  { name: 'Lookout', about: 'Watches CI, pull requests and advisories on a schedule, and rings the bell.' },
];

export interface TowerControl {
  api: Api;
  /** The portals, kept current by the server's announcements. */
  portals: PortalStatus | null;
}

export function TowerPage({
  now,
  animate,
  control,
  onBack,
}: {
  now: number;
  animate: boolean;
  control?: TowerControl | undefined;
  onBack: () => void;
}) {
  // Changes made here show at once; the server's next announcement agrees with them.
  const [local, setLocal] = useState<PortalStatus | null>(null);
  const status = local && control?.portals && local !== control.portals ? local : (control?.portals ?? local);
  const model = useMemo(() => towerModel(status?.portals ?? null), [status]);

  const onPick = (p: TowerPick) => {
    if (p.kind === 'portal' && p.url) window.open(p.url, '_blank', 'noopener');
    else
      document
        .getElementById(p.kind === 'portal' ? `portal-${p.port}` : 'tower-portals')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <BuildingPage
      id="tower"
      title="The Tower"
      ribbon="blue"
      onBack={onBack}
      scene={{
        model,
        animate,
        draw: drawTowerScene,
        pick: towerPick,
        same: samePick,
        onPick,
        label: describeTower(model),
      }}
      hint={
        <>
          Click a portal to open that service in a new tab. Purple: it runs in a Knight&apos;s folder. Green:
          a website. A stone arch: listening, but not a website.
        </>
      }
    >
      {control ? (
        <Portals api={control.api} status={status} now={now} onChange={setLocal} />
      ) : (
        <p className="muted small">The Portal Keeper looks for services when the guild runs live.</p>
      )}
      <ul className="plain library-desks" aria-label="Wizards">
        {WIZARDS.map((w) => (
          <li
            key={w.name}
            className="ts-card library-desk"
            data-testid={`desk-${w.name}`}
            data-state="unhired"
          >
            <h3 className="ts-ribbon ts-ribbon-blue">{w.name}</h3>
            <p>
              <span className="desk-state">Coming soon</span>
            </p>
            <p className="muted small">{w.about}</p>
          </li>
        ))}
      </ul>
    </BuildingPage>
  );
}

function Portals({
  api,
  status,
  now,
  onChange,
}: {
  api: Api;
  status: PortalStatus | null;
  now: number;
  onChange: (s: PortalStatus) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!status) return <p className="muted">Looking for services on local ports…</p>;
  const act = (call: () => Promise<PortalStatus>) =>
    void call().then(
      (s) => {
        setError(null);
        onChange(s);
      },
      (err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not save that.'),
    );
  return (
    <div className="ts-card" id="tower-portals" data-testid="tower-portals">
      <h3 className="ts-ribbon ts-ribbon-blue">Portals ({status.portals.length})</h3>
      <p className="muted small">
        Every service your own programs are listening on, found on this machine. The guild only looks; nothing
        leaves 127.0.0.1.
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {status.portals.length === 0 ? (
        <p className="muted small" data-testid="no-portals">
          No services on local ports right now.
        </p>
      ) : (
        <div className="skills-table-wrap">
          <table className="skills-table portals-table">
            <thead>
              <tr>
                <th>Portal</th>
                <th>Port</th>
                <th>Runs in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {status.portals.map((p) => (
                <PortalRow key={p.port} p={p} now={now} act={act} api={api} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {status.hidden.length > 0 && (
        <p className="small">
          Hidden:{' '}
          {status.hidden.map((port) => (
            <button
              key={port}
              type="button"
              className="link"
              onClick={() => act(() => api.updatePortal(port, { hidden: false }))}
              data-testid={`unhide-portal-${port}`}
            >
              :{port}
            </button>
          ))}
        </p>
      )}
      <label className="small">
        <input
          type="checkbox"
          checked={status.probe}
          onChange={(e) => act(() => api.portalSettings({ probe: e.target.checked }))}
          data-testid="portal-probe"
        />{' '}
        Check each new port once to see whether it is a website (one request to 127.0.0.1)
      </label>
    </div>
  );
}

function PortalRow({
  p,
  now,
  act,
  api,
}: {
  p: PortalInfo;
  now: number;
  act: (call: () => Promise<PortalStatus>) => void;
  api: Api;
}) {
  const look = portalLook(p);
  return (
    <tr id={`portal-${p.port}`} data-testid={`portal-${p.port}`} data-look={look}>
      <td>
        <span className={`portal-dot look-${look}`} aria-hidden="true" />{' '}
        <input
          className="portal-name"
          defaultValue={p.name ?? ''}
          placeholder={p.title ?? p.command}
          aria-label={`Name for port ${p.port}`}
          onBlur={(e) => {
            if (e.target.value !== (p.name ?? ''))
              act(() => api.updatePortal(p.port, { name: e.target.value }));
          }}
          data-testid={`rename-portal-${p.port}`}
        />
        <div className="muted small">
          {LOOK_LABEL[look]}
          {p.title && p.name ? ` · ${p.title}` : ''} · {p.command} · up{' '}
          {ago(now - p.since).replace(' ago', '')}
        </div>
      </td>
      <td className="stars">:{p.port}</td>
      <td className="small">{p.knight ? <strong>{p.knight.name}</strong> : (p.folder ?? '—')}</td>
      <td className="portal-actions">
        {look !== 'closed' && (
          <a
            className="ts-button portal-open"
            href={portalUrl(p.port)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`open-portal-${p.port}`}
          >
            Open
          </a>
        )}
        <button
          type="button"
          className="link"
          onClick={() => act(() => api.updatePortal(p.port, { pinned: !p.pinned }))}
          data-testid={`pin-portal-${p.port}`}
        >
          {p.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => act(() => api.updatePortal(p.port, { hidden: true }))}
          data-testid={`hide-portal-${p.port}`}
        >
          Hide
        </button>
      </td>
    </tr>
  );
}
