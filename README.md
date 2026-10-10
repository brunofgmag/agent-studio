# agent-studio

English | [Português](README.pt-BR.md)

A Claude Code plugin for the Code tab of the Claude desktop app. It lets a session act as one of your agents from `.claude/agents`, and it shows the session's subagents and your other open sessions in a panel.

![The panel on the This session tab, with two subagents running](docs/this-session.png)

## What it does

The plugin has two parts, and each can be turned off on its own.

The Launcher adds `/as`. Typing `/as architect` makes the session act as the `architect` agent: its body becomes the system prompt, and its model, effort and tool restrictions apply to the main loop. In a terminal you would get the same with `claude --agent architect`. The desktop app has no such switch, so the plugin provides one.

The Monitor adds `/agent-panel` and a Panel button under the prompt. The panel lists the subagents of the session with their status, time and tokens. It also lists the other Claude Code sessions open on the machine, and the agents you can switch to.

## What it is for

Subagents in the desktop app run out of sight. You see that one started and you see its report when it ends. The panel shows which ones are still running, what each was asked and what it answered, and it lets you stop one or send it a message.

Agents are the other half. If you keep roles in `.claude/agents` and use them in a terminal with `--agent`, the Launcher brings them to the Code tab, where a session can change role without being restarted.

## The panel

`/agent-panel` opens it, and so does the Panel button. It has three tabs, switched with `1`, `2` and `3`.

### This session

The first image shows this tab. Each subagent takes two lines. The first has a status mark, the subagent type, the tool in use, the time and the tokens. The second has the task it was given. The mark is blue while the subagent runs, green when it completes, red when it fails and grey when it is stopped.

A summary at the top counts the subagents by status and adds up their tokens. Subagents that are running come first, under In progress, and the rest go under Finished.

The token count leaves out cache reads. A subagent rereads its whole conversation from cache on every step, and adding those reads would make a short job look like millions of tokens. The detail shows the total with them.

Pressing a row opens the subagent.

![The detail of a running subagent](docs/subagent-detail.png)

Back and Stop sit at the top. Below them are the model, the prompt the subagent was given (collapsed until you press `show all`), its last answer and a field to send it a message. Earlier answers and the messages you sent stay behind an `Earlier answers` button. The panel keeps the last 20 exchanges of each subagent until the session closes.

### Other sessions

This tab lists the other local sessions that load the plugin, split into Open and Ended. Each row has the session's title (or its folder name when it has none), its agent, its state and a time. For a session in the middle of a turn, the time is how long the turn has run. For an idle one, it is how long ago it stopped.

Opening a session shows its last answer and its subagents. From there you can send it a message, or press Status to ask it for one line about what it is doing.

### Agents

![The Agents tab, listing the agent catalog](docs/agents-tab.png)

The third tab lists the agents the plugin found. Use does what `/as name` does. An agent that declares a `color` in its file gets a dot of that color.

When a conversation is already under way and the agent you pick runs on another model, the first press only shows a warning and turns the button into Confirm. The prompt cache is kept per model, so the next turn would read the whole conversation without it.

## Under the prompt

![The status text and the Panel button under the prompt](docs/footer.png)

The status line shows the active agent, then how many subagents are running and how many other sessions are in the middle of a turn. Idle sessions are not counted. The Panel button beside it opens the panel.

## The `/as` command

| Command | What it does |
| --- | --- |
| `/as architect` | Activates the `architect` agent in the session |
| `/as` | Opens the panel on the Agents tab |
| `/as ?` | Shows the active agent, with its model, effort and tools |
| `/as off` | Goes back to the default behavior |
| `/as --reload` | Reads the agent folders again |

Agents come from the project's `.claude/agents`, from the working folder up to the repository root, and from `~/.claude/agents`. When two agents share a `name`, the project one wins.

From the agent file the plugin applies the body, `model`, `effort`, `tools`, `disallowedTools` and `initialPrompt`. The restrictions apply to the main loop only, and subagents follow their own rules. An `Agent(researcher, implementer)` entry in `tools` limits the subagent types the session can start.

The fields `mcpServers`, `hooks`, `permissionMode`, `memory`, `skills` and `maxTurns` are read and not applied. `/as` tells you when the agent has one of them.

The chosen agent is stored per session. It comes back after you reopen the app, after a `/clear` and after a resume.

### When the switch takes effect

