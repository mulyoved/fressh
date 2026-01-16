---
description: "Fetch Braintrust session logs and save to docs/design/*.md"
allowed-tools: "Bash(*), Read(*), Write(*)"
---

# Braintrust Get Logs

Fetch session logs from Braintrust and save them in structured format.

## Usage

```
/braintrust-get-logs <session-id> [options]
```

## Arguments

Parse from: `$ARGUMENTS`

The first argument is the **session ID** (root_span_id) to fetch.

Optional flags can follow:
- `--outputDir=<path>` - Output directory (default: `docs/design`)
- `--format=<type>` - Output format: `markdown`, `json`, or `both` (default: `both`)
- `--maxTurns=<n>` - Max conversation turns in markdown (default: 50)

## Examples

```bash
# Fetch session with default settings
/braintrust-get-logs 184689cd-69ed-43bc-a181-f2c5e3c21d05

# Fetch with custom output directory
/braintrust-get-logs 184689cd-69ed-43bc-a181-f2c5e3c21d05 --outputDir=docs/sessions

# Fetch only JSON
/braintrust-get-logs 184689cd-69ed-43bc-a181-f2c5e3c21d05 --format=json
```

## Workflow

1. Parse the session ID from `$ARGUMENTS`
2. Run the fetch script:
   ```bash
   yarn tsx .claude/skills/braintrust-get-logs/scripts/fetch-logs.ts \
     --sessionId=<session-id> $ARGUMENTS
   ```
3. Report the output files created

## Output

Creates two files in the output directory:
- `braintrust-session-<short-id>.md` - Formatted markdown summary
- `braintrust-session-<short-id>-raw.json` - Complete raw JSON data

## Requirements

- `BRAINTRUST_API_KEY` environment variable must be set
- `BRAINTRUST_CC_PROJECT` optionally set for default project
