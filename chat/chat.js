// chat/chat.js
console.log("chat.js carregado");
(function() {
  'use strict';
  
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');

  // Elementos de Configuração
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings');
  const settingsModal = document.getElementById('settings-modal');
  const themeSelect = document.getElementById('theme-select');
  const fontSelect = document.getElementById('font-select');
  const accentColorPicker = document.getElementById('accent-color-picker');

  let isProcessing = false;
  let isResizing = false;
  let currentDir = '';
  let startX, startY, startW, startH, startXPos, startYPos;

  // ✅ CORREÇÃO: SessionId persistente para toda a conversa
  let sessionId = 'chat-session-' + Date.now();

 function createStreamingMessage(sender) {
  const div = document.createElement('div');
  div.className = `message ${sender} streaming`;
  div.textContent = '';
  return div;
}

function appendToStreamingMessage(element, chunk) {
  element.textContent += chunk;
}

function finalizeStreamingMessage(element) {
  element.classList.remove('streaming');
}

async function handleSendMessage(e) {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  addMessage(text, 'user');
  userInput.value = '';
  userInput.focus();

  const aiMsgElement = createStreamingMessage('ai');
  chatMessages.appendChild(aiMsgElement);

  // ✅ Registra listeners com cleanup automático
  const unsubText = window.electronAPI.onChatStreamText((chunk) => {
    appendToStreamingMessage(aiMsgElement, chunk);
    scrollToBottom();
  });

  const unsubEnd = window.electronAPI.onChatStreamEnd(() => {
    finalizeStreamingMessage(aiMsgElement);
    // Limpa listeners imediatamente após o fim do stream
    unsubText();
    unsubEnd();
  });

  try {
    // ✅ Usa o sessionId persistente (não gera um novo a cada mensagem)
    window.electronAPI.send('chat:start-stream', { text, sessionId });
  } catch (error) {
    console.error('Erro ao iniciar stream:', error);
    addMessage('Erro ao processar sua mensagem.', 'ai');
    unsubText();
    unsubEnd();
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
  }
}





  // Temas predefinidos (CSS Variables)
  const themes = {
    'dark-translucent': {
      '--bg-primary': 'rgba(10, 10, 12, 0.85)',
      '--bg-secondary': 'rgba(20, 20, 25, 0.75)',
      '--bg-input': 'rgba(40, 40, 50, 0.6)',
      '--text-primary': '#e2e8f0',
      '--accent': '#6366f1' // Indigo
    },
    'midnight-blue': {
      '--bg-primary': 'rgba(15, 23, 42, 0.9)',
      '--bg-secondary': 'rgba(30, 41, 59, 0.8)',
      '--bg-input': 'rgba(51, 65, 85, 0.7)',
      '--text-primary': '#f1f5f9',
      '--accent': '#3b82f6' // Blue
    },
    'forest-dark': {
      '--bg-primary': 'rgba(10, 20, 15, 0.9)',
      '--bg-secondary': 'rgba(20, 40, 30, 0.8)',
      '--bg-input': 'rgba(30, 60, 40, 0.7)',
      '--text-primary': '#e2e8f0',
      '--accent': '#10b981' // Emerald
    }
  };

  function init() {
    loadSettings(); // Carrega preferências salvas
    
    chatForm.addEventListener('submit', handleSendMessage);
    userInput.focus();
    
    // Mensagem inicial apenas se não houver histórico (opcional, mantendo simples)
    addMessage('Olá! Como posso ajudar você hoje?', 'ai');
    
    initResizeHandles();
    setupKeyboardShortcuts();
    setupSettingsListeners();
  }

  function setupSettingsListeners() {
    // Abrir/Fechar Modal
    settingsBtn.addEventListener('click', () => settingsModal.classList.add('active'));
    closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
    
    // Fechar ao clicar fora
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('active');
    });

    // Mudança de Tema
    themeSelect.addEventListener('change', (e) => {
      applyTheme(e.target.value);
      saveSettings();
    });

    // Mudança de Fonte
    fontSelect.addEventListener('change', (e) => {
      document.documentElement.style.setProperty('--font-family', e.target.value);
      saveSettings();
    });

    // Mudança de Cor
    accentColorPicker.addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--accent', e.target.value);
      // Atualiza o hover também (escurece um pouco a cor selecionada)
      const hex = e.target.value;
      // Função simples para escurecer HEX (apenas visual básico)
      document.documentElement.style.setProperty('--accent-hover', adjustColor(hex, -20)); 
      saveSettings();
    });
  }

  function applyTheme(themeName) {
    const themeVars = themes[themeName];
    if (!themeVars) return;

    for (const [key, value] of Object.entries(themeVars)) {
      document.documentElement.style.setProperty(key, value);
    }
    
    // Sincroniza o seletor de cor com o tema escolhido
    accentColorPicker.value = themeVars['--accent'];
  }

  function loadSettings() {
    const savedTheme = localStorage.getItem('lyly_theme') || 'dark-translucent';
    const savedFont = localStorage.getItem('lyly_font') || "'Inter', sans-serif";
    const savedAccent = localStorage.getItem('lyly_accent');

    // Aplica Tema
    themeSelect.value = savedTheme;
    applyTheme(savedTheme);

    // Aplica Fonte
    fontSelect.value = savedFont;
    document.documentElement.style.setProperty('--font-family', savedFont);

    // Aplica Cor Customizada (se existir e sobrescreve o do tema)
    if (savedAccent) {
      accentColorPicker.value = savedAccent;
      document.documentElement.style.setProperty('--accent', savedAccent);
    }
  }

  function saveSettings() {
    localStorage.setItem('lyly_theme', themeSelect.value);
    localStorage.setItem('lyly_font', fontSelect.value);
    localStorage.setItem('lyly_accent', accentColorPicker.value);
  }

  // Utilitário para ajustar brilho de cor HEX (para hover)
  function adjustColor(color, amount) {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'x') {
        e.preventDefault();
        window.electronAPI.toggleVisibility();
      }
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        window.electronAPI.toggleIgnoreMouse();
      }
    });
  }

  function initResizeHandles() {
      const handles = document.querySelectorAll('.resize-handle');
      handles.forEach(h => {
          h.addEventListener('mousedown', (e) => {
              e.preventDefault();
              isResizing = true;
              currentDir = h.dataset.dir;
              startX = e.clientX;
              startY = e.clientY;
              window.electronAPI.invoke('get-bounds').then(bounds => {
                  if (bounds) {
                      startW = bounds.width;
                      startH = bounds.height;
                      startXPos = bounds.x;
                      startYPos = bounds.y;
                  }
              });
          });
      });
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      window.electronAPI.resize(currentDir, { x: dx, y: dy });
  }

  function onMouseUp() {
      isResizing = false;
      currentDir = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
  }

  function addMessage(text, sender) {
    const msgElement = createMessageElement(text, sender);
    chatMessages.appendChild(msgElement);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }


  function createMessageElement(text, sender) {
      const div = document.createElement('div');
      div.className = `message ${sender}`;
      div.textContent = text;
      return div;
  }

  document.addEventListener('DOMContentLoaded', init);
})();