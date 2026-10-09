import { BANNERS, BATTLE_KINDS, type Banner, type Battle, type BattleKind } from '@agent-guild/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type Api,
  ApiError,
  CHAT_MODES,
  type ChatMode,
  MODE_LABEL,
  type WarInfo,
  type WarStatus,
} from './api.ts';
import { BuildingPage } from './BuildingPage.tsx';
import { Markdown } from './chat.tsx';
import { ago } from './panels.tsx';
import { TEAM_CSS } from './village.ts';
import { type WarPick, describeWars, drawWarScene, samePick, warModel, warPick } from './warScene.ts';

/**
 * The War Room page (docs/WARS.md), reached from the war camp on the Barracks fence. On
 * top, the war table as a Tiny Swords scene (warScene.ts); below, a card per war with its
 * battles: send a Knight into one (in its own worktree), say how an unclear one ended,
 * clear a won one's worktree. Then declaring a war, and the battle reports.
 */

export interface WarControl {
  api: Api;
  /** The War Room's status as the server last announced it. */
  wars: WarStatus | null;
  onTalk: (id: string) => void;
  onSelectHero: (id: string) => void;
}

const STATE_LABEL: Record<Battle['state'], string> = {
  planned: 'Planned',
  fighting: 'Fighting',
  holding: 'Holding',
  stalled: 'Stalled',
  won: 'Won',
  retreated: 'Retreated',
  unclear: 'Outcome unknown',
};

const KIND_LABEL: Record<BattleKind, string> = {
  feature: 'Feature',
  fix: 'Fix',
  refactor: 'Refactor',
  other: 'Other',
};

/** The wars to show: the server's latest, or the answer to the user's own last change. */
function useStatus(control: WarControl | undefined): [WarStatus | null, (s: WarStatus) => void] {
  const announced = control?.wars ?? null;
  // An answer counts only until the next announcement, which is newer than anything we got back.
  const [local, setLocal] = useState<{ after: WarStatus | null; status: WarStatus } | null>(null);
  useEffect(() => {
    if (control && !announced)
      control.api.wars().then(
        (status) => setLocal({ after: null, status }),
        () => {},
      );
  }, [control, announced]);
  const set = useCallback((status: WarStatus) => setLocal({ after: announced, status }), [announced]);
  return [local && local.after === announced ? local.status : announced, set];
}

