# /design-review

Validate design documents against the actual codebase to ensure technical correctness and feasibility.
NOTE: This command focuses on verifying assumptions and identifying risks, not document formatting.

## Usage
- `/design-review [path]` - Review specific design document
- `/design-review` - Auto-detect from current branch (e.g., bug/4811-* → docs/design/4811-*.md)

## Workflow

1. **Extract Design Intent**
   - What specific problem is the design solving?
   - What gap in current functionality is being addressed?
   - What are the success criteria and constraints?
   - What key assumptions are being made?
   - Task: "Extract the core problem statement, goals, and success criteria from this design document"

2. **Locate and Read Design Document**
   - Find the design doc (provided or auto-detected)
   - Extract key technical decisions and assumptions
   - Identify all code references (functions, APIs, data models)
   - Note any similar-sounding but potentially different functionalities

3. **Parallel Validation Using Subagents**
   - Launch multiple Task subagents in parallel to validate different aspects:
     - **Code Existence Check**: Verify mentioned functions/APIs exist with correct signatures
     - **Functionality Distinction**: Find existing code but distinguish exact capabilities
     - **Regression Analysis**: Identify features that could break
     - **Genuine Alternatives**: Look for solutions that address the SAME problem
   - Main agent maintains overall context while subagents do focused work

4. **Validate Assumptions with Precision**
   - Task: "Verify if function X exists with signature Y. If not, find closest match and explain differences"
   - Task: "Find components that handle [specific functionality]. Exclude components that only handle [similar but different functionality]"
   - Task: "Check if existing feature Z solves the same problem as described in the design"
   - Each subagent returns precise findings, not assumptions

5. **Risk and Impact Analysis**
   - Regression risks:
     - Which existing features could break?
     - What test coverage exists?
     - Are there hidden dependencies?
   - Complexity concerns:
     - Is this adding unnecessary complexity?
     - Could we achieve the same with less code?
     - Are we creating technical debt?
   - Better alternatives:
     - Is there existing code that already does this?
     - Can we extend current functionality instead?
     - Would a simpler approach work?
   - Future-proofing:
     - Will this design limit future changes?
     - Are we locking ourselves into a pattern?
     - Can we make it more modular/extensible?

6. **Technical Correctness Review**
   - Use mcp__zen__thinkdeep for deep analysis of logic
   - Delegate specific checks to subagents:
     - Task: "Check for race conditions in the proposed async flow"
     - Task: "Verify security implications of the API changes"
   - Consolidate findings from all subagents

7. **Self-Validate Recommendations**
   - For each proposed recommendation, verify:
     - Does this actually solve the problem stated in step 1?
     - Would following this achieve the design's success criteria?
     - Am I conflating similar but different features?
   - Use mcp__zen__challenge: "Challenge these recommendations: Do they address the actual problem from the design intent?"
   - Revise recommendations if misaligned

8. **Verify Design-to-Solution Alignment**
   - State clearly: "The design aims to achieve: [extracted from step 1]"
   - State clearly: "My recommendations would result in: [summary of proposals]"
   - Explicitly check: Do these align?
   - If misaligned, revisit analysis

9. **Generate Validation Report**
   - **Design Intent**: Core problem and goals (from step 1)
   - **Verified Assumptions**: What checks out ✓
   - **Invalid Assumptions**: What doesn't exist or work as expected ✗
   - **Functionality Distinctions**: How similar features differ
   - **Reusable Code Found**: Existing implementations to leverage
   - **Critical Risks**: Must address before implementation
   - **Recommendations**: Approaches that solve the actual problem
   - **Alignment Check**: Confirmation that recommendations match design intent

## Subagent Delegation Strategy

### When to Use Subagents
- **Intent Extraction**: "Extract the core problem this design is solving"
- **Precise Function Search**: "Find function X with signature Y, explain differences if not exact match"
- **Functionality Distinction**: "Find components that do [specific thing], exclude those that only do [similar thing]"
- **Problem-Solution Matching**: "Does existing feature Z solve the same problem as described in design?"
- **Impact Analysis**: "List all features that depend on Y and could break"

### Benefits of Subagent Approach
- Main agent keeps high-level context of entire design
- Parallel execution speeds up validation
- Focused searches don't pollute main conversation
- Each validation task gets dedicated context window
- Precise prompts prevent false assumptions

