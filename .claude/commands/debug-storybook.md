---
allowed-tools: Bash(scripts/debug-storybook-element.mjs:*)
description: Debug and fix Storybook story - provide URL and problem description
---

# Debug Storybook Story

## Usage

Provide the Storybook URL and problem description:

- Format: `/debug-storybook <storybook-url> "<problem-description>"`
- Example: `/debug-storybook http://localhost:6006/?path=/story/components-button--primary "button not rendering correctly"`

## Current Investigation

**Story URL:** $ARGUMENTS (first argument should be the URL)
**Problem:** $ARGUMENTS (describe the issue you're seeing)

## Debug Process

I'll use the debug script to analyze your Storybook story:

example `STORY_URL="$ARGUMENTS" node scripts/debug-storybook-element.mjs`

## ⚠️ CRITICAL: ONLY USE THE EXISTING DEBUG SCRIPT

**ABSOLUTELY FORBIDDEN:**
- ❌ Creating new test scripts, puppeteer tests, or custom debugging code
- ❌ Writing ad-hoc node scripts with puppeteer
- ❌ Creating custom interaction scripts  
- ❌ Writing any new testing code whatsoever

**ONLY ALLOWED:**
- ✅ Use `STORY_URL="<url>" node scripts/debug-storybook-element.mjs` ONLY
- ✅ Add console.log to component code, then re-run existing script
- ✅ Suggest modifications to existing `debug-storybook-element.mjs`

**Why this restriction exists:**
- The existing script captures ALL necessary data
- Ad-hoc scripts are inefficient and usually break
- Console messages are automatically captured by existing script
- Creating new scripts wastes time and violates the command intent

**The existing script provides:**
- Complete DOM analysis (all elements, styles, properties)  
- **Full browser console log capture** (errors, warnings, debug logs)
- **Storybook Interactions panel capture** (play function execution status)
- JSON output with all debugging data
- Screenshot capture for visual analysis

**Debugging workflow (ONLY approved method):**
1. Run existing script ONLY: `STORY_URL="<url>" node scripts/debug-storybook-element.mjs`
2. If more info needed: Add console.log to component → Re-run existing script
3. Examine output and debug-output.json for all captured data
4. Make code fixes based on analysis

## Play Function Debugging

The script now captures **Storybook Interactions panel data**, showing:

- ✅ **Completed steps** (green checkmarks)  
- 🔵 **Active/running steps** (blue play icons)
- ⏸️ **Waiting/stuck steps** (gray waiting icons)
- ❓ **Unknown status steps**

**Common play function issues:**
- **Stuck on `findByRole("dialog")`** → Dialog not opening, use `queryAllByRole` instead
- **Stuck on element selectors** → Element not found, check selector accuracy
- **Timing issues** → Add appropriate `waitFor` or `setTimeout` delays

**Example output:**
```
🎭 Capturing Storybook Interactions...
📊 Found 4 interaction steps:
  ✅ Step 1: within(<div#storybook-root>).findAllByRole("tab")
  ✅ Step 2: userEvent.click(<button>)
  ✅ Step 3: within(<div#storybook-root>).findAllByRole("button")  
  ⏸️ Step 4: within(<div#storybook-root>).findByRole("dialog")
```

## Analysis

Based on the debug output above, I'll:

1. Analyze the element structure and DOM properties
2. Check for console errors or warnings (automatically captured)
3. Examine styling and visibility issues
4. Identify potential fixes for the reported problem
5. Suggest specific code changes if needed

Please provide both the Storybook URL and a description of the problem you're experiencing.
