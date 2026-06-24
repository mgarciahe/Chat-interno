// Application State
let currentUser = null;
let activeChannel = null;
let ws = null;
let reconnectTimer = null;

// DOM Elements
const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const loginCharCounter = document.getElementById('login-char-counter');
const loginError = document.getElementById('login-error');

const channelsList = document.getElementById('channels-list');
const createChannelForm = document.getElementById('create-channel-form');
const newChannelInput = document.getElementById('new-channel-input');
const createChannelError = document.getElementById('create-channel-error');

const activeChannelName = document.getElementById('active-channel-name');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageCharCounter = document.getElementById('message-char-counter');
const messageError = document.getElementById('message-error');

const connectionsCount = document.getElementById('connections-count');
const profileInitials = document.getElementById('profile-initials');
const currentUsername = document.getElementById('current-username');
const logoutBtn = document.getElementById('logout-btn');

// Character counters
usernameInput.addEventListener('input', () => {
  loginCharCounter.textContent = `${usernameInput.value.length}/32`;
});

messageInput.addEventListener('input', () => {
  messageCharCounter.textContent = `${messageInput.value.length}/2000`;
  
  // Auto-resize textarea height based on content
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});

// Initialize App
async function init() {
  try {
    const response = await fetch('/api/session');
    const data = await response.json();
    
    if (data.username) {
      currentUser = data.username;
      showWorkspace();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

// Show Login Screen
function showLogin() {
  loginContainer.classList.remove('hidden');
  mainContainer.classList.add('hidden');
  loginError.classList.add('hidden');
  usernameInput.value = '';
  loginCharCounter.textContent = '0/32';
}

// Show Chat Workspace
async function showWorkspace() {
  loginContainer.classList.add('hidden');
  mainContainer.classList.remove('hidden');
  
  // Set profile info
  currentUsername.textContent = currentUser;
  profileInitials.textContent = currentUser.substring(0, 2).toUpperCase();
  
  // Load channels and connect WebSocket
  await loadChannels();
  connectWebSocket();
}

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  
  const username = usernameInput.value.trim();
  if (username.length === 0) {
    showError(loginError, 'El nombre no puede estar vacio');
    return;
  }
  
  if (username.length > 32) {
    showError(loginError, 'El nombre no puede superar 32 caracteres');
    return;
  }

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentUser = data.username;
      showWorkspace();
    } else {
      showError(loginError, data.error || 'Error al iniciar sesion');
    }
  } catch (err) {
    showError(loginError, 'Error al conectar con el servidor');
  }
});

// Logout Button Click
logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/session', { method: 'DELETE' });
  } catch (err) {
    // Ignore and proceed with cleanup
  }
  
  currentUser = null;
  activeChannel = null;
  
  if (ws) {
    ws.close();
    ws = null;
  }
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  showLogin();
});

// Load Channels from Server
async function loadChannels() {
  try {
    const response = await fetch('/api/channels');
    if (!response.ok) throw new Error();
    const channels = await response.json();
    
    renderChannels(channels);
  } catch (err) {
    console.error('Error al cargar canales:', err);
  }
}

// Render Channels List in Sidebar
function renderChannels(channels) {
  channelsList.innerHTML = '';
  
  channels.forEach(channel => {
    const li = document.createElement('li');
    li.className = 'channel-item';
    if (activeChannel && activeChannel._id === channel._id) {
      li.classList.add('active');
    }
    
    const hashtag = document.createElement('span');
    hashtag.className = 'channel-hashtag';
    hashtag.textContent = '#';
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = channel.name;
    
    li.appendChild(hashtag);
    li.appendChild(nameSpan);
    
    li.addEventListener('click', () => selectChannel(channel));
    channelsList.appendChild(li);
  });
}

// Create Channel Form Submit
createChannelForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createChannelError.classList.add('hidden');
  
  const name = newChannelInput.value.trim();
  if (name.length === 0) {
    showError(createChannelError, 'El nombre del canal no puede estar vacio');
    return;
  }
  
  if (name.length > 64) {
    showError(createChannelError, 'El nombre del canal no puede superar 64 caracteres');
    return;
  }

  try {
    const response = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      newChannelInput.value = '';
      createChannelError.classList.add('hidden');
      // Selection of new channel is optional, we just wait for the websocket broadcast to populate it
    } else {
      showError(createChannelError, data.error || 'Error al crear el canal');
    }
  } catch (err) {
    showError(createChannelError, 'Error al conectar con el servidor');
  }
});

// Select and Load Channel Messages
async function selectChannel(channel) {
  if (activeChannel && activeChannel._id === channel._id) {
    return; // Already selected
  }
  
  activeChannel = channel;
  activeChannelName.textContent = channel.name;
  
  // Highlight active channel in UI list
  const items = channelsList.querySelectorAll('.channel-item');
  items.forEach(item => {
    if (item.querySelector('span:last-child').textContent === channel.name) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Show message input form
  messageForm.classList.remove('hidden');
  messageError.classList.add('hidden');
  messageInput.value = '';
  messageCharCounter.textContent = '0/2000';
  messageInput.style.height = 'auto';

  // Subscribe via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'subscribe',
      channelName: channel.name
    }));
  }

  // Load message history
  await loadMessageHistory(channel._id);
}

