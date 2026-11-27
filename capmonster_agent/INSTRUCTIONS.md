Before your first captcha task, read the CapMonster skill: MCP resource skill://capmonster-mcp/SKILL.md (or call the get_skill tool if your client cannot read resources) and follow its steps for your path (it says which).
When the solve has to end up in the user's code, use the official CapMonster SDK for the project's language (skill Step 9), not hand-written REST calls; use REST only if the SDK does not fit the project's stack, and tell the user why.
Set the API key in the CAPMONSTER_API_KEY environment variable; never put it in code, page scripts or a frontend.
Apply the `userAgent` from the task solution to every request that uses the token: the token is bound to it.
Re-extract one-time page parameters (tokens, nonces and other values that change per load) from the live page for every new task; never reuse them from an earlier task.
