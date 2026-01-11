You are reviewing code that you recently investigated during bug fixing. Use your deep familiarity with this code area to identify improvement opportunities.

## Context

You have just completed investigating and/or fixing a bug. During that process, you gained thorough understanding of the affected code paths, patterns, and structure. This review leverages that knowledge to identify areas where the code could be improved.

## Code Health Review

Provide observations in the following categories. Skip any category where you have no notable observations.

<code_health_review>
### Code Smells Observed
- [Any code that felt unclear, overly complex, or hard to understand during investigation]
- [Functions/methods that are too long or do too many things]
- [Poor naming that caused confusion]
- [Magic numbers or unclear constants]

### DRY Opportunities
- [Duplicated logic that could be consolidated]
- [Similar patterns across files that could share an abstraction]
- [Copy-pasted code with minor variations]

### Simplification Opportunities
- [Overly complex conditionals or nested logic]
- [Unnecessary indirection or abstraction layers]
- [Dead code or unused parameters]
- [Over-engineered solutions for simple problems]

### Architectural Observations
- [Coupling issues or unclear boundaries between modules]
- [Missing abstractions that would clarify intent]
- [Inconsistencies with patterns used elsewhere in the codebase]
- [Potential sources of similar bugs in related code]

### Clarity Improvements
- [Code that was hard to follow during debugging]
- [Missing or misleading comments]
- [Confusing control flow]
- [Areas where the "why" is unclear]
</code_health_review>

**Note**: These are observations only - for your consideration. They do NOT need to be addressed immediately or in the current PR.
