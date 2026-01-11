---
description: Get external LLM review of commission plan parsing quality (MCP-Zen and/or GPT-5 Pro)
allowed-tools: Bash(*), mcp__zen__chat, mcp__zen__codereview, Read(*)
---

# /second-opinion

Get a second opinion on commission plan parsing quality from external LLMs.

## Usage

```
/second-opinion <planId>                          # Both providers (default)
/second-opinion <planId> --provider=zen           # Zen only
/second-opinion <planId> --provider=gpt5          # GPT-5 only
/second-opinion <planId> --type=code              # Code review only
/second-opinion <planId> --type=english           # English description only
/second-opinion <planId> --type=contract          # Contract alignment only
```

## Arguments

- `planId`: Commission plan ID (cmp_xxx format) - **REQUIRED**
- `--provider`: Which external LLM to use: `zen`, `gpt5`, or `both` (default: `both`)
- `--type`: What to review: `code`, `english`, `contract`, or `full` (default: `full`)
- `--tailscale`: Add this flag to copy GPT-5 file via Tailscale

## Workflow

### Step 1: Generate Prompts

Run the external-review script to get prompts for both providers:

```bash
yarn tsx scripts/external-review.ts --planId=$PLAN_ID --provider=$PROVIDER --output=json
```

Parse the JSON output to get:
- `providers.zen.prompt` - Prompt for mcp__zen__chat
- `providers.gpt5.promptFile` - File path for GPT-5 Pro

### Step 2: MCP-Zen Review (if provider includes zen)

Call `mcp__zen__chat` with the zen prompt:

```
mcp__zen__chat(
  prompt: <zen prompt from script output>,
  working_directory_absolute_path: "<project_root>/app",
  thinking_mode: "high"
)
```

Capture the response as `zenFindings`.

### Step 3: GPT-5 Pro Review (if provider includes gpt5)

1. Inform user of the prompt file location from script output
2. If `--tailscale` was specified, the file is already sent
3. Ask user to:
   - Open the file / accept Tailscale transfer
   - Paste contents into GPT-5 Pro
   - Share the response back

Wait for user to provide GPT-5 Pro response as `gpt5Findings`.

### Step 4: Synthesize Results

Combine findings from both sources into a unified report:

```markdown
## Second Opinion Review Summary

**Plan ID**: $PLAN_ID
**Providers Used**: [Zen/GPT-5/Both]

### Agreement
Issues found by BOTH reviewers:
- [List issues both agree on]

### Zen-Only Findings
Issues found only by MCP-Zen:
- [List]

### GPT-5 Pro-Only Findings
Issues found only by GPT-5 Pro:
- [List]

### Consolidated Assessment

| Aspect | Zen | GPT-5 | Consensus |
|--------|-----|-------|-----------|
| Code Generation | PASS/WARN/FAIL | PASS/WARN/FAIL | ... |
| English Description | PASS/WARN/FAIL | PASS/WARN/FAIL | ... |
| Contract Alignment | PASS/WARN/FAIL | PASS/WARN/FAIL | ... |

### Final Verdict: PASS / NEEDS_CLARIFICATION / FAIL

**Rationale**: [1-2 sentence explanation based on consensus]

### Priority Fixes
1. [Most critical - agreed by both or high severity]
2. [Second priority]
3. [Third priority]
```

## Example Session

```
User: /second-opinion cmp_abc123

Claude: Running external review for plan cmp_abc123...

[Runs script, gets prompts]

Starting MCP-Zen review...
[Calls mcp__zen__chat, gets response]

GPT-5 Pro prompt generated: /tmp/gpt5-pro-review-sales-plan.txt

To get GPT-5 Pro's opinion:
1. Open /tmp/gpt5-pro-review-sales-plan.txt
2. Copy contents to GPT-5 Pro
3. Paste the response here

User: [Pastes GPT-5 Pro response]

Claude: [Synthesizes both reviews into unified report]
```

## Error Handling

- **If MCP-Zen fails**: Continue with GPT-5 only, note in report
- **If user skips GPT-5**: Continue with Zen only, note in report
- **If both fail**: Report error, suggest manual review

## Related

- **Script**: `scripts/external-review.ts` - Generates all prompts
- **Skill**: `plan-parsing-analyzer` - Full plan analysis workflow
