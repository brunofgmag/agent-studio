# agent-studio

[English](README.md) | Português

Plugin de mods para o Claude Code, feito para o Code tab do Claude Desktop no Windows. Ele faz duas coisas. O Launcher põe a sessão para atuar como um agente de `.claude/agents`, o que no terminal seria `claude --agent architect`. O Monitor mostra num painel os subagentes da sessão e as outras sessões abertas na máquina.

Precisa do Claude Code 2.1.286 ou mais novo no Desktop. A versão aparece em `/status`.

## Instalação

A instalação se faz num terminal, porque `/plugin install` não funciona dentro de uma sessão do Code tab.

```bash
claude plugin marketplace add C:/Users/bruno/Projetos/agent-studio
```

```bash
claude plugin install agent-studio@agent-studio-local
```

Sessões abertas antes da instalação só carregam o plugin depois de reiniciar o app.

## Launcher: `/as`

| Comando | O que faz |
| --- | --- |
| `/as architect` | Ativa o agente `architect` na sessão |
| `/as` | Abre o painel na aba Agentes; sem tela, lista os agentes em texto |
| `/as ?` | Mostra o agente ativo, com modelo, effort e ferramentas |
| `/as off` | Volta ao comportamento padrão |
| `/as --reload` | Lê de novo as pastas de agentes |

Os agentes vêm de `.claude/agents` do projeto, da pasta de trabalho até a raiz do repositório, e de `~/.claude/agents`. Com dois agentes de mesmo `name`, vale o do projeto.

Do arquivo do agente o plugin aplica o corpo (como system prompt), `model`, `effort`, `tools`, `disallowedTools` e `initialPrompt`. As restrições valem só no loop principal; os subagentes seguem as regras deles. Uma entrada `Agent(researcher, implementer)` em `tools` limita os tipos de subagente que a sessão dispara. O `initialPrompt` é enviado uma vez, logo depois de um `/as nome` que você digitou ou do botão Usar nesta sessão, e nunca quando o agente é restaurado.

Os campos `mcpServers`, `hooks`, `permissionMode`, `memory`, `skills` e `maxTurns` são lidos e não aplicados. O `/as` avisa quando o agente tem algum deles.

O agente escolhido fica guardado por sessão e volta depois de reabrir o app, de um `/clear` e de uma retomada. Enquanto ele está ativo, a linha de status mostra algo como `@designer · claude-opus-5-5[1m] · xhigh`. Com o Monitor ligado, a linha de status mostra `@designer · 2 subagentes rodando · 1 sessão trabalhando` e o botão Painel fica ao lado dela.

### Agente padrão por projeto

Com `{ "agent": "architect" }` no settings do projeto, uma sessão nova já começa como esse agente. No terminal o próprio Claude Code aplica a chave e a sessão nasce como agente nativo, então o plugin não faz nada. Um `/as off` vale mais que o padrão e continua valendo depois de reabrir o app.

### Limites do Launcher

O motor monta o system prompt no primeiro turno da conversa e só o refaz depois de um `/clear` ou de uma compactação. Por isso o `/as` vale por inteiro quando é a primeira coisa da sessão. Com a conversa em curso, modelo, effort e ferramentas trocam na hora, as instruções do agente entram como uma mensagem oculta, e o system prompt só troca no próximo `/clear` ou na próxima compactação. A resposta do comando diz qual dos dois casos aconteceu. Se a troca muda o modelo do loop principal (com `/as nome` ou com `/as off`), a resposta traz também um aviso, porque o cache de prompt da API é por modelo e o próximo turno relê a conversa inteira sem cache.

Sessão que já nasceu com um agente nativo (`claude --agent`, ou a chave `agent` do settings aplicada pelo Claude Code) fica fora do Launcher. Nela o `/as` responde que a sessão já é aquele agente.

Modelo declarado por apelido (`model: opus`) passa pela tabela da opção Model aliases. Apelido fora da tabela mantém o modelo da sessão, e o `/as` avisa.

## Monitor: `/agent-panel`

`/agent-panel` abre o painel Agentes. Onde não há tela para o painel, o comando responde a mesma informação em texto, e `/agent-panel sessions` faz o mesmo para a lista de sessões.

O painel tem três abas, que trocam com `1`, `2` e `3`.

