"""Bench 3 — prompt-cache effectiveness on the Director's static block.

Cold call (fresh static prefix) vs warm call (identical prefix, new tail).
Gate: warm TTFT <= 25% of cold TTFT. llama.cpp: cache_prompt=true reuses the
KV prefix; vLLM does this automatically (automatic prefix caching).
"""
import json, statistics as st
from common import CFG, log_result, chat_stream, DIRECTOR_STATIC, DIRECTOR_TOOLS


def ttft(messages):
    for ev, d in chat_stream(messages, 64, tools=DIRECTOR_TOOLS):
        if ev == "first_token":
            return d["ttft_s"]
    return float("inf")


def main():
    # Cold: bust the cache by salting the prefix
    cold_msgs = [{"role": "system", "content": "SALT-COLD-RUN\n" + DIRECTOR_STATIC},
                 {"role": "user", "content": "DECLARATION: I kick the door."}]
    cold = ttft(cold_msgs)

    base = [{"role": "system", "content": DIRECTOR_STATIC}]
    ttft(base + [{"role": "user", "content": "warm-up"}])  # populate cache
    warms = [ttft(base + [{"role": "user", "content": f"DECLARATION {i}: I search the cart."}])
             for i in range(5)]
    warm = st.median(warms)

    ratio = warm / max(cold, 1e-6)
    gates = {"warm_ratio": ratio <= CFG["gates"]["warm_ttft_ratio"]}
    summary = {"cold_ttft_s": cold, "warm_ttft_s_p50": warm, "ratio": ratio}
    log_result("cache", {"summary": summary, "gates": gates})
    print(json.dumps({"summary": summary, "gates": gates}, indent=2))
    print("PASS" if all(gates.values()) else
          "FAIL — verify cache_prompt / prefix caching is actually engaged")


if __name__ == "__main__":
    main()
