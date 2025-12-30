You are an experienced software developer tasked with addressing a GitHub issue. Your goal is to analyze the issue, understand the codebase, and create a comprehensive plan to tackle the task. Follow these steps carefully:

1. First, review the GitHub issue using the gh issue view command.

<github_issue> #$ARGUMENTS </github_issue>

1.5. Label the issue (if issue number provided):
```bash
gh issue edit $ARGUMENTS --add-label "Picked" --add-label "F$(pwd | grep -oP 'cube9(-dev2?|-env[0-9]+)?' | sed -E 's/cube9$/0/; s/cube9-dev$/1/; s/cube9-dev2$/2/; s/cube9-env//')"
```
This marks the issue as "Picked" (being worked on) and adds an environment tag based on the working folder (e.g., "F7" for cube9-env7).

2. Next, examine the relevant parts of the codebase.

Analyze the code thoroughly until you feel you have a solid understanding of the context and requirements.

3. Create a new branch from the dev branch for this feature. The branch name should be descriptive and relate to the issue. Use the following format: bug/[issue-number]-brief-description

4. Create a comprehensive plan and todo list for addressing the issue. Consider the following aspects:

- Required code changes
- Potential impacts on other parts of the system
- Necessary tests to be written or updated
- Documentation updates
- Performance considerations
- Security implications
- Backwards compatibility (if applicable)
- Include the reference link to feature base or any other link that has the source of the user request

5. Think deeply about all aspects of the task. Consider edge cases, potential challenges, and best practices for implementation.

6. Present your plan in the following format:

<plan>
[Your comprehensive plan goes here. Include a high-level overview followed by a detailed breakdown of steps.]
</plan>

Remember, your task is to create a plan and implement the changes after approval. 
Commits and PRs should be handled separately using appropriate git commands. Then ASK FOR APPROVAL BEFORE YOU START WORKING on the TODO LIST.

IMPORTANT: This command is for analyzing, planning, and implementing changes only. 
For creating commits and pull requests, use the /git:cc-fix-pr command or ask the user explicitly.
