import type { ChatItem } from '@agent-guild/core';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  type Api,
  ApiError,
  CHAT_MODES,
  type ChatInfo,
  type ChatMode,
  type ChatSnapshot,
  type CrierStatus,
  MODE_LABEL,
} from './api.ts';

/**
 * Talking to Claude Code sessions from the guild: the chat drawer, the "New session"
 * dialog, and the Town Crier card with its reports.
 */

// Links in Claude's replies open in a new tab and cannot reach back into this page.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false })), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ----------------------------------------------------------------------------- chat

function useChatStream(api: Api, id: string) {
  const [snapshot, setSnapshot] = useState<ChatSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The drawer is keyed by chat id, so a new chat gets fresh state without a reset here.
    const source = new EventSource(api.chatStreamUrl(id));
    let opened = false;
    source.addEventListener('snapshot', (e) => {
      opened = true;
      setSnapshot(JSON.parse((e as MessageEvent<string>).data) as ChatSnapshot);
    });
    source.addEventListener('item', (e) => {
      const item = JSON.parse((e as MessageEvent<string>).data) as ChatItem;
      setSnapshot((s) => {
        if (!s) return s;
        const i = s.items.findIndex((x) => x.id === item.id);
        const items = i === -1 ? [...s.items, item] : s.items.map((x, j) => (j === i ? item : x));
        return { ...s, items };
      });
    });
    source.addEventListener('remove', (e) => {
      const { id: gone } = JSON.parse((e as MessageEvent<string>).data) as { id: string };
      setSnapshot((s) => (s ? { ...s, items: s.items.filter((x) => x.id !== gone) } : s));
    });
    source.addEventListener('info', (e) => {
      const info = JSON.parse((e as MessageEvent<string>).data) as ChatInfo;
      setSnapshot((s) => (s ? { ...s, info } : s));
    });
    source.onerror = () => {
      if (!opened) {
        source.close();
        setError('This session could not be opened. The guild may not know its folder yet.');
      }
    };
    return () => source.close();
  }, [api, id]);

  return { snapshot, error };
}

export function ChatDrawer({ api, id, onClose }: { api: Api; id: string; onClose: () => void }) {
  const { snapshot, error } = useChatStream(api, id);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const items = snapshot?.items ?? [];
  const info = snapshot?.info;

  const last = items.at(-1);
  // Follow the conversation as it grows, like a chat app.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [items.length, last]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.send(id, text);
      setDraft('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Could not send the message.');
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <aside className="drawer" aria-label="Session chat" data-testid="chat">
      <header className="drawer-head">
        <div>
          <h2>{info?.name ?? 'Session'}</h2>
          {info && (
            <p className="muted small">
              <code>{info.cwd}</code> · {info.busy ? 'Working…' : info.running ? 'Ready' : 'Idle'}
            </p>
          )}
        </div>
        <span className="drawer-actions">
          {info?.busy && (
            <button type="button" className="chip" onClick={() => void api.stop(id)} data-testid="chat-stop">
              Stop
            </button>
          )}
          <button type="button" className="chip" onClick={onClose} aria-label="Close chat">
            Close
          </button>
        </span>
      </header>

      {error ? (
        <p role="alert" className="drawer-body">
          {error}
        </p>
      ) : !snapshot ? (
        <p className="muted drawer-body">Opening…</p>
      ) : (
        <ol className="messages" ref={list} data-testid="messages">
          {items.length === 0 && <li className="muted">No messages yet.</li>}
          {items.map((item) => (
            <Message key={item.id} item={item} />
          ))}
          {info?.busy && items.at(-1)?.kind !== 'assistant' && (
            <li className="msg msg-thinking" aria-live="polite">
              Claude is working…
            </li>
          )}
        </ol>
      )}

      <form className="composer" onSubmit={(e) => void send(e)}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message Claude… (Enter to send, Shift+Enter for a new line)"
          rows={3}
          aria-label="Message"
          data-testid="composer"
        />
        <div className="composer-row">
          {sendError && (
            <span role="alert" className="error small">
              {sendError}
            </span>
          )}
          <button type="submit" className="send" disabled={!draft.trim() || sending} data-testid="send">
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}

function Message({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <li className="msg msg-user" data-testid="msg-user">
          <div className="bubble">{item.text}</div>
        </li>
      );
    case 'assistant':
      return (
        <li className="msg msg-assistant" data-testid="msg-assistant">
          <Markdown text={item.text} />
          {item.streaming && <span className="cursor" aria-hidden="true" />}
        </li>
      );
    case 'tool':
      return (
        <li className="msg msg-tool" data-testid="msg-tool">
          <details>
            <summary>
              <span className={`tool-dot ${item.result ? (item.result.ok ? 'ok' : 'bad') : 'pending'}`} />
              <code>{item.name}</code> <span className="muted">{item.summary}</span>
            </summary>
            {item.result ? (
              <pre>{item.result.preview || '(no output)'}</pre>
            ) : (
              <p className="muted small">Running…</p>
            )}
          </details>
        </li>
      );
    case 'result':
      return (
        <li className={`msg msg-result ${item.ok ? '' : 'error'}`} data-testid="msg-result">
          {item.ok
            ? `Done${item.durationMs ? ` in ${(item.durationMs / 1000).toFixed(1)}s` : ''}${
                item.costUsd ? ` · about $${item.costUsd.toFixed(3)} of usage` : ''
              }`
            : `Stopped with an error: ${item.text}`}
        </li>
      );
    case 'notice':
      return (
        <li
          className={`msg msg-notice ${item.tone}`}
          data-testid="msg-notice"
          role={item.tone === 'error' ? 'alert' : undefined}
        >
          <Markdown text={item.text} />
        </li>
      );
  }
}

