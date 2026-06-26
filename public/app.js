// Application State
let currentUser = null;
let currentUserId = null;
let activeChannel = null;
let ws = null;
let reconnectTimer = null;
const unlockedPrivateChannels = new Set();
let pendingChannelToUnlock = null;

// DOM Elements
const loginContainer = document.getElementById('login-container');
const mainContainer = document.getElementById('main-container');

// Auth page elements
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

const loginForm = document.getElementById('login-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginError = document.getElementById('login-error');

const registerForm = document.getElementById('register-form');
const registerEmailInput = document.getElementById('register-email');
const registerUsernameInput = document.getElementById('register-username');
const registerPasswordInput = document.getElementById('register-password');
const registerCharCounter = document.getElementById('register-char-counter');
const registerError = document.getElementById('register-error');

const channelsList = document.getElementById('channels-list');
const createChannelForm = document.getElementById('create-channel-form');
const newChannelInput = document.getElementById('new-channel-input');
const newChannelKey = document.getElementById('new-channel-key');
const createChannelError = document.getElementById('create-channel-error');
// R1: Type selector buttons
const typeBtnPublic = document.getElementById('type-btn-public');
const typeBtnPrivate = document.getElementById('type-btn-private');
let selectedChannelType = 'public'; // 'public' | 'private'

const activeChannelName = document.getElementById('active-channel-name');
const channelActions = document.getElementById('channel-actions');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messageCharCounter = document.getElementById('message-char-counter');
const messageError = document.getElementById('message-error');

const connectionsCount = document.getElementById('connections-count');
const profileInitials = document.getElementById('profile-initials');
const currentUsername = document.getElementById('current-username');
const logoutBtn = document.getElementById('logout-btn');

// Private Channel Key Modal Elements (Requirement 3.1)
const keyModal = document.getElementById('key-modal');
const keyForm = document.getElementById('key-form');
const channelAccessKeyInput = document.getElementById('channel-access-key');
const keyError = document.getElementById('key-error');
const cancelKeyBtn = document.getElementById('cancel-key-btn');
const confirmKeyBtn = document.getElementById('confirm-key-btn');

// R1 + R2: Type selector toggle logic
function setChannelType(type) {
  selectedChannelType = type;
  if (type === 'private') {
    typeBtnPrivate.classList.add('active');
    typeBtnPublic.classList.remove('active');
    newChannelKey.classList.remove('hidden');
    newChannelKey.setAttribute('required', '');
  } else {
    typeBtnPublic.classList.add('active');
    typeBtnPrivate.classList.remove('active');
    newChannelKey.classList.add('hidden');
    newChannelKey.removeAttribute('required');
    newChannelKey.value = '';
  }
}

typeBtnPublic.addEventListener('click', () => setChannelType('public'));
typeBtnPrivate.addEventListener('click', () => setChannelType('private'));

// Character counters
registerUsernameInput.addEventListener('input', () => {
  registerCharCounter.textContent = `${registerUsernameInput.value.length}/32`;
});

messageInput.addEventListener('input', () => {
  messageCharCounter.textContent = `${messageInput.value.length}/2000`;
  
  // Auto-resize textarea height based on content
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
});

// Tab Switching
tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  authTitle.textContent = 'Iniciar Sesión';
  authSubtitle.textContent = 'Ingresa tus credenciales para acceder al chat';
  loginError.classList.add('hidden');
  registerError.classList.add('hidden');
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  authTitle.textContent = 'Registrarse';
  authSubtitle.textContent = 'Crea una cuenta para comenzar a chatear';
  loginError.classList.add('hidden');
  registerError.classList.add('hidden');
});

// Initialize App
async function init() {
  try {
    const response = await fetch('/api/session');
    const data = await response.json();
    
    if (data.username) {
      currentUser = data.username;
      currentUserId = data.userId;
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
  registerError.classList.add('hidden');
  loginEmailInput.value = '';
  loginPasswordInput.value = '';
  registerEmailInput.value = '';
  registerUsernameInput.value = '';
  registerPasswordInput.value = '';
  registerCharCounter.textContent = '0/32';
  
  // Reset private channels states (Requirement 10.4)
  currentUserId = null;
  unlockedPrivateChannels.clear();
  pendingChannelToUnlock = null;
  if (newChannelKey) newChannelKey.value = '';
  
  // Default to login tab
  tabLogin.click();
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
  
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  
  if (email.length === 0 || password.length === 0) {
    showError(loginError, 'El correo y la contraseña son requeridos');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentUser = data.username;
      currentUserId = data.userId;
      showWorkspace();
    } else {
      showError(loginError, data.error || 'Error al iniciar sesion');
    }
  } catch (err) {
    showError(loginError, 'Error al conectar con el servidor');
  }
});

