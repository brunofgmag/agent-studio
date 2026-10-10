# agent-studio

English | [Português](README.pt-BR.md)

A Claude Code mods plugin, built for the Code tab of Claude Desktop on Windows. It does two things. The Launcher makes the session act as an agent from `.claude/agents`, which in a terminal would be `claude --agent architect`. The Monitor shows, in a panel, the session's subagents and the other sessions open on the machine.

It needs Claude Code 2.1.286 or newer in the Desktop app. The version shows in `/status`.

## Installation

Install from a terminal, because `/plugin install` does not work inside a Code tab session.

```bash
claude plugin marketplace add C:/Users/bruno/Projetos/agent-studio
```

```bash
claude plugin install agent-studio@agent-studio-local
```

Sessions opened before the install only load the plugin after you restart the app.

## Launcher: `/as`

| Command | What it does |
| --- | --- |
| `/as architect` | Activates the `architect` agent in the session |
| `/as` | Opens the panel on the Agents tab; with no screen, lists the agents as text |
| `/as ?` | Shows the active agent, with its model, effort and tools |
| `/as off` | Goes back to the default behavior |
| `/as --reload` | Reads the agent folders again |

Agents come from the project's `.claude/agents`, from the working folder up to the repository root, and from `~/.claude/agents`. When two agents share a `name`, the project one wins.

From the agent file the plugin applies the body (as the system prompt), `model`, `effort`, `tools`, `disallowedTools` and `initialPrompt`. The restrictions apply to the main loop only; subagents follow their own rules. An `Agent(researcher, implementer)` entry in `tools` limits the subagent types the session can start. The `initialPrompt` is sent once, right after an `/as name` you typed or after the Use button in this session, and never when the agent is restored.

The fields `mcpServers`, `hooks`, `permissionMode`, `memory`, `skills` and `maxTurns` are read and not applied. `/as` warns when the agent has any of them.

The chosen agent is stored per session and comes back after you reopen the app, after a `/clear` and after a resume. While it is active, the status line shows something like `@designer · claude-opus-5-5[1m] · xhigh`. With the Monitor on, the status line shows `@designer · 2 subagents running · 1 session working` and the Panel button sits beside it.

### Default agent per project

With `{ "agent": "architect" }` in the project settings, a new session starts as that agent. In a terminal Claude Code itself applies the key and the session is born as a native agent, so the plugin does nothing. An `/as off` outranks the default and still holds after you reopen the app.

### Launcher limits

The engine builds the system prompt on the first turn of the conversation and only rebuilds it after a `/clear` or a compaction. So `/as` takes full effect when it is the first thing in the session. With a conversation under way, the model, effort and tools change at once, the agent's instructions enter as a hidden message, and the system prompt only changes at the next `/clear` or the next compaction. The command's answer says which of the two cases happened. If the switch changes the main loop's model (with `/as name` or with `/as off`), the answer also carries a warning, because the API prompt cache is per model and the next turn rereads the whole conversation without cache.

A session born with a native agent (`claude --agent`, or the `agent` settings key applied by Claude Code) stays outside the Launcher. In it, `/as` answers that the session already is that agent.

A model declared by alias (`model: opus`) goes through the table in the Model aliases option. An alias missing from the table keeps the session's model, and `/as` warns.

## Monitor: `/agent-panel`

`/agent-panel` opens the Agents panel. Where there is no screen for the panel, the command answers the same information as text, and `/agent-panel sessions` does the same for the list of sessions.

The panel has three tabs, switched with `1`, `2` and `3`.

This session shows the session's subagents as a tree, each row with status, type, task, tool in use, duration and tokens. The token count leaves out cache reads, and the detail shows the total with them. The list starts with a summary line, with the count per status and the token total, and splits into In progress and Finished. Enter on a row opens the detail. At the top are Back and, while the subagent runs, Stop. Below come the header with the model, the prompt given, the conversation and a field to send the subagent a message. The prompt shows collapsed, and `show all` opens the full text. The conversation shows the last answer, and the earlier ones sit behind `Earlier answers`. Messages you send through that field show as `You: ...` among the answers. The panel keeps the last 20 exchanges of each subagent, and only until the session closes. The tab header has a selector to switch agents.

Other sessions lists the sessions on the machine that run the plugin: folder, agent, state, number of subagents and a time that depends on the state. For a session working, the time is how long its current turn has run, as minutes and seconds. For an idle session, it is how long ago the session went idle: when its last turn ended, or when the session started, was cleared, resumed or forked. Sessions that stopped publishing (inactive) and ended ones show how long ago they last signaled. A session's detail shows its last answer, its subagents as read-only, a message field and the Status button, which asks the other session for one line about what it is doing. A session with no signal for 60 seconds shows as inactive, and an entry idle for 24 hours is deleted.

Agents lists the catalog. The Use button on each row does what `/as name` does. When the conversation has already started and the agent changes the model, the first click shows the warning on the row and the button becomes Confirm; the second click activates the agent.

At the bottom of the prompt, beside the modes, the Panel button opens the panel. With an active agent, running subagents or other sessions with a turn running, the status line sums up the situation, for example `@designer · 2 subagents running · 1 session working`. The session count includes only sessions in the middle of a turn; idle sessions are not counted.

### Monitor limits

In `auto` permission mode, Claude Code refuses a message that a plugin sends straight to another session or to a subagent. In that case the panel submits a request in the conversation for the model to send the message, with your text unchanged. In the `default` and `acceptEdits` modes the message goes straight through.

Only local sessions that load the plugin appear. Cloud, WSL and VS Code sessions are left out.

Each session publishes a summary in the plugin's storage, in `~/.claude/plugins/store/`. With the Share answers option on, the summary includes up to 300 characters of the last answer, which any other session on the machine can read.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| Launcher (`enableLauncher`) | on | Registers `/as` |
| Monitor (`enableMonitor`) | on | Registers `/agent-panel`, the panel and the footer button |
| Share answers (`shareAnswers`) | on | Publishes an excerpt of the last answer for the other sessions |
| Model aliases (`modelAliases`) | `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5,haiku=claude-haiku-5-5` | Maps an alias to a model id |
| Language (`language`) | `en` | Language of the messages: `en` or `pt-BR` |

With the Launcher and the Monitor both off, the plugin registers no hook and no command.

## Language

The default is English. To see the messages, the panel and the command answers in Brazilian Portuguese, set the `language` option to `pt-BR`. The command names (`/as`, `/agent-panel`, `sessions`) are the same in both languages. An unknown value falls back to English. The option titles in this list stay in English, because `plugin.json` does not change with the language.

## How to turn it off

Disable the plugin in `/plugin`, in a terminal. For a single session, open Claude Code with `--safe-mode`.

## Development

```bash
claude plugin test C:/Users/bruno/Projetos/agent-studio
```

```bash
npx --prefix C:/Users/bruno/Projetos/agent-studio/dev --no-install tsc -p C:/Users/bruno/Projetos/agent-studio
```

```bash
claude plugin validate --strict C:/Users/bruno/Projetos/agent-studio
```

The tests use the engine kit (`claude-code/testing`) and need neither a model nor a screen. The type check depends on `.claude-plugin/types/`, which Claude Code writes when an interactive session loads the plugin.
