#!/usr/bin/env python3
"""Digest of how you use Claude Code in a project, plus a snapshot of the project.

Read-only. Prints compact markdown so an advisor can read it in one go instead of
opening megabytes of transcripts. Nothing is sent anywhere.

usage: digest.py [--cwd DIR] [--sessions N] [--others N]
"""
import argparse, collections, json, os, re, subprocess, sys, time

STOP = set("""a an the and or but if then so to of in on at for with from by is are was were be been
it its this that these those i you we they he she my your our me us do does did done can could
would should will just not no yes ok okay please also now how what why when where which who
have has had get got make made let lets use using need want like some any all more most than
into out up down over about as there here them their one two""".split())
TOOLISH = re.compile(r"^\s*(<command-|<local-command|<task-notification|Caveat:|\[Request interrupted)")
HOOKY = re.compile(r"\b(from now on|every time|each time|whenever|after (every|each|you)|before (every|each|you) (commit|push|edit|run|finish))\b", re.I)
RULEY = re.compile(r"\b(always|never|don'?t ever|do not ever|make sure (you|to|that)|remember to|please don'?t|stop (doing|using|adding))\b", re.I)
CORRECT = re.compile(r"^\s*(no[,.! ]|nope|wrong|that'?s not|not what|don'?t|stop|undo|revert|actually[, ])", re.I)
EDITS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", "target", ".idea", ".cache"}


def clip(s, n=220):
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def command_key(cmd):
    cmd = (cmd or "").split("\n")[0].strip()
    cmd = re.sub(r"^cd\s+\S+\s*(&&|;)\s*", "", cmd)
    cmd = re.split(r"\s*(?:&&|\|\||\||;)\s*", cmd)[0]
    t = cmd.split()
    if not t or re.match(r"^[A-Z_]+=", t[0]):
        return None
    name = os.path.basename(t[0])
    if name in {"git", "npm", "pnpm", "yarn", "bun", "npx", "gh", "docker", "cargo", "go", "make", "pip", "uv", "kubectl"}:
        if name in {"npm", "pnpm", "yarn", "bun"} and len(t) > 2 and t[1] == "run":
            return f"{name} run {t[2]}"
        return f"{name} {t[1]}" if len(t) > 1 and not t[1].startswith("-") else name
    return name


def read_sessions(path):
    """Yield (role, text, tools) from one transcript, tolerating bad lines."""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not line.startswith("{"):
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("isMeta") or row.get("type") not in ("user", "assistant"):
                continue
            content = (row.get("message") or {}).get("content")
            blocks = [{"type": "text", "text": content}] if isinstance(content, str) else (content or [])
            text = "\n".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
            tools = [b for b in blocks if isinstance(b, dict) and b.get("type") == "tool_use"]
            text = re.sub(r"<system-reminder>[\s\S]*?</system-reminder>", "", text).strip()
            if row["type"] == "user":
                if text and not TOOLISH.match(text):
                    yield "user", text, []
            elif text or tools:
                yield "assistant", text, tools


def top(counter, n):
    return counter.most_common(n)


