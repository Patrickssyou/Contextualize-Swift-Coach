#!/usr/bin/env python3
"""Build dist/pizza-support-qa-desk.html from src/template.html + src/rubric_v1.json + src/core.js, then syntax-check the script."""
import json, re, subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = lambda *p: os.path.join(ROOT, "src", *p)
tpl = open(src("template.html"), encoding="utf-8").read()

# v1 rubric, kept so the first audits still score
obj = json.load(open(src("rubric_v1.json"), encoding="utf-8"))
assert "__RUBRIC_V1__" in tpl
tpl = tpl.replace("__RUBRIC_V1__", json.dumps(obj, ensure_ascii=False, separators=(",", ":")))

# shared core (sampling, linking, prompts), also loaded by the node tests
core = open(src("core.js"), encoding="utf-8").read()
m = re.search(r"/\* PULL-CORE START \*/\n(.*?)/\* PULL-CORE END \*/", core, re.S)
assert m and "/*__PULL_CORE__*/" in tpl
tpl = tpl.replace("/*__PULL_CORE__*/", m.group(1).rstrip())

# chat brain (WIRA chats), also loaded by the node tests
chat = open(src("chat.js"), encoding="utf-8").read()
m = re.search(r"/\* CHAT-CORE START \*/\n(.*?)/\* CHAT-CORE END \*/", chat, re.S)
assert m and "/*__PULL_CORE__*/" not in tpl
if "/*__CHAT_CORE__*/" in tpl:
    tpl = tpl.replace("/*__CHAT_CORE__*/", m.group(1).rstrip())
else:
    print("note: template has no /*__CHAT_CORE__*/ marker yet; chat brain not injected")

os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", "pizza-support-qa-desk.html")
open(out, "w", encoding="utf-8").write(tpl)

js = re.search(r"<script>(.*?)</script>", tpl, re.S).group(1)
chk = os.path.join(ROOT, "dist", "app.check.js")
open(chk, "w", encoding="utf-8").write(js)
r = subprocess.run(["node", "--check", chk], capture_output=True, text=True)
if r.returncode:
    print(r.stderr); sys.exit(1)
print("built", os.path.relpath(out, ROOT), len(tpl.encode("utf-8")), "bytes; script OK")
