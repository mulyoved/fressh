# E2E Screenshot Capture

Runs screenshot capture test using defaults from config file.

## Usage

```bash
./scripts/capture-screenshot.sh
```

**Note:** Tests can take up to 3 minutes to complete, especially with complex pages or slow network conditions. Please wait for the test to finish.

## Configuration

Edit `scripts/.screenshot-defaults.json` to set URL, action, and video recording:

```json
{
  "url": "http://localhost:3007/path/to/page",
  "action": "action-name",
  "video": false
}
```

Set `"video": true` to enable video recording for debugging complex actions.

## Output

Screenshot saved to: `test-results/screenshots/page-screenshot.png`

## Debugging Failed Tests

### Quick Debugging with Trace Analysis

Use the trace analysis script to quickly debug failures:

```bash
# Analyze the latest trace file
./scripts/analyze-trace.sh

# Search for specific text in DOM snapshots
./scripts/analyze-trace.sh -s "Future"

# Extract all HTML snapshots
./scripts/analyze-trace.sh -h

# Show all errors
./scripts/analyze-trace.sh -e

# Combine options
./scripts/analyze-trace.sh -s "combobox" -h -e
```

### Understanding Trace Files

**Location**: `test-results/.playwright-artifacts-0/traces/*.trace`

The trace file contains:

- Complete DOM snapshots at each action
- Browser console logs (all levels)
- Network requests and responses
- Error events with stack traces
- Screenshots at each step

### Common Debugging Patterns

**Element Selection Issues:**

```typescript
// Add to your action to debug selectors
const allMatches = await page.locator("your-selector").all();
console.log(`Found ${allMatches.length} elements`);
for (const el of allMatches) {
  console.log("Element HTML:", await el.innerHTML());
  console.log("Element text:", await el.textContent());
}
```

**DOM Dump on Failure:**

```typescript
try {
  await page.locator("selector").click();
} catch (error) {
  // Dump the relevant DOM section
  const html = await page.content();
  console.log("Page HTML:", html);
  throw error;
}
```

### Error Artifacts

- **Screenshots**: `test-results/screenshots/*-error.png`
- **Videos**: `test-results/.playwright-artifacts-0/*.webm` (when enabled)
- **Console Output**: Live in terminal during execution

### Best Practices for Debugging

1. **Use flexible selectors**: Prefer `page.getByRole()` over strict CSS selectors
2. **Add wait conditions**: Ensure elements are ready before interacting
3. **Log intermediate states**: Add `testLog()` calls to track progress
4. **Check innerHTML vs textContent**: Sometimes text is nested in child elements
5. **Use case-insensitive matching**: `.filter({ hasText: /text/i })`

### Quick Debugging Workflow

When a test fails with a selector issue:

1. **First, analyze the trace to see the actual DOM**:

   ```bash
   # Search for your expected text
   ./scripts/analyze-trace.sh -s "Future"

   # If not found, extract full HTML
   ./scripts/analyze-trace.sh -h
   grep -i "your-text" /tmp/snapshot_*.html
   ```

2. **Common selector fixes**:

   ```typescript
   // Instead of strict text matching:
   page.locator("button").filter({ hasText: "FUTURE" });

   // Use flexible matching:
   page.locator("button").filter({ hasText: /future/i });
   page.locator('button:has-text("Future")');
   page.locator("button").getByText(/future/i);
   ```

3. **Debug element properties**:
   ```typescript
   // Log all matching elements before filtering
   const buttons = await page.locator('button[role="combobox"]').all();
   for (const btn of buttons) {
     console.log("Text:", await btn.textContent());
     console.log("HTML:", await btn.innerHTML());
   }
   ```
