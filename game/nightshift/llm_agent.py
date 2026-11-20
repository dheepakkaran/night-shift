"""LLM player for Night Shift.

Two backends:
- Claude (model name starts with "claude-"): official Anthropic SDK, key from ANTHROPIC_API_KEY. The rules + role +
  map go in a cached system prompt (written once per player, then read at 0.1x price).
- Any OpenAI-compatible chat endpoint (Groq, OpenAI, vLLM ...): env LLM_API_URL (full /chat/completions URL), LLM_API_KEY.

Budget: BUDGET.cap_usd (run.py --budget) is a hard dollar cap over the whole run. Every Claude call is priced from its
real `usage`; once the cap is reached no new call is sent and the game stops as invalid (never a fake result).

Cost control like a human player: the model is asked when something new happens (new sighting,
new people in the room, alert change, body, tool output, reached its goal, every `think_every`
ticks) and otherwise keeps following its own last plan ("goal" room). Every decision is still the
model's. Meetings: one call per turn and per vote.

If the API fails after retries, the agent returns {"_fallback": True} and the game is marked invalid.
"""
from __future__ import annotations

import asyncio
import atexit
import json
import os
import random
import re
import time
import urllib.error
import urllib.request

from .agents import Agent

RULES = """You are playing NIGHT SHIFT, a social deduction game on a station (classic hidden-impostor rules).
- Crew: finish your tasks or vote out every impostor. Impostors: kill crew until impostors >= crew, or let a
  critical sabotage (pressure leak) run out. Impostors know each other.
- The station is rooms joined by corridors. Moving into a corridor takes 1 tick, out of it 1 tick. You see
  everyone in the same room or corridor. Lights sabotage: crew cannot tell who is who.
- Impostors can kill a crewmate in the same place (cooldown), jump through vents, fake tasks, sabotage.
- Anyone can report a body in their location, or press the emergency button in the hub (limited uses).
- Meetings: everybody talks in rounds, then votes for a player or skip. Most votes is ejected; tie or skip = nobody.
- The visual task (Health scan) done in front of others proves someone is crew.
- Admin shows head counts per room (not corridors, no names), vitals shows who is dead, cams show some rooms.
Always answer with ONE JSON object only, no other text."""

ROAM_FORMAT = """Reply JSON: {"action": "<exactly one item from can>", "goal": "<optional room you are heading to>",
"thought": "<short private reasoning, never shown to others>"}"""
TALK_FORMAT = """Reply JSON: {"action": "say" or "pass", "say": "<your message, max %d words>",
"claims": [{"type": "<one of claim_types>", "who": "<player or self>", "room": "<room>", "tick": <int>}],
"ask": "<optional player you want to answer next>", "thought": "<private>"}
Claims must match what you say (they are checked later). Impostors may lie; crew should be truthful."""
VOTE_FORMAT = """Reply JSON: {"action": "<one item from can: vote:<name> or skip>", "thought": "<private>"}"""

_SEM: dict = {}

# USD per 1M tokens (Anthropic first-party list price, prompts <= 100K tokens)
PRICES = {"claude-fable-5-2": {"in": 8.00, "out": 40.00, "cache_write": 10.00, "cache_read": 0.80},   # 3rd-party listed $8/$40; cache = usual 1.25x / 0.1x
          "claude-haiku-5-5": {"in": 0.10, "out": 0.50, "cache_write": 0.125, "cache_read": 0.01},
          "claude-sonnet-5-5": {"in": 2.00, "out": 10.00, "cache_write": 2.50, "cache_read": 0.10},
          "claude-opus-5-5": {"in": 4.00, "out": 20.00, "cache_write": 5.00, "cache_read": 0.20}}


class BudgetStop(RuntimeError):
    pass


