---
description: Run comprehensive code quality checks and CI tests with intelligent failure categorization and fix loops
allowed-tools: Bash(*), Task(*)
---

# /check

Run comprehensive code quality and testing checks with intelligent failure analysis and automatic fix loops.

## Execution Flow:

### Phase 1: Code Quality Assessment
1. **Run `yarn cq`** - Check format, lint, types
2. **If fails**: Fix issues → **Re-run `yarn cq`** → Repeat until passes or max attempts
3. **If passes**: Continue to Phase 2

### Phase 2: CI Testing Assessment  
1. **Run `yarn test:ci`** - Full CI environment simulation
2. **If passes**: ✅ **COMPLETE SUCCESS** - Report all clear
3. **If fails**: Continue to Phase 3

### Phase 3: Intelligent Failure Analysis
1. **Use @agent-general-purpose** to analyze CI failures
2. **Categorize failures** as:
   - 🔧 **Code Issues** (fixable): Missing exports, schema errors, test logic bugs
   - ⚠️ **Environment Issues** (acceptable): Credentials, external services, infrastructure
3. **Continue to Phase 4**

### Phase 4: Targeted Fixes & Full Re-validation
1. **Apply fixes** for code issues only
2. **Re-run BOTH `yarn cq` AND `yarn test:ci`** 
3. **If yarn cq fails**: Return to Phase 1
4. **If new CI failures**: Return to Phase 3
5. **If only environment issues remain**: ✅ **ACCEPTABLE SUCCESS**
6. **If both pass completely**: ✅ **COMPLETE SUCCESS**
7. **If code issues persist after 3 attempts**: ❌ **FAILURE** - Report analysis

## Validation Strategy:

### Code Quality Requirements:
- **`yarn cq` MUST pass completely** - No exceptions for code formatting, linting, or type errors

### CI Test Requirements:
- **Code-related test failures MUST be fixed** - Schema validation, test logic, implementation bugs
- **Environment-related failures are acceptable** - Missing credentials, external service dependencies
- **Never report success if fixable code issues remain**

### Fix-and-Validate Loops:
- **Always re-run both commands after making fixes** 
- **Use targeted fixes for code issues only**
- **Distinguish between fixable vs environment issues**
- **Provide clear guidance for environment setup when needed**

## Failure Categories:

### ✅ Code Issues (Fixable):
- Schema validation errors in tests
- Test assertion mismatches
- Implementation logic errors
- Missing required fields
- Business logic bugs

### ⚠️ Environment Issues (Acceptable):
- GCP credential validation failures in tests
- Missing external service credentials
- Storybook provider setup issues
- Network connectivity problems
- Missing test files that require specific environment setup

## Usage:

```
/check
```

## Commands executed (in validation loops):

```bash
yarn cq           # Code quality: lint, format, type check
yarn test:ci      # Full CI environment test simulation
```

## Success Criteria:

✅ **Complete Success**: Both `yarn cq` AND `yarn test:ci` pass without any failures

✅ **Acceptable Success**: `yarn cq` passes + CI tests pass OR only have environment-related failures

❌ **Failure**: Any code quality issues OR fixable code-related CI test failures remain

The command provides detailed categorization of failures to help distinguish between issues that need immediate fixes vs environment setup requirements.