// Load messages history from REST API
async function loadMessageHistory(channelId) {
  messagesContainer.innerHTML = '';
  
  try {
    const response = await fetch(`/api/channels/${channelId}/messages`);
    
    if (response.status === 503) {
      showToastError('La base de datos no esta disponible. Reintentando...');
      return;
    }
    
    if (!response.ok) throw new Error();
    const messages = await response.json();
    
    if (messages.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'welcome-message';
      emptyDiv.textContent = 'Este es el comienzo del canal. Envia un mensaje para iniciar la conversacion.';
      messagesContainer.appendChild(emptyDiv);
    } else {
      messages.forEach(msg => {
        appendMessageUI(msg, false);
      });
    }
    
    // Always scroll to bottom for newly selected channel
    scrollToBottom(true);
  } catch (err) {
    console.error('Error al cargar el historial de mensajes:', err);
  }
}

// Render message content safely (XSS-proof, links and images extraction)
function renderSafeMessageContent(content) {
  const container = document.createElement('div');
  container.className = 'message-text-content';

  // Match URLs
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);

  parts.forEach(part => {
    if (urlRegex.test(part)) {
      // Check if URL ends with popular image extension (case insensitive)
      const isImage = /\.(jpeg|jpg|gif|png|webp|svg)(?:\?.*)?$/i.test(part);
      if (isImage) {
        const img = document.createElement('img');
        img.src = part;
        img.alt = 'Imagen compartida';
        img.className = 'shared-image';
        img.loading = 'lazy';
        
        // When the image loads, verify if we need to adjust scroll
        img.addEventListener('load', () => {
          // Trigger a soft scroll correction if needed
          if (isNearBottom()) {
            scrollToBottom(false);
          }
        });
        
        container.appendChild(img);
      } else {
        const link = document.createElement('a');
        link.href = part;
        link.textContent = part;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        container.appendChild(link);
      }
    } else {
      if (part) {
        container.appendChild(document.createTextNode(part));
      }
    }
  });

  return container;
}

// Append message element to UI
function appendMessageUI(msg, checkScroll = true) {
  // Remove welcome message if present
  const welcome = messagesContainer.querySelector('.welcome-message');
  if (welcome) {
    welcome.remove();
  }

  const card = document.createElement('div');
  card.className = 'message-card';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = msg.author.substring(0, 2).toUpperCase();

  const body = document.createElement('div');
  body.className = 'message-body';

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = msg.author;

  const time = document.createElement('span');
  time.className = 'message-time';
  
  // Format to HH:MM in local timezone
  const date = new Date(msg.createdAt);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  time.textContent = `${hours}:${minutes}`;

  meta.appendChild(author);
  meta.appendChild(time);
  
  const contentNode = renderSafeMessageContent(msg.content);

  body.appendChild(meta);
  body.appendChild(contentNode);

  card.appendChild(avatar);
  card.appendChild(body);

  messagesContainer.appendChild(card);
}

// Send Message Form Submit
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  messageError.classList.add('hidden');

  const content = messageInput.value;
  if (content.trim().length === 0) {
    return; // Ignore empty messages
  }

  if (content.length > 2000) {
    showToastError('El mensaje excede la longitud maxima permitida');
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN && activeChannel) {
    ws.send(JSON.stringify({
      type: 'message',
      channelName: activeChannel.name,
      content: content
    }));

    // Reset input fields
    messageInput.value = '';
    messageCharCounter.textContent = '0/2000';
    messageInput.style.height = 'auto';
  } else {
    showToastError('No hay conexion con el servidor. Reintentando...');
  }
});

// Textarea enter behavior (Enter sends, Shift+Enter breaks line)
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messageForm.dispatchEvent(new Event('submit'));
  }
});

// Scroll helpers
function isNearBottom() {
  const threshold = 50; // px from bottom
  const position = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
  return position <= threshold;
}

function scrollToBottom(force = false) {
  if (force || isNearBottom()) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Show normal element error
function showError(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

// Show toast notification for message errors
function showToastError(message) {
  messageError.textContent = message;
  messageError.classList.remove('hidden');
  setTimeout(() => {
    messageError.classList.add('hidden');
  }, 4000);
}

// WebSocket Connection Management
function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connection established.');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Re-subscribe if we had an active channel before disconnecting
    if (activeChannel) {
      ws.send(JSON.stringify({
        type: 'subscribe',
        channelName: activeChannel.name
      }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'connection_count':
          connectionsCount.textContent = data.count;
          break;

        case 'channel_created':
          // Reload the channels list in sidebar
          loadChannels();
          break;

        case 'message':
          if (activeChannel && data.channelName === activeChannel.name) {
            const nearBottom = isNearBottom();
            appendMessageUI(data.message);
            if (nearBottom) {
              scrollToBottom(true);
            }
          }
          break;

        case 'error':
          showToastError(data.message);
          break;
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed. Retrying...');
    // Attempt automatic reconnection
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

// Handle resizing window to prevent horizontal scroll issues dynamically if any
window.addEventListener('resize', () => {
  scrollToBottom(false);
});

// Run Initializer
init();