### Subagent Prompt Principles
- **Be Specific**: "Find components that handle STRING-TO-STRING field name mapping" not "Find field mapping components"
- **Exclude Similar**: "Exclude components that only handle value enumeration" when looking for field name mapping
- **Verify Exact Match**: "Check if function X exists with exact signature Y, explain any differences found"
- **Problem-Focused**: "Does this solve the same problem as..." not "Is this similar to..."

## Examples

```bash
# Review with improved validation process
/design-review docs/design/some-feature.md

# Behind the scenes:
# Step 1: "Extract: What problem is this design solving?"
# Step 3: "Find components that handle [specific functionality]. Exclude those that only handle [different functionality]"
# Step 4: "Verify if function X exists with exact signature Y"
# Step 7: "Challenge: Do these recommendations solve the actual problem?"

# Example process:
# 📋 [Step 1] INTENT: Design solves field name mapping (customerNumber -> entityId)
# 🔍 [Step 3] Found: EnumMapConfigLocal handles VALUE mapping, not field name mapping
# ✓ [Step 4] Verified: FieldsConfigMappings type supports integrationFieldName
# ✅ [Step 7] ALIGNED: Recommendations address field name mapping gap
```

## Review Principles

1. **Understand Before Judging**: Always extract the problem statement first
2. **Precision Over Assumption**: Similar != Same. Verify exact functionality  
3. **Challenge Your Conclusions**: Use self-validation before presenting
4. **Problem-Solution Alignment**: Every recommendation must map to a stated problem
5. **Distinguish Carefully**: 
   - Value mapping != Field name mapping
   - Configuration UI != Hardcoded mappings
   - Generic component != Specific implementation

## Key Validation Points

1. **Design Intent Understanding**
   - What problem is actually being solved?
   - What are the success criteria?
   - What assumptions need verification?

2. **Code References** (delegated to subagent)
   - Do mentioned functions/classes exist with correct signatures?
   - Are the integration points feasible as described?
   - Any missing dependencies or prerequisites?

3. **Functionality Precision** (delegated to subagent)  
   - How do existing similar features differ from design needs?
   - What exact capabilities do current components have?
   - Are we comparing apples to apples?

4. **Problem-Solution Alignment** (main agent analysis)
   - Do recommendations actually solve the stated problem?
   - Would alternatives achieve the same goals?
   - Are we addressing symptoms vs root causes?

## Output Example

```
DESIGN VALIDATION REPORT
========================

📋 DESIGN INTENT
Problem: Field name mappings between Core8 and integrations are hardcoded
Goal: Allow users to configure which integration fields map to Core8 fields
Success Criteria: Users can map customerNumber to any NetSuite field via UI

✅ VERIFIED ASSUMPTIONS (3) - via parallel subagent checks
- [Subagent 1] FieldsConfigMappings type exists with integrationFieldName field
- [Subagent 2] FormFieldText component available for text inputs
- [Subagent 3] Integration config structure supports field mappings

❌ FUNCTIONALITY DISTINCTIONS (1) - critical precision check
- [Subagent 2] EnumMapConfigLocal handles VALUE mapping (Premium↔tier1), NOT field name mapping (customerNumber↔entityId)
- These are different problems requiring different UI approaches

✗ INVALID ASSUMPTIONS (1)
- [Subagent 1] Design assumes no existing UI for field mapping - this is correct, enum UI doesn't solve this

💡 REUSABLE CODE - discovered via focused search
- `/src/components/common/forms/FormFieldText.tsx`: Text input component
- `/src/components/integrations/config-forms/NetsuiteConfig.tsx`: Card layout pattern
- Existing debounced update patterns from enum components

🔧 RECOMMENDATIONS - validated against design intent
- Proceed with generic field mapping component as designed
- Reuse FormFieldText and Card layout patterns
- Follow debounced update pattern from existing forms
- Add to NetSuite config alongside existing enum mapping

✅ ALIGNMENT CHECK
- Design wants: UI for configuring field name mappings
- Recommendations provide: Exactly that functionality
- Status: FULLY ALIGNED

VERDICT: Design is correct - addresses genuine gap in functionality
```

## Notes

- **Always start with understanding the problem** before evaluating solutions
- **Distinguish between similar features** - similar names don't mean same functionality
- **Self-validate recommendations** against the original design intent  
- **Use precise subagent prompts** to avoid false assumptions
- **Check alignment** between design goals and proposed solutions
- Subagents handle focused searches while main agent maintains design context
- Parallel execution makes validation faster but accuracy comes from precision