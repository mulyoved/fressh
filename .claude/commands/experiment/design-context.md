# Design Context Generation Prompt

## Purpose
This prompt generates comprehensive but conservative implementation plan documents that balance thoroughness with actionability. Refined through iterative feedback to avoid bloated documentation while maintaining all essential information.

## The Optimal Prompt Pattern

```
I need to create a comprehensive implementation plan document for [FEATURE/QUESTION]. 

Please analyze the codebase and create a design document that includes:

1. **Executive Summary** - Brief overview of the feature/change
2. **Current State Analysis** - What exists now, key components, patterns
3. **Implementation Plan** - Phased approach with specific steps
4. **Essential Code References** - BUT be conservative about file inclusion

For the Code References section specifically:
- Include ONLY 4-6 essential files maximum
- Focus on core implementation files, not auxiliary ones
- Specify exact line ranges only when critical (e.g., interface definitions)
- Use FILE_REFERENCES_START/END markers for expansion script compatibility

EXCLUDE:
- Config files (tsconfig.json, package.json, tailwind.config.ts)
- Test files and testing patterns
- UI library components (card, badge, button, collapsible)
- Debug scripts and auxiliary development tools
- Multiple redundant mock data files
- Storybook stories and testing utilities

INCLUDE ONLY:
- Main components that need modification
- Core utility functions with specific function names
- Essential type definitions with line ranges
- One clear mock data example for patterns
- Key integration points between components

Key constraints:
- Be conservative - include only what's truly needed for implementation
- Avoid redundant examples and verbose explanations  
- Focus on "what needs to be understood" not "everything available"
- Keep the document actionable and focused
- Maintain compatibility with scripts/expand-file-references.mjs
- Reduce final document size while preserving all critical implementation details
```

## Usage Instructions

1. Replace `[FEATURE/QUESTION]` with your specific implementation need
2. Run the prompt to generate initial design document
3. Save the document to `docs/design/[feature-name]-implementation-plan.md`
4. Expand file references using:
   ```bash
   npx zx scripts/expand-file-references.mjs docs/design/[feature-name]-implementation-plan.md
   ```
5. Review for bloat - if document is too large, apply more conservative file selection

## Key Success Metrics

- **File Count**: 4-6 essential files maximum (not 20+)
- **Focus**: Implementation-critical information only
- **Size**: Reduced document size while maintaining completeness
- **Actionability**: Developer can implement without hunting for auxiliary files

## Learned Constraints from Iteration

### What Creates Bloat:
- Including complete component structures
- Listing all available UI components
- Multiple examples of the same pattern
- Comprehensive test file references
- Configuration file listings
- Alternative implementation approaches

### What Maintains Value:
- Specific function signatures to understand
- Key interfaces with line numbers
- Integration patterns between components
- One clear example per concept
- Essential file modification points

## Example Good vs Bad File Lists

### ❌ Bad (Too Comprehensive):
```
- Complete SpanHierarchyRenderer.tsx
- All UI components (card, badge, button, etc.)
- tsconfig.json, package.json
- Multiple test files and patterns
- All storybook stories
- Debug scripts and tools
- 3+ different mock data files
```

### ✅ Good (Conservative & Essential):
```
- src/components/SpanHierarchyRenderer.tsx - renderSpanNode() function
- src/utils/span-hierarchy.ts - buildSpanHierarchy() function  
- types.ts L31-40 - TestLog interface
- test-analyzer-client.tsx - state management pattern
- one-mock-data-file.json - child task patterns
```

## Compatibility Notes

- Always use `<!-- FILE_REFERENCES_START -->` and `<!-- FILE_REFERENCES_END -->` markers
- Format: `path/to/file.ts L1-10 - specific description`
- Works with `scripts/expand-file-references.mjs` for automatic content expansion