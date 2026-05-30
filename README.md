# 🌸 Lyly 

<div align="center">

**V-Tuber avatar com inteligência artificial — 100% procedural, zero keyframes.**

[![Electron](https://img.shields.io/badge/Electron-%2347848F.svg?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)

</div>

---

## 🎬 Demo

<div align="center">

<a href="https://www.youtube.com/watch?v=vW6walwxW6k">
  <img src="https://img.youtube.com/vi/vW6walwxW6k/maxresdefault.jpg" alt="Lyly Corpo Demo" width="900">
</a>

<br><br>

<a href="https://www.youtube.com/watch?v=vW6walwxW6k">
  <img src="https://img.shields.io/badge/▶_Watch_Full_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white">
</a>

</div>

> _Lyly é uma V-Tuber com corpo virtual 3D que reage, conversa e expressa emoções em tempo real._

---

## ✨ O que é a Lyly?

**Lyly** é um avatar VRM 3D com animações procedurais integradas a uma IA conversacional. Ela não usa keyframes ou animações pré-gravadas — cada expressão facial, piscada de olhos e movimento labial é calculado em tempo real pela GPU.

### O que ela faz:
- 🗣️ **Conversa naturalmente** com você via chat flutuante
- 😊 **Expressa emoções faciais** (alegria, tristeza, raiva, surpresa...) baseadas no contexto da conversa
- 👄 **Lip-sync sincronizado** — a boca se move em perfeita sincronia com o áudio gerado pela IA
- 🧠 **Lembra de você** — usa memória vetorial para recordar fatos, preferências e histórico de conversas
- 💭 **Reflete sobre si mesma** — aprende padrões de comportamento e evolui sua personalidade ao longo do tempo

---

## 🛠️ Tech Stack


| Component | Tecnologia |
|-----------|------------|
| **Avatar 3D** | Three.js + three-vrm (modelo VRM) |
| **Renderização** | Morph targets diretos na GPU (sem expressionManager) |
| **Animação facial** | 100% procedural — senoides, lerp, noise |
| **Lip-sync** | Queue-synced com closure natural (Fcl_MTH_A/I/U/E/O) |
| **IA / LLM** | Ollama (meta-llama-3.1-8b-instruct-abliterated) |
| **Memória vetorial** | ChromaDB (3 coleções: usuário, identidade, diário) |
| **TTS** | F5-TTS via FastAPI — pipeline 100% em RAM |
| **Áudio playback** | ffplay pipe stream (zero-disk) |
| **Desktop app** | Electron + IPC bidirecional |

---

## 🧬 Arquitetura

<img src="docs/arquitetura.svg?sanitize=true" alt="Arquitetura do Projeto Lyly" width="550">

### Fluxo de uma conversa:

1. **Você digita** uma mensagem no chat flutuante
2. **Lyly reage instantaneamente** — pré-análise emocional (reflexo facial)
3. **LLM gera a resposta** em streaming, frase por frase
4. **Cada frase vira áudio** via TTS e toca no pipe do ffplay
5. **A boca se sincroniza** com o áudio real (visemas baseados nas vogais)
6. **Expressões faciais mudam** conforme a emoção detectada no contexto
7. **Memória é salva** — Lyly lembra quem você é e o que conversaram

---

## 🚀 Instalação & Execução

### Pré-requisitos

- [Node.js](https://nodejs.org/) ≥ 18
- [Python](https://www.python.org/) 3.12+ (para ChromaDB)
- [Ollama](https://ollama.ai/) com os modelos carregados
- [FFmpeg/ffplay](https://ffmpeg.org/) no PATH
- Servidor TTS rodando em `http://localhost:8005`

### Passo a passo

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/lyly-corpo.git
cd lyly-corpo

# 2. Instale dependências
npm install
cd lyly-bot && npm install && cd ..

# 3. Configure variáveis de ambiente
cp .env.example .env
# Edite .env com seus caminhos e URLs

# 4. Baixe o modelo VRM (lyly.vrm) e coloque na raiz do projeto

# 5. Inicie os serviços externos:

# ChromaDB (memória vetorial)
cd lyly-bot && python chroma.py   # roda na porta 8000

# Ollama (IA local)
ollama serve
ollama pull meta-llama-3.1-8b-instruct-abliterated
ollama pull gemma-2-2b-it

# TTS (exemplo com Docker)
docker run -p 8005:8005 f5-tts-amd

# 6. Execute a aplicação
npm start
```

---

## 🎭 Expressões Faciais


| Emoção | Descrição |
|--------|-----------|
| 😊 Happy | Olhos brilhantes, sobrancelhas elevadas |
| 😢 Sad | Olhos baixos, sobrancelhas tristes |
| 😠 Angry | Olhar fixo intenso, sobrancelhas franzidas, blink reduzido |
| 😲 Surprised | Olhos arregalados, sobrancelhas altas |
| 😌 Relaxed | Expressão natural e calma |
| 🤔 Thinking | Olhar pensativo, foco direcionado |
| 😳 Embarrassed | Mistura de alegria e tristeza nos olhos |

> Cada emoção controla blendshapes específicos na GPU: `Fcl_EYE_*` para olhos, `Fcl_BRW_*` para sobrancelhas. A boca é exclusiva do lip-sync (`Fcl_MTH_A/I/U/E/O`).

---

## 📂 Estrutura do Projeto

```
lyly-corpo/
├── main.js              # IPC Hub — roteia eventos entre renderer e brain
├── preload.js           # Security bridge (contextBridge)
├── renderer.js          # Avatar 3D — Three.js, VRM, animações procedurais
├── index.html           # Janela do avatar (transparente)
│
├── chat/                # Chat flutuante overlay
│   ├── chat.html
│   ├── chat.js
│   └── style.css
│
└── lyly-bot/            # Cérebro da Lyly (Node.js ESM)
    ├── brain/           # Orquestração cognitiva
    │   ├── lylyBrain.js         # Prompts, sessão, contexto
    │   ├── streamProcessor.js   # TTS + streaming + visemes IPC
    │   └── reflectionEngine.js  # Memória + análise emocional
    ├── llm/             # Cliente Ollama (OpenAI-compatible)
    ├── memory/          # ChromaDB — memória vetorial
    └── chroma.py        # Servidor ChromaDB (Python)
```

---

## 📊 Dados Técnicos


| Parâmetro | Valor |
|-----------|-------|
| Lerp speed (olhos/sobrancelhas) | `delta * 4.5` |
| Attack speed (boca abrindo) | `12.0` |
| Release speed (boca fechando) | `6.5` |
| Closure threshold | `0.52` (~48% final do áudio) |
| Anti-flickering cooldown | 1400ms |
| Blink duração | 0.12s |
| Timer idle emotion | 3s + (intensidade × 2s) |
| Timer focus reset | 4.0s fixos |

---

## 🗺️ Roadmap

- [x] Pipeline TTS zero-disk com pipe stream
- [x] Lip-sync queue-synced com closure natural
- [x] Análise emocional contextual
- [x] Lógica "skip" inteligente (preserva expressões fortes)
- [x] Timers de decaimento duplos (idle + focus independentes)
- [ ] Perlin noise para micro-movimentos mais orgânicos
- [ ] Respiração emocional (angry = rápida, sad = lenta)
- [ ] Eye tracking realista (mouse/cursor)
- [ ] Análise espectral de áudio para visemas via FFT

---

## 📄 Licença

Projeto pessoal.

---