// Register Form Submit
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.classList.add('hidden');
  
  const email = registerEmailInput.value.trim();
  const username = registerUsernameInput.value.trim();
  const password = registerPasswordInput.value;
  
  if (email.length === 0 || username.length === 0 || password.length === 0) {
    showError(registerError, 'Todos los campos son requeridos');
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentUser = data.username;
      currentUserId = data.userId;
      showWorkspace();
    } else {
      showError(registerError, data.error || 'Error al crear la cuenta');
    }
  } catch (err) {
    showError(registerError, 'Error al conectar con el servidor');
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
    hashtag.textContent = channel.isPrivate ? '🔒' : '#'; // (Requirement 2.3)
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = channel.name;
    
    li.appendChild(hashtag);
    li.appendChild(nameSpan);
    
    li.addEventListener('click', () => selectChannel(channel));
    channelsList.appendChild(li);
  });
}

// Create Channel Form Submit (R3, R4)
createChannelForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createChannelError.classList.add('hidden');

  // R3.3: Validate name
  const name = newChannelInput.value.trim();
  if (name.length === 0) {
    showError(createChannelError, 'El nombre del canal no puede estar vacío');
    return;
  }
  if (name.length > 64) {
    showError(createChannelError, 'El nombre del canal no puede superar 64 caracteres');
    return;
  }

  const isPrivate = selectedChannelType === 'private';
  const accessKey = newChannelKey.value;

  // R3.1: Key required when private
  if (isPrivate && accessKey.trim() === '') {
    showError(createChannelError, 'La clave de acceso es obligatoria para canales privados');
    return;
  }

  // R3.2: Key format validation
  if (isPrivate && !/^[a-zA-Z0-9]{7}$/.test(accessKey)) {
    showError(createChannelError, 'La clave debe tener exactamente 7 caracteres alfanuméricos');
    return;
  }

  // R3.4: Build payload
  const payload = { name, isPrivate };
  if (isPrivate) payload.accessKey = accessKey;

  try {
    const response = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      // R7.1 + R7.2: Reset form to clean public state
      newChannelInput.value = '';
      setChannelType('public');
      createChannelError.classList.add('hidden');
    } else {
      // R7.3: Keep values on error so user can retry
      showError(createChannelError, data.error || 'Error al crear el canal');
    }
  } catch (err) {
    showError(createChannelError, 'Error al conectar con el servidor');
  }
});