class Budget:
    def __init__(self):
        self.cap_usd = float(os.environ.get("NS_BUDGET_USD", "1.0"))
        self.spent = 0.0
        self.calls = 0
        self.tokens = {"in": 0, "out": 0, "cache_write": 0, "cache_read": 0}
        self._last_save = 0.0

    def flush(self):
        self._save(force=True)

    def check(self):
        if self.spent >= self.cap_usd:
            raise BudgetStop(f"budget cap ${self.cap_usd:.2f} reached (spent ${self.spent:.4f})")

    def add(self, model, usage):
        pr = PRICES[model]
        t = {"in": usage.input_tokens or 0, "out": usage.output_tokens or 0,
             "cache_write": getattr(usage, "cache_creation_input_tokens", 0) or 0,
             "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0}
        cost = sum(t[k] * pr[k] for k in t) / 1e6
        for k in t:
            self.tokens[k] += t[k]
        self.spent += cost
        self.calls += 1
        self._save()
        return cost

    def add_raw(self, cost, tin, tout):
        self.tokens["in"] += tin
        self.tokens["out"] += tout
        self.spent += cost
        self.calls += 1
        self._save()

    def _save(self, force=False):
        """Running total on disk (NS_BUDGET_FILE), so a stopped shift still shows what it cost.
        Written at most once a second while playing, and always on exit (flush), so no call is lost."""
        f = os.environ.get("NS_BUDGET_FILE")
        now = time.monotonic()
        if f and self.calls and (force or now - self._last_save >= 1.0):
            self._last_save = now
            try:
                with open(f, "w") as fh:
                    json.dump(self.summary(), fh)
            except OSError:
                pass

    def summary(self):
        return {"cap_usd": self.cap_usd, "spent_usd": round(self.spent, 5), "calls": self.calls, "tokens": dict(self.tokens)}


BUDGET = Budget()
atexit.register(BUDGET.flush)
_CLAUDE: dict = {}


def _loop_key():
    return id(asyncio.get_running_loop())   # run.py starts a fresh event loop per game


def claude_client():
    k = _loop_key()
    if k not in _CLAUDE:
        import anthropic
        _CLAUDE.clear()
        _CLAUDE[k] = anthropic.AsyncAnthropic(max_retries=4, timeout=90.0)
    return _CLAUDE[k]


async def close_clients():
    for c in list(_CLAUDE.values()):
        await c.close()
    _CLAUDE.clear()


def _sem(name, default):
    key = (name, _loop_key())
    if key not in _SEM:
        _SEM[key] = asyncio.Semaphore(int(os.environ.get("LLM_CONCURRENCY", default)))
    return _SEM[key]


class LLMAgent(Agent):
    def __init__(self, model: str, seed=0, think_every=6, temperature=0.7, max_retries=6, memory=40, effort="low"):
        self.model = model
        self.claude = model.startswith("claude-")
        self.effort = effort
        self.cost = 0.0
        self.rng = random.Random(seed)
        self.url = os.environ.get("LLM_API_URL", "")
        self.key = os.environ.get("LLM_API_KEY", "")
        self.think_every = think_every
        self.temperature = temperature
        self.max_retries = max_retries
        self.memory: list[str] = []      # own notes: what I saw and did, with ticks
        self.mem_size = memory
        self.goal = None
        self.last_think = -99
        self.last_view = None
        self.calls = 0
        self.tokens = 0
        self.role_info = ""

    # ------------------------------------------------------------ API
    async def _chat(self, system, user):
        if self.claude:
            return await self._chat_claude(system, user)
        sem = _sem(self.url, "4")
        body = json.dumps({"model": self.model, "temperature": self.temperature,
                           "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Authorization": f"Bearer {self.key}",
                                                                   "Content-Type": "application/json",
                                                                   "User-Agent": "nightshift-agent/0.1"})
        last = None
        for attempt in range(self.max_retries):
            async with sem:
                try:
                    data = await asyncio.to_thread(lambda: json.loads(urllib.request.urlopen(req, timeout=120).read()))
                    self.calls += 1
                    self.tokens += data.get("usage", {}).get("total_tokens", 0)
                    return data["choices"][0]["message"]["content"] or ""
                except urllib.error.HTTPError as e:
                    last = f"HTTP {e.code}: {e.read()[:200]!r}"
                except Exception as e:  # network, bad JSON
                    last = repr(e)[:200]
            print(f"[{self.model}] API error ({attempt + 1}/{self.max_retries}): {last}")
            await asyncio.sleep(min(2 ** attempt, 30) + self.rng.random())
        raise RuntimeError(last)

    async def _chat_claude(self, system, user):
        import anthropic
        BUDGET.check()
        sem = _sem("claude", "6")
        async with sem:
            BUDGET.check()
            try:
                r = await claude_client().messages.create(
                    model=getattr(self, "api_model", self.model), max_tokens=2000,
                    output_config={"effort": self.effort},
                    # rules + my role + map never change during a game -> cached prefix
                    system=[{"type": "text", "text": system + "\n\n" + self.role_info,
                             "cache_control": {"type": "ephemeral"}}],
                    messages=[{"role": "user", "content": user}])
            except anthropic.RateLimitError as e:
                raise RuntimeError(f"rate limit after retries: {e}") from e
            except anthropic.APIStatusError as e:
                raise RuntimeError(f"HTTP {e.status_code}: {str(e)[:200]}") from e
            except anthropic.APIConnectionError as e:
                raise RuntimeError(f"connection: {e}") from e
        c = BUDGET.add(getattr(self, "api_model", self.model), r.usage)
        self.cost += c
        self.calls += 1
        self.tokens += (r.usage.input_tokens or 0) + (r.usage.output_tokens or 0)
        if r.stop_reason == "refusal":
            return ""
        return "".join(b.text for b in r.content if b.type == "text")

    async def _decide(self, system, user, can):
        """Ask the model; one repair turn if the JSON or the action is bad. Returns dict or fallback."""
        try:
            text = await self._chat(system, user)
            ans = parse_json(text)
            if ans is None or (can and ans.get("action") not in can):
                fix = (f"{user}\n\nYour last reply was not valid: {text[:300]!r}. "
                       f"Answer again with ONE JSON object; action must be exactly one of: {can}")
                ans = parse_json(await self._chat(system, fix))
            if ans is None:
                return {"action": "wait" if "wait" in (can or []) else (can or ["pass"])[0], "_fallback": True}
            return ans
        except BudgetStop as e:
            return {"action": "wait" if "wait" in (can or []) else (can or ["pass"])[0], "_fallback": True,
                    "_error": str(e)}
        except RuntimeError as e:
            return {"action": "wait" if "wait" in (can or []) else (can or ["pass"])[0], "_fallback": True,
                    "_error": str(e)}

    def _head(self):
        return "" if self.claude else f"{self.role_info}\n\n"

    # ------------------------------------------------------------ game screens
    async def notify(self, obs):
        scr = obs["screen"]
        if scr == "role_reveal":
            y = obs["you"]
            self.role_info = (f"You are {y['name']} ({y['colour']}). Your role: {y['role'].upper()}."
                              + (f" Fellow impostors: {', '.join(y.get('teammates', []))}." if y["role"] == "impostor" else "")
                              + f"\nPlayers: {', '.join(obs['players'])}. Impostors in game: {obs['impostors']}."
                              + f"\nMap: {json.dumps(obs['map'], separators=(',', ':'))}")
        elif scr == "ejection":
            self.memory.append(f"MEETING RESULT: {obs['text']} Votes: {obs.get('votes')}")
            self.goal = None
        elif scr == "end":
            self.memory.append(f"GAME OVER: {obs['winner']} won ({obs['reason']}).")

    def _note(self, obs):
        y = obs["you"]
        line = f"t{obs['tick']}: I am in {y['room']}; here: {obs['here']['players'] or 'nobody'}"
        if obs["here"]["bodies"]:
            line += f"; BODIES: {obs['here']['bodies']}"
        if obs.get("seen_last_tick"):
            line += f"; saw: {'; '.join(obs['seen_last_tick'])}"
        if obs.get("tool_output"):
            line += f"; tool: {json.dumps(obs['tool_output'])}"
        self.memory.append(line)
        self.memory = self.memory[-self.mem_size:]

    def _need_think(self, obs):
        view = (tuple(sorted(obs["here"]["players"])), tuple(obs["here"]["bodies"]), tuple(obs.get("alerts", [])))
        new = (bool(obs.get("seen_last_tick")) or view != self.last_view or bool(obs.get("tool_output"))
               or self.goal is None or obs["you"]["room"] == self.goal or obs["tick"] - self.last_think >= self.think_every
               or "report" in obs["can"])
        self.last_view = view
        return new

    def _auto(self, obs):
        """Keep following my own plan: head to my goal; do a task if one is here."""
        can = obs["can"]
        tasks = obs["you"]["tasks"] if isinstance(obs["you"]["tasks"], list) else []
        here_task = [c for c in can if c.startswith("do_task:") or c.startswith("fake_task:")]
        if here_task and any(t.get("room") == obs["you"]["room"] and not t["done"] for t in tasks):
            return here_task[0]
        for t in tasks:
            if not t["done"] and t.get("room") == self.goal and t.get("next_move") in can:
                return t["next_move"]
        return None

    async def act(self, obs):
        scr = obs["screen"]
        if scr in ("roam", "ghost"):
            self._note(obs)
            if not self._need_think(obs):
                a = self._auto(obs)
                if a:
                    return {"action": a}
            self.last_think = obs["tick"]
            user = (f"{self._head()}YOUR NOTES (latest last):\n" + "\n".join(self.memory[-20:])
                    + f"\n\nNOW: {json.dumps(obs, separators=(',', ':'))}\n\n{ROAM_FORMAT}")
            ans = await self._decide(RULES, user, obs["can"])
            g = ans.get("goal")
            self.goal = g if isinstance(g, str) else None
            return ans
        if scr == "meeting_talk":
            user = (f"{self._head()}YOUR NOTES (latest last):\n" + "\n".join(self.memory[-30:])
                    + f"\n\nMEETING: {json.dumps(obs, separators=(',', ':'))}\n\n" + TALK_FORMAT % obs["max_words"])
            ans = await self._decide(RULES, user, ["say", "pass"])
            if ans.get("action") == "say":
                self.memory.append(f"meeting {obs['meeting']} round {obs['round']}: I said: {ans.get('say')}")
            return ans
        if scr == "meeting_vote":
            user = (f"{self._head()}YOUR NOTES (latest last):\n" + "\n".join(self.memory[-30:])
                    + f"\n\nVOTE NOW: {json.dumps(obs, separators=(',', ':'))}\n\n{VOTE_FORMAT}")
            return await self._decide(RULES, user, obs["can"])
        return {"action": "wait"}


def parse_json(text: str):
    if not text:
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        return None


# ------------------------------------------------------------------ real-time mode (realtime.py)
class RTLLMAgent(LLMAgent):
    """A real-time player on any provider. It gets the rulebook (prompts.rulebook, sent by the game), what its
    worker sees now, what it saw in the last ~30 s, and the notebook it writes itself. Nothing plays for it."""

    def __init__(self, model: str, seed=0, effort="low", short_memory=30.0, notebook=40, brain="pure", style=None):
        from .providers import split
        prov, mid = split(model if ":" in model else ("claude:" + model if model.startswith("claude-") else model))
        super().__init__(model=mid, seed=seed, effort=effort)
        self.provider = prov
        self.spec = f"{prov}:{mid}"
        self.api_model = mid
        self.model = self.spec                 # shown in the lobby and the logs
        self.claude = prov == "claude"
        self.rules = ""
        self.short, self.short_memory = [], short_memory
        self.notes, self.notebook = [], notebook
        self.me, self.name, self._t = "", "", 0.0
        self.brain, self.style = brain, style if brain == "coached" else None
        self.last_seen: dict = {}              # coached: name -> (time, where), from this player's own eyes
        self.n_impostors, self.has_jester = 1, False
        self._last_call, self._last_sig = -99.0, None
        self.free = prov in ("groq", "nvidia")

    async def _decide(self, system, user, can):
        """Real time: if the model is too slow or the call fails, the player simply did not finish a thought. Its
        worker keeps the last order ("wait"); this is recorded as a missed thought, never as an invented move."""
        try:
            text = await asyncio.wait_for(self._chat(system, user), timeout=50)
        except BudgetStop as e:
            return {"action": "wait", "_fallback": True, "_error": str(e)}
        except (RuntimeError, asyncio.TimeoutError, Exception) as e:
            return {"action": "wait", "_missed": True, "_error": repr(e)[:200]}
        ans = parse_json(text)
        if ans is None or (can and ans.get("action") not in can):
            fix = (f"{user}\n\nYour last reply was not usable: {text[:300]!r}. "
                   f"Answer again with ONE JSON object; action must be exactly one item of can.")
            try:
                ans = parse_json(await asyncio.wait_for(self._chat(system, fix), timeout=50))
            except Exception as e:
                return {"action": "wait", "_missed": True, "_error": repr(e)[:200]}
        if ans is None:
            return {"action": "wait", "_missed": True, "_error": "no JSON in two replies"}
        return ans

    async def _chat(self, system, user):
        if self.claude:
            return await self._chat_claude(system, user)
        from .providers import chat_openai_compatible
        coached = self.brain == "coached"
        think = not coached or getattr(self, "_deep", False)      # coached: fast reflexes while roaming, thinking in meetings
        text, cost, tok = await chat_openai_compatible(self.spec, system, user, BUDGET,
                                                       max_tokens=500 if coached else 700, think=think)
        self.cost += cost
        self.calls += 1
        self.tokens += tok
        return text

    async def notify(self, obs):
        scr = obs["screen"]
        if scr == "role_reveal":
            self.rules = obs["rules"]           # the same rulebook for every player
            self.role_info = ""
            self.name = obs["you"]["name"]
            self.me = f"You are {self.name}. You have not received any private message: you are crew."
            self.n_impostors = obs.get("impostors", 1)
            self.has_jester = bool((obs.get("settings") or {}).get("jester"))
            if self.brain == "coached":
                from types import SimpleNamespace
                from .playbook import compact_rules, system_prompt
                st = SimpleNamespace(**obs["settings"])
                self.rules = system_prompt(compact_rules(obs["players"], obs["impostors"], obs["map"], st, self.has_jester), self.style)
        elif scr == "role_change":
            self.me = f"You are {self.name}. At time {obs['time']:.0f} s you received this private message:\n{obs['message']}"
            if self.brain == "coached":
                from .playbook import role_playbook
                self.me += "\n" + role_playbook(obs.get("role", "impostor"))
        elif scr == "ejection":
            self.short.append((self._t, f"MEETING RESULT (everyone saw this): {obs['text']} Votes: {obs.get('votes')}"))

    def _see(self, obs):
        t = self._t = obs["time"]
        y = obs["you"]
        for n in obs.get("near") or []:
            if n["name"] != "someone":
                self.last_seen[n["name"]] = (t, n["where"] + (" doing a task" if n.get("doing") else ""))
        for b in obs.get("bodies") or []:
            self.last_seen[b["name"]] = (t, f"DEAD in {b['where']}")
        for s in obs.get("seen") or []:
            self.short.append((t, s))
        near = ", ".join(f"{n['name']} in {n['where']}" for n in obs.get("near") or []) or "nobody"
        line = f"t={t:.0f}s: I was in {y['where']} ({y['order']}); I could see: {near}"
        if obs.get("bodies"):
            line += "; BODY: " + ", ".join(f"{b['name']} in {b['where']}" for b in obs["bodies"])
        if obs.get("tool_output"):
            line += f"; console showed {json.dumps(obs['tool_output'], separators=(',', ':'))}"
        self.short.append((t, line))
        self.short = [(a, b) for a, b in self.short if t - a <= self.short_memory]

    def _keep(self, ans, t):
        n = ans.get("note")
        if isinstance(n, str) and n.strip():
            self.notes.append(f"t={t:.0f}s: {n.strip()[:200]}")
            self.notes = self.notes[-self.notebook:]

    async def act(self, obs):
        from .prompts import meeting_user, roam_user
        scr = obs["screen"]
        if scr == "rt_meeting" and obs.get("you_saw_just_before") and not getattr(self, "_got_before", None) == obs.get("meeting"):
            self._got_before = obs.get("meeting")              # remember it once, like anything else you saw
            for line in obs["you_saw_just_before"]:
                self.short.append((obs["time"], line))
        if self.brain == "coached":
            return await self._act_coached(obs)
        if scr in ("rt_roam", "rt_ghost"):
            self._see(obs)
            view = {k: v for k, v in obs.items() if k not in ("can", "epoch", "screen")}
            can = obs["can"]
            walks = [c for c in can if c.startswith("walk:")]
            rooms = [c for c in can if c.startswith("go:") and not c.startswith("go:task:")]
            doors = [c for c in can if c.startswith("sabotage:doors:")]
            rest = [c for c in can if c not in walks and c not in rooms and c not in doors]
            short = json.dumps(rest) + (" and walk:<N|NE|E|SE|S|SW|W|NW>" if walks else "") + \
                    (" and go:<any room>" if rooms else "") + (" and sabotage:doors:<any room>" if doors else "")
            user = roam_user(self.me, self.notes, [b for _, b in self.short[-24:]], json.dumps(view, separators=(",", ":")), short)
            ans = await self._decide(self.rules, user, can)
            self._keep(ans, obs["time"])
            return ans
        if scr == "rt_meeting":
            if obs["phase"] == "voting" and obs["you"]["voted"] and obs["can"] == ["wait"]:
                return {"action": "wait", "look_again": 5}
            self._t = obs["time"]
            chat = "\n".join(f"{'[ghost] ' if c.get('ghost') else ''}{c['from']}: {c['text']}" for c in obs["chat"][-30:]) or "(nobody has written anything yet)"
            view = {k: v for k, v in obs.items() if k not in ("chat", "can", "screen")}
            user = meeting_user(self.me, self.notes, [b for _, b in self.short[-16:]], json.dumps(view, separators=(",", ":")), chat, json.dumps(obs["can"]))
            ans = await self._decide(self.rules, user, obs["can"])
            self._keep(ans, obs["time"])
            return ans
        return {"action": "wait"}


    def _sig(self, obs):
        hot = tuple(sorted(c for c in obs["can"] if c.split(":")[0] in ("kill", "report", "do_task", "fix", "button", "vent", "use")))
        return (tuple(sorted(n["name"] for n in obs.get("near") or [])), tuple(b["name"] for b in obs.get("bodies") or []),
                tuple(obs.get("alerts") or []), hot, obs["you"]["order"] == "standing still")

    async def _act_coached(self, obs):
        """COACHED brain (playbook.py): compact rules + playbook + this seat's style, text views, plans, reflexes,
        last-seen table and case file. Free-tier seats skip a look when nothing new is in view and they looked
        less than 4 s ago (the worker keeps its order and plan), so the rate limit goes to moments that matter."""
        import time as _time
        from .playbook import meeting_view, roam_view
        scr = obs["screen"]
        if scr in ("rt_roam", "rt_ghost"):
            self._see(obs)
            sig, now = self._sig(obs), _time.monotonic()
            urgent = bool(obs.get("bodies") or obs.get("seen") or obs.get("tool_output"))
            if self.free and not urgent and sig == self._last_sig and now - self._last_call < 4.0:
                return {"action": "wait", "look_again": 2.0}
            self._last_sig, self._last_call = sig, now
            user = roam_view(obs, {k: v for k, v in self.last_seen.items() if k != self.name}, self.notes,
                             [b for _, b in self.short[-10:]], self.me)
            ans = await self._decide(self.rules, user, obs["can"])
            self._keep(ans, obs["time"])
            return ans
        if scr == "rt_meeting":
            if obs["phase"] == "voting" and obs["you"]["voted"] and obs["can"] == ["wait"]:
                return {"action": "wait", "look_again": 5}
            self._t = obs["time"]
            user = meeting_view(obs, {k: v for k, v in self.last_seen.items() if k != self.name}, self.notes,
                                [b for _, b in self.short[-10:]], self.me, self.n_impostors, self.has_jester)
            self._deep = obs["phase"] == "voting" and not obs["you"]["voted"]       # think hard before the vote
            try:
                ans = await self._decide(self.rules, user, obs["can"])
            finally:
                self._deep = False
            self._keep(ans, obs["time"])
            return ans
        return {"action": "wait"}


COMMENTATOR = """You are the live commentator of a broadcast of NIGHT SHIFT, a social deduction game played by AI models
(players are named after their model). You see everything, including who the impostor is; the players do not hear you.
Write ONE short line for the audience about the latest moment: lively, plain English, max 18 words, no emojis, no
hashtags, never invent events that are not in the log. If nothing new happened, describe the tension (who is where)."""


def make_commentator(model="claude-haiku-5-5"):
    agent = LLMAgent(model=model)
    agent.role_info = ""

    async def say(story):
        text = await agent._chat_claude(COMMENTATOR, "GAME LOG (latest last):\n" + story + "\n\nYour one line:")
        return " ".join(text.strip().strip('"').split())[:200]
    say.agent = agent
    return say
