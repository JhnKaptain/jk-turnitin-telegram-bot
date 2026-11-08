# Plagiarism provider: Quetext or JK SimilarityCheck

The bot can check similarity with **Quetext** (as before) or **JK SimilarityCheck**.
Both return the same result shape, so reports look exactly the same either way.

## Render environment variables (bot service)

| Variable | Example | Purpose |
|---|---|---|
| `PLAGIARISM_PROVIDER` | `quetext` or `jksimilarity` | Default provider. Not set = Quetext. |
| `JK_SIMILARITY_URL` | `https://jk-similaritycheck.onrender.com` | JK SimilarityCheck address |
| `JK_SIMILARITY_API_KEY` | (secret) | The bot's key, from `JK_API_KEYS` on the JK SimilarityCheck service |
| `PLAGIARISM_FALLBACK` | `quetext` | Optional. If a JK SimilarityCheck scan fails, retry once on Quetext (uses Quetext credit). |
| `JK_SIMILARITY_MIN_WORDS` | `8` | Optional smallest match; otherwise the JK SimilarityCheck default. |

Changing a Render variable restarts the bot (about a minute).

## Switching from Telegram (admin only)

`/plagiarism` shows the provider in use and has buttons:

- **Quetext** / **JK SimilarityCheck**: switch now. Saved in `DATA_DIR`, so it survives
  restarts and deploys, and overrides the Render setting.
- **Use Render setting**: clear the Telegram choice; `PLAGIARISM_PROVIDER` applies again.
- **Test JK SimilarityCheck**: checks the address and key without scanning anything.

The switch applies to new scans; scans already running finish on the provider they started on.

## Test offline

```
node test-jksimilarity-provider.cjs
```