// ----------------------------------------------------------------------------- new chat

export function NewChatDialog({
  api,
  projects,
  onStarted,
  onCancel,
}: {
  api: Api;
  projects: string[];
  onStarted: (id: string) => void;
  onCancel: () => void;
}) {
  const [cwd, setCwd] = useState(projects[0] ?? '');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ChatMode>('acceptEdits');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const info = await api.startChat({ cwd, ...(name.trim() ? { name } : {}), mode, message });
      onStarted(info.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="drawer" aria-label="New session" data-testid="new-chat">
      <header className="drawer-head">
        <h2>New session</h2>
        <button type="button" className="chip" onClick={onCancel}>
          Cancel
        </button>
      </header>
      <form className="drawer-body form" onSubmit={(e) => void submit(e)}>
        <label>
          Folder
          <input
            list="project-folders"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/home/you/project"
            required
            data-testid="new-cwd"
          />
          <datalist id="project-folders">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <span className="muted small">Any folder inside your home directory.</span>
        </label>
        <label>
          Name <span className="muted small">(optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            data-testid="new-name"
          />
        </label>
        <label>
          Permissions
          <select value={mode} onChange={(e) => setMode(e.target.value as ChatMode)} data-testid="new-mode">
            {CHAT_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          {mode === 'bypassPermissions' && (
            <span className="error small" role="alert">
              Claude will run any command and edit any file without asking. Use only in a folder you can
              afford to lose.
            </span>
          )}
        </label>
        <label>
          First message
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            required
            placeholder="What should Claude do?"
            data-testid="new-message"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="send"
          disabled={busy || !cwd.trim() || !message.trim()}
          data-testid="new-start"
        >
          {busy ? 'Starting…' : 'Start session'}
        </button>
      </form>
    </aside>
  );
}

// ----------------------------------------------------------------------------- Town Crier

export function CrierCard({
  api,
  version,
  onOpenChat,
  onOpenReport,
}: {
  api: Api;
  version: number;
  onOpenChat: (id: string) => void;
  onOpenReport: (date: string) => void;
}) {
  const [status, setStatus] = useState<CrierStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.crier().then(setStatus, () => setError('Could not load the Town Crier.'));
  }, [api, version]);

  if (error) return <p className="error small">{error}</p>;
  if (!status) return null;
  const { config } = status;

  const update = async (patch: Partial<typeof config>) => {
    try {
      setStatus(await api.updateCrier(patch));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  };

  const run = async () => {
    try {
      const info = await api.runCrier();
      onOpenChat(info.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the Town Crier.');
    }
  };

  return (
    <section className="crier" data-testid="crier">
      <h2 className="section">Town Crier</h2>
      <p className="muted small">
        A daily report on tech and AI, keeping stories scored {config.threshold}/10 or higher.{' '}
        {status.nextRunAt
          ? `Next: ${new Date(status.nextRunAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`
          : 'Paused.'}
      </p>
      <div className="crier-controls">
        <label className="inline">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => void update({ enabled: e.target.checked })}
          />
          Daily at
        </label>
        <input
          type="time"
          value={config.time}
          onChange={(e) => void update({ time: e.target.value })}
          aria-label="Time of day"
          data-testid="crier-time"
        />
        <label className="inline">
          cutoff
          <input
            type="number"
            min={1}
            max={10}
            value={config.threshold}
            onChange={(e) => void update({ threshold: Number(e.target.value) })}
            aria-label="Importance cutoff"
            data-testid="crier-threshold"
          />
        </label>
      </div>
      <div className="crier-actions">
        <button type="button" className="chip" onClick={() => void run()} data-testid="crier-run">
          Run now
        </button>
        {config.lastChatId && (
          <button type="button" className="chip" onClick={() => onOpenChat(config.lastChatId!)}>
            Last run
          </button>
        )}
      </div>
      {status.reports.length > 0 && (
        <ul className="plain">
          {status.reports.slice(0, 5).map((r) => (
            <li key={r.date}>
              <button type="button" className="link" onClick={() => onOpenReport(r.date)}>
                {r.date}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReportDrawer({ api, date, onClose }: { api: Api; date: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.report(date).then(
      (r) => setText(r.text),
      () => setError('That report could not be read.'),
    );
  }, [api, date]);
  return (
    <aside className="drawer" aria-label={`Town Crier report for ${date}`} data-testid="report">
      <header className="drawer-head">
        <h2>Town Crier · {date}</h2>
        <button type="button" className="chip" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="drawer-body">
        {error ? (
          <p role="alert">{error}</p>
        ) : text === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <Markdown text={text} />
        )}
      </div>
    </aside>
  );
}