// Select and Load Channel Messages
async function selectChannel(channel) {
  // If user is not the creator, is it private, and they haven't verified it yet?
  const isCreator = channel.creatorId === currentUserId;
  if (channel.isPrivate && !isCreator && !unlockedPrivateChannels.has(channel._id)) {
    // Attempt message loading first to check server-side verifiedChannels session state
    try {
      const response = await fetch(`/api/channels/${channel._id}/messages`);
      if (response.status === 403) {
        // Not verified yet: open key modal (Requirement 3.1)
        pendingChannelToUnlock = channel;
        openKeyPromptModal();
        return;
      } else if (!response.ok) {
        showToastError('Error al acceder al canal');
        return;
      } else {
        // Already verified on server, update client state
        unlockedPrivateChannels.add(channel._id);
      }
    } catch (err) {
      showToastError('Error de conexión');
      return;
    }
  }

  if (activeChannel && activeChannel._id === channel._id) {
    return; // Already selected
  }
  
  activeChannel = channel;
  
  // Set active channel name and lock/unlocked icons (Requirement 7.5)
  activeChannelName.innerHTML = '';
  if (channel.isPrivate) {
    const lockIcon = document.createElement('span');
    lockIcon.className = 'lock-icon';
    lockIcon.textContent = '🔓 ';
    activeChannelName.appendChild(lockIcon);
  }
  const nameText = document.createTextNode(channel.name);
  activeChannelName.appendChild(nameText);
  
  // Render buttons in active channel actions container (Requirement 9.3, 10.3)
  if (channelActions) {
    channelActions.innerHTML = '';
    const activeIsCreator = channel.creatorId === currentUserId;
    if (activeIsCreator) {
      const deleteBtn = document.createElement('button');
      deleteBtn.id = 'delete-channel-btn';
      deleteBtn.className = 'btn-header-danger';
      deleteBtn.textContent = 'Eliminar Canal';
      deleteBtn.addEventListener('click', deleteActiveChannel);
      channelActions.appendChild(deleteBtn);
    } else {
      const leaveBtn = document.createElement('button');
      leaveBtn.id = 'leave-channel-btn';
      leaveBtn.className = 'btn-header-secondary';
      leaveBtn.textContent = 'Salir del Canal';
      leaveBtn.addEventListener('click', leaveActiveChannel);
      channelActions.appendChild(leaveBtn);
    }
  }

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
  
  let contentNode;
  if (msg.type === 'audio') {
    const audioWrapper = document.createElement('div');
    audioWrapper.className = 'message-audio-container';
    
    const audioElement = document.createElement('audio');
    audioElement.src = msg.audioUrl;
    audioElement.controls = true;
    audioElement.className = 'message-audio-player';
    
    // Set fallback error handler if file is missing (Requirement 4.4)
    audioElement.onerror = () => {
      const errorSpan = document.createElement('span');
      errorSpan.className = 'audio-unavailable-msg';
      errorSpan.textContent = 'Audio no disponible';
      audioElement.replaceWith(errorSpan);
    };
    
    audioWrapper.appendChild(audioElement);
    contentNode = audioWrapper;
  } else {
    contentNode = renderSafeMessageContent(msg.content);
  }

  body.appendChild(meta);
  body.appendChild(contentNode);

  card.appendChild(avatar);
  card.appendChild(body);

  messagesContainer.appendChild(card);
  
  if (checkScroll) {
    scrollToBottom();
  }
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

  ws.onmessage = async (event) => {
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

        case 'channel_deleted':
          // Reload the channels list in sidebar (Requirement 9.6)
          await loadChannels();
          // If the deleted channel was the active channel, clear view
          if (activeChannel && activeChannel._id === data.channelId) {
            activeChannel = null;
            activeChannelName.textContent = 'Selecciona un canal';
            messagesContainer.innerHTML = `
              <div class="welcome-message">
                <p>El canal activo ha sido eliminado por su creador.</p>
              </div>
            `;
            messageForm.classList.add('hidden');
            if (channelActions) channelActions.innerHTML = '';
          }
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

// Audio Recording State Variables
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingStartTime = null;

// Get recording DOM elements
const recordBtn = document.getElementById('record-btn');
const recordingContainer = document.getElementById('recording-container');
const recordingTimer = document.getElementById('recording-timer');
const cancelRecordBtn = document.getElementById('cancel-record-btn');
const stopRecordBtn = document.getElementById('stop-record-btn');

// Attach recording event listeners
if (recordBtn) recordBtn.addEventListener('click', startRecording);
if (cancelRecordBtn) cancelRecordBtn.addEventListener('click', cancelRecording);
if (stopRecordBtn) stopRecordBtn.addEventListener('click', stopAndSendRecording);

async function startRecording() {
  try {
    // Request permission (Requirement 1.1)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Set up MediaRecorder in audio/webm with codecs=opus (Requirement 1.2)
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Stop all tracks to release microphone (good practice)
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    
    // Show recording UI (Requirement 1.4)
    messageForm.classList.add('hidden');
    recordingContainer.classList.remove('hidden');
    
    recordingStartTime = Date.now();
    updateTimer();
    recordingInterval = setInterval(updateTimer, 1000);
  } catch (err) {
    // Permission denied (Requirement 1.3)
    showToastError('El acceso al micrófono es necesario para grabar audio');
  }
}

function updateTimer() {
  const elapsedSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
  
  // Format MM:SS
  const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const secs = String(elapsedSeconds % 60).padStart(2, '0');
  recordingTimer.textContent = `${mins}:${secs}`;
  
  // Max duration 120s limit (Requirement 1.6)
  if (elapsedSeconds >= 120) {
    showToastError('Se ha alcanzado la duración máxima de grabación (120s)');
    stopAndSendRecording();
  }
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  clearInterval(recordingInterval);
  cleanupRecordingState();
}

async function stopAndSendRecording() {
  clearInterval(recordingInterval);
  
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    cleanupRecordingState();
    return;
  }
  
  // Wait for mediaRecorder to stop completely and finalize Blob
  const stopPromise = new Promise(resolve => {
    mediaRecorder.onstop = () => {
      resolve();
    };
  });
  
  mediaRecorder.stop();
  await stopPromise;
  
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
  
  // Client validation (Requirement 5.1)
  if (duration <= 0 || audioBlob.size === 0) {
    showToastError('La grabación es demasiado corta');
    cleanupRecordingState();
    return;
  }

  // Show loading indicator (Requirement 5.2)
  stopRecordBtn.textContent = 'Enviando...';
  stopRecordBtn.disabled = true;
  cancelRecordBtn.disabled = true;

  // Send multipart/form-data to server (Requirement 2.1)
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  try {
    const response = await fetch(`/api/channels/${activeChannel._id}/audio`, {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      // Success (Requirement 5.4)
      cleanupRecordingState();
    } else {
      // Server error (Requirement 5.3)
      const data = await response.json();
      showToastError(data.error || 'Error al enviar el audio');
      resetLoadingState();
    }
  } catch (err) {
    showToastError('Error de red al enviar el audio');
    resetLoadingState();
  }
}

function resetLoadingState() {
  stopRecordBtn.textContent = 'Enviar Audio';
  stopRecordBtn.disabled = false;
  cancelRecordBtn.disabled = false;
}

function cleanupRecordingState() {
  recordingContainer.classList.add('hidden');
  messageForm.classList.remove('hidden');
  stopRecordBtn.textContent = 'Enviar Audio';
  stopRecordBtn.disabled = false;
  cancelRecordBtn.disabled = false;
  mediaRecorder = null;
  audioChunks = [];
}

// Modal functions (Requirement 3.4, 7.1 - 7.4)
function openKeyPromptModal() {
  if (keyModal) {
    keyModal.classList.remove('hidden');
    channelAccessKeyInput.value = '';
    keyError.classList.add('hidden');
    channelAccessKeyInput.focus();
  }
}

function closeKeyPromptModal() {
  if (keyModal) {
    keyModal.classList.add('hidden');
    keyError.classList.add('hidden');
    pendingChannelToUnlock = null;
  }
}

if (cancelKeyBtn) {
  cancelKeyBtn.addEventListener('click', () => {
    closeKeyPromptModal();
  });
}

if (keyForm) {
  keyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    keyError.classList.add('hidden');

    const accessKey = channelAccessKeyInput.value;
    if (!/^[a-zA-Z0-9]{7}$/.test(accessKey)) {
      showError(keyError, 'La clave debe tener exactamente 7 caracteres alfanuméricos');
      return;
    }

    if (!pendingChannelToUnlock) return;

    // Loading state (Requirement 7.1)
    confirmKeyBtn.disabled = true;
    cancelKeyBtn.disabled = true;
    confirmKeyBtn.textContent = 'Confirmando...';

    try {
      const response = await fetch(`/api/channels/${pendingChannelToUnlock._id}/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessKey })
      });

      const data = await response.json();

      if (response.ok) {
        // Success: unlock channel (Requirement 7.2)
        unlockedPrivateChannels.add(pendingChannelToUnlock._id);
        const channelToOpen = pendingChannelToUnlock;
        closeKeyPromptModal();
        await selectChannel(channelToOpen);
      } else if (response.status === 403) {
        // Incorrect key (Requirement 7.3)
        showError(keyError, 'Clave incorrecta. Inténtalo de nuevo.');
      } else {
        showError(keyError, data.error || 'Error al validar la clave.');
      }
    } catch (err) {
      // Network error (Requirement 7.4)
      showError(keyError, 'Error de conexión. Inténtalo de nuevo.');
    } finally {
      // Reset loading state
      confirmKeyBtn.disabled = false;
      cancelKeyBtn.disabled = false;
      confirmKeyBtn.textContent = 'Confirmar';
    }
  });
}

// Delete Channel by Creator (Requirement 9)
async function deleteActiveChannel() {
  if (!activeChannel) return;
  if (!confirm(`¿Estás seguro de que deseas eliminar el canal "${activeChannel.name}"? Esta acción borrará todos sus mensajes permanentemente.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/channels/${activeChannel._id}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (response.ok) {
      // Handled by WebSocket message 'channel_deleted'
    } else {
      showToastError(data.error || 'Error al eliminar el canal');
    }
  } catch (err) {
    showToastError('Error de conexión al eliminar el canal');
  }
}

// Leave Channel by Member (Requirement 10)
async function leaveActiveChannel() {
  if (!activeChannel) return;
  if (!confirm(`¿Estás seguro de que deseas salir del canal "${activeChannel.name}"?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/channels/${activeChannel._id}/membership`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (response.ok) {
      // Invalidate local cache of key
      unlockedPrivateChannels.delete(activeChannel._id);

      // Reset Active Channel
      activeChannel = null;
      activeChannelName.textContent = 'Selecciona un canal';
      messagesContainer.innerHTML = `
        <div class="welcome-message">
          <p>Selecciona un canal del panel izquierdo para comenzar a chatear.</p>
        </div>
      `;
      messageForm.classList.add('hidden');
      if (channelActions) channelActions.innerHTML = '';

      // Reload channels in sidebar
      await loadChannels();
    } else {
      showToastError(data.error || 'Error al salir del canal');
    }
  } catch (err) {
    showToastError('Error de conexión al salir del canal');
  }
}

// Run Initializer
init();