Claude Code builds the system prompt on the first turn of a conversation and rebuilds it only after a `/clear` or a compaction. So `/as` takes full effect when it is the first thing you type in a session.

With a conversation under way, the model, effort and tools change at once and the agent's instructions enter as a hidden message. The system prompt itself changes at the next `/clear` or compaction. The answer to `/as` says which of the two happened, and it warns you when the switch changes the model.

### Default agent for a project

With `{ "agent": "architect" }` in the project settings, a new session starts as that agent. `/as off` outranks the default and still holds after you reopen the app.

A session that was born as a native agent, with `claude --agent` or with that settings key applied by Claude Code itself in a terminal, stays outside the Launcher. In it, `/as` answers that the session already is that agent.

## Install

Run this in a shell. The desktop app's Terminal panel works:

```sh
claude plugin install agent-studio --marketplace brunofgmag/agent-studio
```

It installs at the user scope. Sessions opened before the install load the plugin after you restart the app.

From inside a terminal `claude` session you can type the slash command instead:

```
/plugin install agent-studio --marketplace brunofgmag/agent-studio
```

Typing that slash command at the desktop app's prompt does not install anything. The app opens its plugin catalog, which does not list this repository.

The plugin was written and tested on Claude Code 2.1.296, on Windows. It needs a build that loads plugin hooks modules.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| Launcher (`enableLauncher`) | on | Registers `/as` |
| Monitor (`enableMonitor`) | on | Registers `/agent-panel`, the panel and the Panel button |
| Share answers (`shareAnswers`) | on | Publishes an excerpt of the session's last answer for the other sessions |
| Model aliases (`modelAliases`) | `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5,haiku=claude-haiku-5-5` | Maps an alias such as `model: opus` to a model id |
| Language (`language`) | `en` | Language of the texts: `en` or `pt-BR` |

Claude Code stores plugin options in `~/.claude/settings.json`, under `pluginConfigs`:

```json
{
  "pluginConfigs": {
    "agent-studio@agent-studio": { "options": { "language": "pt-BR" } }
  }
}
```

In a terminal session, `/plugin` has a Configure options entry for the same values. You can also set one while installing, with `--config language=pt-BR`.

With the Launcher and the Monitor both off, the plugin registers no hook and no command.

## Language

The texts are in English by default and in Brazilian Portuguese with `language` set to `pt-BR`. The command names are the same in both. The option titles stay in English, because the plugin manifest cannot follow the option.

## Limits

In `auto` permission mode, Claude Code refuses a message that a plugin sends straight to a subagent or to another session. The panel then submits a request in the conversation for the model to send it, with your text unchanged. In the `default` and `acceptEdits` modes the message goes straight through.

Only local sessions that load the plugin appear in the Other sessions tab. Cloud, WSL and VS Code sessions do not.

The desktop app rebuilds what a plugin drew every time that plugin, or any other, asks for a redraw, and a button under the pointer loses its highlight for an instant when that happens. The panel asks for a redraw only when something it shows has changed, and its clocks tick in a module of their own that needs none.

After you reopen the app, the status line shows the agent again at your first prompt, not before.

## Running from source

```sh
git clone https://github.com/brunofgmag/agent-studio.git
claude --plugin-dir ./agent-studio
```

To load it in every session, including the desktop app's, put the folder's path in the `CLAUDE_CODE_PLUGIN_DIRS` environment variable. A plugin loaded this way is named `agent-studio@inline` in `pluginConfigs`.

```sh
claude plugin validate --strict .
claude plugin test .
```

The first command checks the manifest and lists what the module hooks and calls. The second runs the tests in `tests/`, which use Claude Code's test kit and need neither a model nor a screen.

For the type check, install the one development dependency and run TypeScript:

```sh
npm install --prefix dev
npx --prefix dev --no-install tsc -p .
```

The types come from `.claude-plugin/types/`, which Claude Code writes when an interactive session loads the plugin.

## Privacy

The plugin makes no network requests. It reads your agent files, the project settings and the events of the session it runs in.

Each session writes a short summary to the plugin's storage in `~/.claude/plugins/store/`, so that your other sessions can list it: the folder, the agent, the state, the subagents and, with Share answers on, up to 300 characters of the last answer. Any session on the machine that loads the plugin can read it. An entry is deleted 24 hours after its session last wrote it.

`claude plugin validate --strict .` prints the full list of calls the plugin makes.

## License

MIT. See [LICENSE](LICENSE).