def history(cwd, max_sessions, max_others):
    root = os.path.expanduser("~/.claude/projects")
    here = re.sub(r"[^a-zA-Z0-9]", "-", cwd)
    mine, others = [], []
    if os.path.isdir(root):
        for d in os.listdir(root):
            p = os.path.join(root, d)
            if not os.path.isdir(p):
                continue
            for f in os.listdir(p):
                if f.endswith(".jsonl"):
                    fp = os.path.join(p, f)
                    (mine if d == here else others).append((os.path.getmtime(fp), fp))
    mine.sort(reverse=True)
    others.sort(reverse=True)
    picked = [(True, fp) for _, fp in mine[:max_sessions]] + [(False, fp) for _, fp in others[:max_others]]

    prompts, tool_ct, cmd_ct, edit_ct, read_ct = [], collections.Counter(), collections.Counter(), collections.Counter(), collections.Counter()
    words = collections.Counter()
    first_words = collections.defaultdict(list)
    for is_here, fp in picked:
        sid = os.path.basename(fp)[:8]
        try:
            for role, text, tools in read_sessions(fp):
                if role == "user":
                    prompts.append((is_here, sid, text))
                    w = re.findall(r"[a-z][a-z0-9_-]{2,}", text.lower())
                    words.update(x for x in w if x not in STOP)
                    fw = " ".join(re.sub(r"[^a-z0-9\s]", " ", text.lower()).split()[:5])
                    if len(text.split()) >= 4 and not text.startswith("/"):
                        first_words[fw].append(clip(text, 160))
                for t in tools:
                    name, inp = t.get("name", "?"), t.get("input") or {}
                    tool_ct[name] += 1
                    if name == "Bash":
                        k = command_key(inp.get("command"))
                        if k:
                            cmd_ct[k] += 1
                    fpth = inp.get("file_path")
                    if isinstance(fpth, str):
                        rel = fpth[len(cwd) + 1:] if fpth.startswith(cwd + "/") else fpth
                        if name in EDITS:
                            edit_ct[rel] += 1
                        elif name == "Read":
                            read_ct[rel] += 1
        except OSError:
            continue

    out = ["## Claude Code history"]
    n_here = sum(1 for h, _ in picked if h)
    out.append(f"Sessions read: {n_here} of this project, {len(picked) - n_here} from other projects. User prompts: {len(prompts)}.")
    if not prompts:
        out.append("(No past sessions found. Base advice on the project snapshot only, and say so.)")
        return "\n".join(out)
    out.append("\n### Tool usage\n" + ", ".join(f"{k} {v}" for k, v in top(tool_ct, 10)))
    out.append("\n### Commands Claude ran most\n" + "\n".join(f"- {k} — {v}×" for k, v in top(cmd_ct, 15)))
    out.append("\n### Files edited most (this project)\n" + "\n".join(f"- {k} — {v}×" for k, v in top(edit_ct, 15)))
    dirs = collections.Counter()
    for k, v in edit_ct.items():
        dirs["/".join(k.split("/")[:2])] += v
    out.append("\n### Folders edited most\n" + "\n".join(f"- {k}/ — {v}×" for k, v in top(dirs, 8)))
    out.append("\n### Files read repeatedly\n" + "\n".join(f"- {k} — {v}×" for k, v in top(read_ct, 10) if v >= 4))
    rep = [(k, v) for k, v in first_words.items() if len(v) >= 3]
    rep.sort(key=lambda kv: -len(kv[1]))
    out.append("\n### Prompts that start the same way (candidate skills / commands)\n" +
               "\n".join(f"- ×{len(v)}: {v[0]}" for k, v in rep[:8]))
    texts = [t for _, _, t in prompts]
    hooky = [t for t in texts if HOOKY.search(t)][:10]
    ruley = [t for t in texts if RULEY.search(t) and not HOOKY.search(t)][:12]
    out.append("\n### 'Every time / from now on' requests (candidate hooks)\n" + "\n".join("- " + clip(t, 200) for t in hooky))
    out.append("\n### Standing rules you stated (candidate CLAUDE.md lines)\n" + "\n".join("- " + clip(t, 200) for t in ruley))
    out.append("\n### Corrections (things Claude got wrong)\n" +
               "\n".join("- " + clip(t, 200) for t in [t for t in texts if CORRECT.match(t) and len(t) < 400][:10]))
    out.append("\n### Topics you talk about most\n" + ", ".join(f"{k} ({v})" for k, v in top(words, 30)))
    # prompts: newest 40 of this project, then a spread of older ones
    mine = [p for p in prompts if p[0]]
    recent = mine[-40:]
    older = mine[:-40]
    step = max(1, len(older) // 25)
    out.append("\n### Your prompts, newest last (this project)\n" +
               "\n".join(f"- [{sid}] {clip(t, 200)}" for _, sid, t in (older[::step][:25] + recent)))
    return "\n".join(out)


def sh(cmd, cwd, timeout=15):
    try:
        return subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except Exception:
        return ""


def snapshot(cwd):
    out = ["## Project snapshot", f"Folder: {cwd}"]
    entries = sorted(e for e in os.listdir(cwd) if e not in SKIP_DIRS)
    out.append("Top level: " + ", ".join(entries[:60]))
    # two levels of tree
    tree = []
    for e in entries:
        p = os.path.join(cwd, e)
        if os.path.isdir(p) and not e.startswith("."):
            try:
                kids = sorted(k for k in os.listdir(p) if k not in SKIP_DIRS)[:12]
            except OSError:
                continue
            tree.append(f"- {e}/ → {', '.join(kids)}")
    out.append("\n### Folders\n" + "\n".join(tree[:30]))
    for name in ("package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "pom.xml", "Makefile"):
        p = os.path.join(cwd, name)
        if os.path.isfile(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                out.append(f"\n### {name}\n```\n{f.read(2500)}\n```")
    for name in ("README.md", "CLAUDE.md", "DESIGN.md"):
        p = os.path.join(cwd, name)
        if os.path.isfile(p):
            with open(p, encoding="utf-8", errors="replace") as f:
                body = f.read()
            heads = [l for l in body.splitlines() if l.startswith("#")][:15]
            out.append(f"\n### {name} ({len(body)} chars)\nHeadings: {' | '.join(heads) or '(none)'}\n" + (clip(body, 600) if name == "README.md" else ""))
        elif name != "README.md":
            out.append(f"\n### {name}\nNOT PRESENT")
    env = [e for e in entries if e == ".env" or e.startswith(".env.")]
    out.append("\n### Risks\n" + f".env files present: {env or 'none'} (names only; contents were not read)")
    claude = []
    for sub in ("agents", "skills", "commands"):
        for base in (os.path.join(cwd, ".claude", sub), os.path.expanduser(f"~/.claude/{sub}")):
            if os.path.isdir(base):
                claude.append(f"{base}: {', '.join(sorted(os.listdir(base))[:20])}")
    out.append("\n### Existing Claude Code setup\n" + ("\n".join(claude) or "No custom subagents, skills or commands yet."))
    for p in (os.path.join(cwd, ".claude", "settings.json"), os.path.join(cwd, ".claude", "settings.local.json"), os.path.expanduser("~/.claude/settings.json")):
        if os.path.isfile(p):
            try:
                s = json.load(open(p))
                out.append(f"{p}: keys={list(s.keys())}; hooks={'yes' if s.get('hooks') else 'no'}; allow rules={len((s.get('permissions') or {}).get('allow', []))}")
            except ValueError:
                pass
    out.append(".mcp.json: " + ("present" if os.path.isfile(os.path.join(cwd, ".mcp.json")) else "absent"))
    mk = os.path.expanduser("~/.claude/plugins/marketplaces")
    if os.path.isdir(mk):
        names = []
        for m in sorted(os.listdir(mk)):
            mp = os.path.join(mk, m, ".claude-plugin", "marketplace.json")
            if os.path.isfile(mp):
                try:
                    for pl in json.load(open(mp)).get("plugins", []):
                        names.append(f"{pl.get('name')}@{m}: {clip(pl.get('description', ''), 90)}")
                except ValueError:
                    pass
        out.append("\n### Plugins available in your marketplaces (real names only)\n" + "\n".join("- " + n for n in names[:60]))
    git = sh("git rev-parse --is-inside-work-tree", cwd)
    if git == "true":
        out.append("\n### Git: recent commits\n" + sh("git log -n 25 --pretty=format:'%s'", cwd))
        churn = collections.Counter(l for l in sh("git log -n 150 --name-only --pretty=format:", cwd).splitlines() if l)
        out.append("\n### Git: files that change most (last 150 commits)\n" + "\n".join(f"- {k} — {v}×" for k, v in top(churn, 12)))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--sessions", type=int, default=40)
    ap.add_argument("--others", type=int, default=10)
    a = ap.parse_args()
    cwd = os.path.abspath(a.cwd)
    print(snapshot(cwd))
    print()
    print(history(cwd, a.sessions, a.others))


if __name__ == "__main__":
    main()