Esta sessão mostra os subagentes da sessão em árvore, cada linha com status, tipo, tarefa, ferramenta em uso, duração e tokens. A contagem de tokens deixa de fora as leituras de cache, e o detalhe mostra o total com elas. A lista começa com uma linha de resumo, com a contagem por status e o total de tokens, e se divide em Em andamento e Terminados. Enter numa linha abre o detalhe. No topo ficam o Voltar e, enquanto o subagente roda, o Parar. Abaixo vêm o cabeçalho com o modelo, o prompt dado, a conversa e um campo para mandar mensagem ao subagente. O prompt aparece recolhido, e `mostrar tudo` abre o texto inteiro. A conversa mostra a última resposta, e as anteriores ficam atrás de `Respostas anteriores`. As mensagens que você manda por esse campo aparecem como `Você: ...` entre as respostas. O painel guarda as últimas 20 trocas de cada subagente, e só até a sessão fechar. O cabeçalho da aba tem um seletor para trocar de agente.

Outras sessões lista as sessões da máquina que rodam o plugin: pasta, agente, estado, número de subagentes e um tempo que depende do estado. Em uma sessão trabalhando, o tempo é quanto o turno atual já durou, em minutos e segundos. Em uma sessão ociosa, é há quanto tempo ela ficou ociosa: o fim do último turno, ou o início, o `/clear`, a retomada ou o fork da sessão. Sessões que pararam de publicar (inativas) e as encerradas mostram há quanto tempo deram o último sinal. O detalhe de uma sessão mostra a última resposta dela, os subagentes só para leitura, um campo de mensagem e o botão Status, que pede à outra sessão uma linha sobre o que ela está fazendo. Uma sessão sem sinal há 60 segundos aparece como inativa, e uma entrada parada há 24 horas é apagada.

Agentes lista o catálogo. O botão Usar, em cada linha, faz o que `/as nome` faz. Quando a conversa já começou e o agente troca o modelo, o primeiro clique mostra o aviso na linha e o botão vira Confirmar; o segundo clique ativa o agente.

No rodapé do prompt, ao lado dos modos, o botão Painel abre o painel. Com um agente ativo, subagentes rodando ou outras sessões com um turno em andamento, a linha de status resume a situação, por exemplo `@designer · 2 subagentes rodando · 1 sessão trabalhando`. A contagem de sessões inclui só as que estão no meio de um turno; as ociosas não entram.

### Limites do Monitor

Em modo de permissão `auto`, o Claude Code recusa a mensagem que um plugin manda direto a outra sessão ou a um subagente. Nesse caso o painel submete um pedido na conversa para o modelo mandar a mensagem, com o seu texto sem alteração. Nos modos `default` e `acceptEdits` a mensagem vai direto.

Só aparecem sessões locais que carregam o plugin. Sessões na nuvem, no WSL e no VS Code ficam de fora.

Cada sessão publica um resumo no armazenamento do plugin, em `~/.claude/plugins/store/`. Com a opção Compartilhar respostas ligada, o resumo inclui até 300 caracteres da última resposta, que qualquer outra sessão da máquina consegue ler.

## Opções

| Opção | Padrão | Efeito |
| --- | --- | --- |
| Launcher (`enableLauncher`) | ligado | Registra o `/as` |
| Monitor (`enableMonitor`) | ligado | Registra o `/agent-panel`, o painel e o botão do rodapé |
| Share answers (`shareAnswers`) | ligado | Publica o trecho da última resposta para as outras sessões |
| Model aliases (`modelAliases`) | `opus=claude-opus-5-5,sonnet=claude-sonnet-5-5,haiku=claude-haiku-5-5` | Traduz apelido em id de modelo |
| Language (`language`) | `en` | Idioma das mensagens: `en` ou `pt-BR` |

Com Launcher e Monitor desligados o plugin não registra nenhum hook nem comando.

Os títulos das opções aparecem em inglês, porque o arquivo `plugin.json` não muda com o idioma.

## Idioma

O padrão é inglês. Para ver as mensagens, o painel e as respostas dos comandos em português, defina a opção `language` como `pt-BR`. Os nomes dos comandos (`/as`, `/agent-panel`, `sessions`) são os mesmos nos dois idiomas. Um valor desconhecido volta para o inglês.

## Como desligar

Desative o plugin em `/plugin`, num terminal. Para uma sessão só, abra o Claude Code com `--safe-mode`.

## Desenvolvimento

```bash
claude plugin test C:/Users/bruno/Projetos/agent-studio
```

```bash
npx --prefix C:/Users/bruno/Projetos/agent-studio/dev --no-install tsc -p C:/Users/bruno/Projetos/agent-studio
```

```bash
claude plugin validate --strict C:/Users/bruno/Projetos/agent-studio
```

Os testes usam o kit do motor (`claude-code/testing`) e não precisam de modelo nem de tela. A checagem de tipos depende de `.claude-plugin/types/`, que o Claude Code grava quando uma sessão interativa carrega o plugin.
