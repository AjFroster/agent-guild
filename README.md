# agent-guild

Your Claude Code sessions as an RPG guild. Sessions are heroes, sub-agents are party
members, and todos are quests that earn XP. A beacon lights up when an agent is waiting
on you.

Local-first, and a work in progress. There is no live connection yet. Try the recorded
demos:

```bash
npm ci
npm run dev
# open http://127.0.0.1:5280/?demo=party
```

## Status

- [x] Game rules and demo replay, CI with screenshots on every PR
- [ ] Local server: Claude Code hooks → guild events (127.0.0.1, token auth)
- [ ] Consent-gated hook installer
- [ ] Visual regression baselines