export function WarsPage({
  now,
  animate,
  control,
  onBack,
}: {
  now: number;
  animate: boolean;
  control?: WarControl | undefined;
  onBack: () => void;
}) {
  const [status, setStatus] = useStatus(control);
  const model = useMemo(() => warModel(status ? status.wars : control ? [] : null), [status, control]);

  const onPick = (p: WarPick) => {
    const id = p.kind === 'war' ? `war-${p.id}` : p.kind === 'reports' ? 'battle-reports' : 'declare-war';
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const active = status?.wars.filter((w) => !w.archived) ?? [];
  const ended = status?.wars.filter((w) => w.archived) ?? [];
  return (
    <BuildingPage
      id="wars"
      title="The War Room"
      ribbon="red"
      onBack={onBack}
      scene={{
        model,
        animate,
        draw: drawWarScene,
        pick: warPick,
        same: samePick,
        onPick,
        label: describeWars(model),
      }}
      hint={
        <>
          Each banner on the table is a war: one of your repositories. The number is its victories (merged
          battles); it waves while a Knight fights, and a red mark means a battle needs you. Click one to jump
          to its battles.
        </>
      }
    >
      {!control ? (
        <p className="muted small">The War Room follows your repositories when the guild runs live.</p>
      ) : !status ? (
        <p className="muted">Reading the wars…</p>
      ) : (
        <>
          {active.length === 0 && (
            <p className="muted" data-testid="no-wars">
              No war declared yet. Declare one on a repository below: each branch of work in it becomes a
              battle.
            </p>
          )}
          <ul className="plain war-cards" aria-label="Wars">
            {active.map((w) => (
              <li key={w.id}>
                <WarCard war={w} now={now} control={control} onStatus={setStatus} />
              </li>
            ))}
          </ul>
          <Declare status={status} api={control.api} onStatus={setStatus} />
          <Reports status={status} api={control.api} onStatus={setStatus} now={now} />
          {ended.length > 0 && (
            <div className="ts-card" data-testid="ended-wars">
              <h3 className="ts-ribbon ts-ribbon-yellow">Ended wars</h3>
              <ul className="plain">
                {ended.map((w) => (
                  <li key={w.id}>
                    <strong>{w.name}</strong> <span className="muted small">({w.folder})</span>{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        void control.api.updateWar(w.id, { archived: false }).then(setStatus, () => {})
                      }
                      data-testid={`resume-war-${w.id}`}
                    >
                      Resume
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </BuildingPage>
  );
}

function useAction(onStatus: (s: WarStatus) => void, api: Api) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const result = await call();
      onStatus(
        result && typeof result === 'object' && 'wars' in result ? (result as WarStatus) : await api.wars(),
      );
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function WarCard({
  war,
  now,
  control,
  onStatus,
}: {
  war: WarInfo;
  now: number;
  control: WarControl;
  onStatus: (s: WarStatus) => void;
}) {
  const { api } = control;
  const { busy, error, run } = useAction(onStatus, api);
  const [sending, setSending] = useState<string | null>(null);
  const open = war.battles.filter((b) => b.state !== 'won' && b.state !== 'retreated');
  const done = war.battles.filter((b) => b.state === 'won' || b.state === 'retreated');
  return (
    <section className="ts-card war-card" id={`war-${war.id}`} data-testid={`war-${war.folder}`}>
      <h3 className="ts-ribbon ts-ribbon-red war-title">
        <span className="war-banner" style={{ background: TEAM_CSS[war.banner] }} aria-hidden="true" />
        {war.name}
      </h3>
      <p className="small">
        <span className="muted">Repository</span> <code>{war.folder}</code>
        {war.defaultBranch && (
          <>
            {' '}
            <span className="muted">merging into</span> <code>{war.defaultBranch}</code>
          </>
        )}
      </p>
      {war.goal && <p className="war-goal">{war.goal}</p>}
      {war.problem && (
        <p className="error small" role="alert">
          {war.problem}
        </p>
      )}
      <p className="small war-facts" data-testid={`war-facts-${war.folder}`}>
        <strong>{war.victories}</strong> {war.victories === 1 ? 'victory' : 'victories'} ·{' '}
        {war.tokens.toLocaleString('en-US')} tokens ·{' '}
        {war.looseEnds.unpushed || war.looseEnds.dirty
          ? `loose ends: ${war.looseEnds.unpushed} unpushed, ${war.looseEnds.dirty} uncommitted`
          : 'no loose ends'}
      </p>
      {!war.gh && !war.problem && (
        <p className="muted small" data-testid="no-gh">
          The guild could not read this repository&apos;s pull requests with <code>gh</code>, so a battle
          counts as won only when git sees it merged, and no worktree is cleared on its own.
        </p>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {open.length === 0 && done.length === 0 ? (
        <p className="muted small">No battles yet. Declare one below, or push a branch.</p>
      ) : (
        <div className="skills-table-wrap">
          <table className="skills-table battles-table">
            <thead>
              <tr>
                <th>Battle</th>
                <th>State</th>
                <th>Knights</th>
                <th>Pull request</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...open, ...done].map((b) => (
                <BattleRow
                  key={b.branch}
                  war={war}
                  b={b}
                  now={now}
                  busy={busy}
                  control={control}
                  run={run}
                  sending={sending === b.branch}
                  onSend={() => setSending(sending === b.branch ? null : b.branch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sending && (
        <SendKnight
          war={war}
          branch={sending}
          busy={busy !== null}
          onSend={(o) =>
            void run(`send:${sending}`, () => api.sendKnight(war.id, { branch: sending, ...o })).then(
              (ok) => ok && setSending(null),
            )
          }
          onCancel={() => setSending(null)}
        />
      )}
      <DeclareBattle
        busy={busy !== null}
        onDeclare={(b) => run('battle', () => api.declareBattle(war.id, b))}
      />
      <details className="small war-settings">
        <summary>Banner, goal, end the war</summary>
        <label>
          Banner{' '}
          <select
            value={war.banner}
            onChange={(e) =>
              void run('banner', () => api.updateWar(war.id, { banner: e.target.value as Banner }))
            }
            data-testid={`war-banner-${war.folder}`}
          >
            {BANNERS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>{' '}
        <label>
          Goal{' '}
          <input
            defaultValue={war.goal}
            maxLength={300}
            onBlur={(e) => {
              if (e.target.value !== war.goal)
                void run('goal', () => api.updateWar(war.id, { goal: e.target.value }));
            }}
            data-testid={`war-goal-${war.folder}`}
          />
        </label>{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            if (window.confirm(`End ${war.name}? Its record stays; the repository is not touched.`))
              void run('end', () => api.updateWar(war.id, { archived: true }));
          }}
          data-testid={`end-war-${war.folder}`}
        >
          End this war
        </button>
      </details>
    </section>
  );
}

function BattleRow({
  war,
  b,
  now,
  busy,
  control,
  run,
  sending,
  onSend,
}: {
  war: WarInfo;
  b: WarInfo['battles'][number];
  now: number;
  busy: string | null;
  control: WarControl;
  run: (key: string, call: () => Promise<unknown>) => Promise<boolean>;
  sending: boolean;
  onSend: () => void;
}) {
  const { api } = control;
  const canSend =
    b.state === 'planned' || b.state === 'holding' || b.state === 'stalled' || b.state === 'fighting';
  return (
    <tr data-testid={`battle-${b.branch}`} data-state={b.state}>
      <td>
        <strong>{b.title}</strong> <span className="muted small">{KIND_LABEL[b.kind]}</span>
        <div>
          <code className="small">{b.branch}</code>
          {b.ahead > 0 && <span className="muted small"> · {b.ahead} ahead</span>}
          {b.lastActivityAt !== null && <span className="muted small"> · {ago(now - b.lastActivityAt)}</span>}
        </div>
      </td>
      <td>
        <span className={`battle-state battle-${b.state}`}>{STATE_LABEL[b.state]}</span>
        {b.worktree?.cleared && <div className="muted small">field cleared</div>}
      </td>
      <td className="small">
        {b.knights.length === 0
          ? '—'
          : b.knights.map((k, i) => (
              <span key={k.id}>
                {i > 0 && ', '}
                <button type="button" className="link" onClick={() => control.onTalk(k.id)}>
                  {k.name}
                </button>
              </span>
            ))}
      </td>
      <td className="small">
        {b.pull ? (
          <>
            #{b.pull.number} {b.pull.state}
            {b.pull.checks && (
              <span className={`checks checks-${b.pull.checks}`}> · checks {b.pull.checks}</span>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="battle-actions">
        {canSend && (
          <button
            type="button"
            className="chip"
            disabled={busy !== null}
            aria-expanded={sending}
            onClick={onSend}
            data-testid={`send-knight-${b.branch}`}
          >
            Send a Knight
          </button>
        )}
        {b.state === 'planned' && b.aimId && (
          <button
            type="button"
            className="link"
            disabled={busy !== null}
            onClick={() => void run(`withdraw:${b.branch}`, () => api.withdrawAim(war.id, b.aimId!))}
            data-testid={`withdraw-${b.branch}`}
          >
            Withdraw
          </button>
        )}
        {b.state === 'unclear' && (
          <>
            <button
              type="button"
              className="chip"
              disabled={busy !== null}
              onClick={() => void run(`won:${b.branch}`, () => api.markBattle(war.id, b.branch, 'won'))}
              data-testid={`mark-won-${b.branch}`}
            >
              It was won
            </button>
            <button
              type="button"
              className="link"
              disabled={busy !== null}
              onClick={() => void run(`ret:${b.branch}`, () => api.markBattle(war.id, b.branch, 'retreated'))}
              data-testid={`mark-retreated-${b.branch}`}
            >
              Retreated
            </button>
          </>
        )}
        {b.worktree && !b.worktree.cleared && (b.state === 'won' || b.state === 'retreated') && (
          <>
            {b.clearGuard && (
              <div className="muted small" data-testid={`guard-${b.branch}`}>
                Kept: {b.clearGuard}
              </div>
            )}
            <button
              type="button"
              className="chip"
              disabled={busy !== null}
              onClick={() => void run(`clear:${b.branch}`, () => api.clearField(war.id, b.branch))}
              data-testid={`clear-${b.branch}`}
            >
              Clear the field
            </button>
          </>
        )}
      </td>
    </tr>
  );
}

function SendKnight({
  war,
  branch,
  busy,
  onSend,
  onCancel,
}: {
  war: WarInfo;
  branch: string;
  busy: boolean;
  onSend: (o: { order: string; mode: ChatMode; name?: string }) => void;
  onCancel: () => void;
}) {
  const [order, setOrder] = useState('');
  const [mode, setMode] = useState<ChatMode>('acceptEdits');
  const [name, setName] = useState('');
  return (
    <form
      className="war-form"
      data-testid="send-knight-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (order.trim()) onSend({ order, mode, ...(name.trim() ? { name: name.trim() } : {}) });
      }}
    >
      <p className="small">
        A new Knight goes to <code>{branch}</code> in {war.name}, in its own worktree, and is told to push the
        branch and open a pull request when it is done.
      </p>
      <textarea
        value={order}
        onChange={(e) => setOrder(e.target.value)}
        rows={3}
        placeholder="Its orders: what to build or fix, and what done looks like."
        aria-label="Orders for the Knight"
        data-testid="send-knight-order"
      />
      <div className="war-form-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Name (optional)"
          aria-label="Knight's name"
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as ChatMode)} aria-label="Permissions">
          {CHAT_MODES.filter((m) => m !== 'bypassPermissions').map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <button type="submit" className="send" disabled={busy || !order.trim()} data-testid="send-knight-go">
          Send
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeclareBattle({
  busy,
  onDeclare,
}: {
  busy: boolean;
  onDeclare: (b: { title: string; kind: BattleKind; branch?: string }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<BattleKind>('feature');
  const [branch, setBranch] = useState('');
  return (
    <form
      className="war-form war-form-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        void onDeclare({ title, kind, ...(branch.trim() ? { branch: branch.trim() } : {}) }).then((ok) => {
          if (ok) {
            setTitle('');
            setBranch('');
          }
        });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        placeholder="A new battle: what it is for"
        aria-label="Battle title"
        data-testid="battle-title"
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as BattleKind)}
        aria-label="Kind of battle"
      >
        {BATTLE_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        maxLength={100}
        placeholder="Branch (optional)"
        aria-label="Branch"
      />
      <button type="submit" className="chip" disabled={busy || !title.trim()} data-testid="declare-battle">
        Declare battle
      </button>
    </form>
  );
}

function Declare({
  status,
  api,
  onStatus,
}: {
  status: WarStatus;
  api: Api;
  onStatus: (s: WarStatus) => void;
}) {
  const { busy, error, run } = useAction(onStatus, api);
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  return (
    <div className="ts-card" id="declare-war" data-testid="declare-war">
      <h3 className="ts-ribbon ts-ribbon-yellow">Declare a war</h3>
      <p className="small">
        A war is one git repository. Every branch in it becomes a battle; Knights working there wear its
        banner.
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {status.suggestions.length > 0 && (
        <>
          <p className="muted small">Knights have worked in these repositories:</p>
          <ul className="plain war-suggestions">
            {status.suggestions.map((s) => (
              <li key={s.key}>
                <strong>{s.folder}</strong>{' '}
                <span className="muted small">
                  ({s.knights} {s.knights === 1 ? 'Knight' : 'Knights'})
                </span>{' '}
                <button
                  type="button"
                  className="chip"
                  disabled={busy !== null}
                  onClick={() => void run(`key:${s.key}`, () => api.declareWar({ key: s.key }))}
                  data-testid={`declare-${s.folder}`}
                >
                  Declare war
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form
        className="war-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!folder.trim()) return;
          void run('folder', () => api.declareWar({ folder: folder.trim(), name, goal })).then((ok) => {
            if (ok) {
              setFolder('');
              setName('');
              setGoal('');
            }
          });
        }}
      >
        <div className="war-form-row">
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="Repository folder, e.g. /home/you/code/shop"
            aria-label="Repository folder"
            data-testid="war-folder"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Name (optional)"
            aria-label="War name"
            data-testid="war-name"
          />
        </div>
        <div className="war-form-row">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={300}
            placeholder="Its goal, in a sentence (optional)"
            aria-label="War goal"
            data-testid="war-goal"
          />
          <button
            type="submit"
            className="send"
            disabled={busy !== null || !folder.trim()}
            data-testid="declare-war-go"
          >
            Declare war
          </button>
        </div>
      </form>
    </div>
  );
}

function Reports({
  status,
  api,
  onStatus,
  now,
}: {
  status: WarStatus;
  api: Api;
  onStatus: (s: WarStatus) => void;
  now: number;
}) {
  const { busy, error, run } = useAction(onStatus, api);
  const [shown, setShown] = useState<{ date: string; markdown: string } | null>(null);
  const [time, setTime] = useState(status.settings.reports.time);
  const latest = status.lastReport?.date ?? null;
  useEffect(() => {
    if (latest)
      api.battleReport(latest).then(
        (r) => setShown({ date: r.date, markdown: r.markdown }),
        () => {},
      );
  }, [api, latest, status.lastReport?.at]);
  const s = status.settings;
  return (
    <div className="ts-card" id="battle-reports" data-testid="battle-reports">
      <h3 className="ts-ribbon ts-ribbon-yellow">Battle reports</h3>
      <p className="small">
        A dispatch for every war: battles won since the last one, what is being fought, what has stalled,
        loose ends and tokens. The guild writes it from git and its own record, so it costs no usage.
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="war-form-row small">
        <label>
          <input
            type="checkbox"
            checked={s.reports.enabled}
            onChange={(e) =>
              void run('reports', () => api.warSettings({ reports: { enabled: e.target.checked } }))
            }
            data-testid="reports-enabled"
          />{' '}
          Every day at
        </label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => {
            if (time !== s.reports.time) void run('time', () => api.warSettings({ reports: { time } }));
          }}
          aria-label="Report time"
        />
        {s.reports.enabled && s.reports.nextRunAt && (
          <span className="muted">next: {new Date(s.reports.nextRunAt).toLocaleString()}</span>
        )}
        <button
          type="button"
          className="chip"
          disabled={busy !== null}
          onClick={() => void run('run', () => api.runBattleReport())}
          data-testid="run-report"
        >
          {busy === 'run' ? 'Writing…' : 'Write one now'}
        </button>
      </div>
      <div className="war-form-row small">
        <label>
          <input
            type="checkbox"
            checked={s.autoClear}
            onChange={(e) => void run('clear', () => api.warSettings({ autoClear: e.target.checked }))}
            data-testid="auto-clear"
          />{' '}
          Clear a won battle&apos;s worktree a day after its pull request merges, when nothing in it would be
          lost
        </label>
      </div>
      <div className="war-form-row small">
        <label>
          A battle stalls after{' '}
          <input
            type="number"
            min={1}
            max={60}
            defaultValue={s.stallDays}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n !== s.stallDays) void run('stall', () => api.warSettings({ stallDays: n }));
            }}
            className="war-days"
            aria-label="Days before a battle stalls"
          />{' '}
          days without a commit or a Knight
        </label>
      </div>
      {shown ? (
        <div className="war-report" data-testid="battle-report">
          <p className="muted small">
            Latest: {shown.date}
            {status.lastReport && ` (${ago(now - status.lastReport.at)})`}
          </p>
          <Markdown text={shown.markdown} />
        </div>
      ) : (
        <p className="muted small">No report written yet.</p>
      )}
    </div>
  );
}
