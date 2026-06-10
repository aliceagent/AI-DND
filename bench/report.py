"""Collate results.jsonl into RESULTS.md with a PASS/FAIL verdict per gate."""
import json, pathlib
from common import ROOT, CFG

rows = [json.loads(l) for l in (ROOT / CFG["bench"]["results_file"]).read_text().splitlines()]
latest = {}
for r in rows:
    latest[r["bench"]] = r  # last run of each bench wins

lines = ["# Hermys Phase 0 — Results\n"]
all_ok = True
for name in ["residency", "cache", "turn", "window"]:
    r = latest.get(name)
    if not r:
        lines.append(f"## {name}\n_not run_\n"); all_ok = False; continue
    ok = all(r["gates"].values()); all_ok &= ok
    lines.append(f"## {name} — {'PASS ✅' if ok else 'FAIL ❌'}\n")
    lines.append("```json\n" + json.dumps(r["summary"], indent=2) + "\n```\n")
    for g, v in r["gates"].items():
        lines.append(f"- gate `{g}`: {'pass' if v else '**fail**'}")
    lines.append("")

lines.append("---\n**Verdict: " + ("GO — proceed to Phase 1**"
             if all_ok else "NO-GO — work the §4.3 fallback ladder**"))
(ROOT / "RESULTS.md").write_text("\n".join(lines))
print("\n".join(lines))
