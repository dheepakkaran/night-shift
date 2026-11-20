"""Run Night Shift games from the command line.

    python -m nightshift.run --games 3 --players 10 --impostors 2 --agents rules
    python -m nightshift.run --agents llm --model openai/gpt-oss-20b --players 7     (needs LLM_API_URL / LLM_API_KEY)
    python -m nightshift.run --pace human ...       (play at people speed: watch it live in the viewer)
    python -m nightshift.run --mode realtime ...    (no turns: joystick movement, agents think while walking, live chat)

Each game writes runs/<name>/game-<n>/ with game.json, events.jsonl, observations.jsonl, private.jsonl.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import time
from pathlib import Path

from .agents import RuleAgent, RandomAgent
from .engine import HUMAN_PACE, Lobby, Settings

ROOT = Path(__file__).resolve().parents[1]


def make_agent(kind, i, seed, args):
    if args.mode == "realtime":
        if kind == "rules":
            from .realtime import RTRuleAgent
            return RTRuleAgent(seed=seed * 100 + i)
        if kind == "llm":
            from .llm_agent import RTLLMAgent
            seats = args.seat_models or [args.model]
            style = args.styles[i] if getattr(args, "styles", None) else None
            return RTLLMAgent(model=seats[i % len(seats)], seed=seed * 100 + i, effort=args.effort, brain=args.brain, style=style)
        raise ValueError(f"{kind} has no real-time version")
    if kind == "rules":
        return RuleAgent(seed=seed * 100 + i)
    if kind == "random":
        return RandomAgent(seed=seed * 100 + i)
    if kind == "llm":
        from .llm_agent import LLMAgent
        return LLMAgent(model=args.model, seed=seed * 100 + i, effort=args.effort)
    raise ValueError(kind)


async def play(seed, args, out):
    s = Settings(impostors=args.impostors, seed=seed, discussion_rounds=args.rounds, vote_mode=args.vote_mode,
                 confirm_ejects=not args.no_confirm_ejects, max_ticks=args.max_ticks)
    lobby = Lobby(s)
    kinds = (args.agents.split(",") * args.players)[: args.players]
    if args.models:      # one model per seat, seats shuffled so colour says nothing about the model
        import random as _r
        ms = [m.strip() for m in args.models.split(",") if m.strip()]
        ms = (ms * args.players)[: args.players]
        if not args.keep_order:
            _r.Random(seed).shuffle(ms)
        args.seat_models = ms
    else:
        args.seat_models = None
    args.styles = None
    if args.mode == "realtime" and args.brain == "coached":
        from .playbook import deal_styles
        args.styles = deal_styles(args.players, seed)
    styled = args.mode == "realtime" and args.seat_models and args.model_names
    if styled:
        from .providers import STYLE, seat_names
        names = seat_names(args.seat_models)
    for i, k in enumerate(kinds):
        if styled:
            st = STYLE.get(args.seat_models[i])
            lobby.join(make_agent(k, i, seed, args), name=names[i], colour=st[1] if st else None)
        else:
            lobby.join(make_agent(k, i, seed, args))
    if args.mode == "realtime":
        from .realtime import start
        extra = {k: v for k, v in (("discussion_s", args.discussion), ("voting_s", args.voting)) if v is not None}
        game = start(lobby, out, realtime=not args.fast, variant=args.variant, brain=args.brain, **extra)
        game.pool = [m for m in args.pool.split(",") if m] or None
        if args.commentary:
            from .llm_agent import make_commentator
            game.commentator = make_commentator()
        if args.seat_models:
            game.seat_specs = {p.pid: args.seat_models[i] for i, p in enumerate(game.players)}
    else:
        game = lobby.start(out)
    if args.pace == "human" and args.mode == "ticks":
        game.pace = dict(HUMAN_PACE)
    if args.tick_delay and args.mode == "ticks":
        orig = game.roam_tick

        async def slow():
            r = await orig()
            await asyncio.sleep(args.tick_delay)
            return r
        game.roam_tick = slow
    r = await game.run()
    llm = [a for a in game.agents.values() if hasattr(a, "cost")] if isinstance(game.agents, dict) else \
          [a for a in game.agents if hasattr(a, "cost")]
    if llm:
        r["llm_cost_usd"] = round(sum(a.cost for a in llm), 5)
        r["llm_calls"] = sum(a.calls for a in llm)
        from .llm_agent import close_clients
        await close_clients()
    return r


def _sigterm(*_):
    raise KeyboardInterrupt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=1)
    ap.add_argument("--players", type=int, default=10)
    ap.add_argument("--impostors", type=int, default=2)
    ap.add_argument("--agents", default="rules", help="rules | random | llm, or a comma list cycled over seats")
    ap.add_argument("--model", default="openai/gpt-oss-20b")
    ap.add_argument("--models", default="", help="realtime: comma list of provider:model, one per seat (cycled), e.g. "
                    "claude:claude-haiku-5-5,groq:openai/gpt-oss-120b,nvidia:nvidia/nemotron-3.5-bolt-e4b,openai:gpt-5.4-nano")
    ap.add_argument("--rounds", type=int, default=4)
    ap.add_argument("--vote-mode", default="sealed", choices=["sealed", "sequential"])
    ap.add_argument("--no-confirm-ejects", action="store_true")
    ap.add_argument("--max-ticks", type=int, default=600)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--name", default=None)
    ap.add_argument("--tick-delay", type=float, default=0.0)
    ap.add_argument("--mode", default="ticks", choices=["ticks", "realtime"],
                    help="ticks = research engine (turns); realtime = free joystick movement, live chat meetings")
    ap.add_argument("--keep-order", action="store_true", help="realtime: seats get --models in the given order (already drawn)")
    ap.add_argument("--model-names", action="store_true", help="realtime: players are named after their model, model colours")
    ap.add_argument("--pool", default="", help="realtime: the model pool the seats were drawn from (shown in the draw)")
    ap.add_argument("--commentary", action="store_true", help="realtime: a Claude Haiku commentator writes one line for the audience now and then")
    ap.add_argument("--fast", action="store_true", help="realtime mode without the wall clock (rule agents, tests)")
    ap.add_argument("--discussion", type=float, default=None, help="realtime: discussion seconds (default: the mode's, 15)")
    ap.add_argument("--voting", type=float, default=None, help="realtime: voting seconds (default: the mode's, 90)")
    ap.add_argument("--variant", default="classic", help="realtime game mode: classic | blackout | rush | double | jester | marathon")
    ap.add_argument("--brain", default="pure", choices=["pure", "coached"],
                    help="pure = rulebook only (research baseline); coached = playbook + one style per seat + memory aids")
    ap.add_argument("--pace", default="fast", choices=["fast", "human"],
                    help="human = wall-clock pauses like real players (~3 s ticks, typing, staggered votes) for live watching")
    ap.add_argument("--budget", type=float, default=1.0, help="hard USD cap for all Claude calls in this run")
    ap.add_argument("--effort", default="low", help="Claude effort: low | medium | high")
    args = ap.parse_args()
    # serve.py / kill send SIGTERM: treat it like Ctrl+C so the spend is flushed and printed
    signal.signal(signal.SIGTERM, _sigterm)
    if "llm" in args.agents or args.commentary:
        from .llm_agent import BUDGET
        BUDGET.cap_usd = args.budget
    name = args.name or time.strftime("%Y%m%d-%H%M%S")
    results = []
    for g in range(args.games):
        if "llm" in args.agents:
            from .llm_agent import BUDGET
            if BUDGET.spent >= 0.8 * BUDGET.cap_usd:
                print(f"budget: ${BUDGET.spent:.4f} of ${BUDGET.cap_usd:.2f} used, not starting game {g + 1}")
                break
        out = ROOT / "runs" / name / f"game-{g + 1}"
        os.environ["NS_BUDGET_FILE"] = str(ROOT / "runs" / name / "spend.json")
        try:
            r = asyncio.run(play(args.seed + g, args, out))
        except KeyboardInterrupt:
            if "llm" in args.agents or args.commentary:
                from .llm_agent import BUDGET
                BUDGET.flush()
                print(f"stopped by hand: spent ${BUDGET.spent:.4f} of ${BUDGET.cap_usd:.2f} cap, "
                      f"{BUDGET.calls} calls (saved in runs/{name}/spend.json)")
            raise SystemExit(130)
        r["dir"] = str(out.relative_to(ROOT))
        results.append(r)
        flag = "" if r["fallbacks"] == 0 else "  INVALID (fallbacks > 0)"
        print(f"game {g + 1}: {r['winner']} ({r['reason']}), {r['ticks']} ticks, {r['meetings']} meetings, "
              f"invalid actions {r['invalid_actions']}, fallbacks {r['fallbacks']}{flag}"
              + (f", ${r['llm_cost_usd']:.4f} / {r['llm_calls']} calls" if "llm_cost_usd" in r else "") + f"  -> {r['dir']}")
    summary = {"games": results}
    if "llm" in args.agents:
        from .llm_agent import BUDGET
        summary["budget"] = BUDGET.summary()
        print(f"budget: spent ${BUDGET.spent:.4f} of ${BUDGET.cap_usd:.2f} cap, {BUDGET.calls} calls, tokens {BUDGET.tokens}")
    (ROOT / "runs" / name / "summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
