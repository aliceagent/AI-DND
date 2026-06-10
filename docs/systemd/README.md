# systemd units — Spark service supervision (drafts)

Drafted on the Mac so Spark day one is copy-edit-enable, not authoring.
The launchd pattern from the owner's Mac stack, ported. Install:

```bash
sudo cp docs/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hermys-llama hermys-litellm hermys-orchestrator
```

Edit paths/users before enabling — every unit assumes the repo at
`/opt/hermys` and a `hermys` service user. GPU residency math is in the
build plan §4.3; the model serving flags are placeholders until the bench
locks them.

| Unit | Role | Port |
|---|---|---|
| `hermys-llama.service` | llama.cpp server, GPT-OSS-120B MXFP4 | 8081 |
| `hermys-litellm.service` | LiteLLM router: director/narrator routes | 4000 |
| `hermys-orchestrator.service` | WebSocket hub + PWA over mkcert TLS | 8443 |

The media workers (faster-whisper, Kokoro, SDXL) get units when the spark
MediaService lands (docs/spark-day-one.md step 9) — their process shape
isn't fixed yet.
