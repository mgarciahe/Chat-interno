require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cookie = require('cookie');

const Channel = require('./models/Channel');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/secure-chat';
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-default-secret-key-12345';

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB successfully.');
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });

// Database availability middleware
const checkDbConnection = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'La base de datos no esta disponible' });
  }
  next();
};

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "*"], // Allow images from any source for sharing
      connectSrc: ["'self'", "ws:", "wss:"]
    }
  }
}));

// CORS setup
app.use(cors({
  origin: true,
  credentials: true
}));

// Rate limiter for API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones desde esta IP, por favor intente mas tarde' }
});

// Rate limiter specifically for creating resources
const creationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 resource creations per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de creacion excedido, por favor intente mas tarde' }
});

app.use(express.json());
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Session login
app.post('/api/session', checkDbConnection, (req, res) => {
  const { username } = req.body;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'El nombre de pantalla no puede estar vacio' });
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length === 0) {
    return res.status(400).json({ error: 'El nombre de pantalla no puede estar vacio' });
  }

  if (trimmedUsername.length > 32) {
    return res.status(400).json({ error: 'El nombre de pantalla no puede superar 32 caracteres' });
  }

  // Set signed cookie for session identity
  res.cookie('username', trimmedUsername, {
    signed: true,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 1 day
  });

  return res.json({ username: trimmedUsername });
});

// Check current session
app.get('/api/session', (req, res) => {
  const username = req.signedCookies.username;
  if (!username) {
    return res.json({ username: null });
  }
  return res.json({ username });
});

// Logout
app.delete('/api/session', (req, res) => {
  res.clearCookie('username');
  return res.json({ success: true });
});

// Get channels list
app.get('/api/channels', checkDbConnection, async (req, res) => {
  try {
    const channels = await Channel.find({}).sort({ name: 1 });
    return res.json(channels);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener los canales' });
  }
});

// Create new channel
app.post('/api/channels', checkDbConnection, creationLimiter, async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'El nombre del canal no puede estar vacio' });
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return res.status(400).json({ error: 'El nombre del canal no puede estar vacio' });
  }

  if (trimmedName.length > 64) {
    return res.status(400).json({ error: 'El nombre del canal no puede superar 64 caracteres' });
  }

  try {
    const newChannel = new Channel({ name: trimmedName });
    await newChannel.save();

    // Broadcast new channel to all connected WebSockets
    broadcastToAll({
      type: 'channel_created',
      channel: newChannel
    });

    return res.status(201).json(newChannel);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Ya existe un canal con ese nombre' });
    }
    return res.status(500).json({ error: 'Error al crear el canal' });
  }
});

// Get messages for a channel
app.get('/api/channels/:id/messages', checkDbConnection, async (req, res) => {
  const channelId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ error: 'Identificador de canal no valido' });
  }

  try {
    const channelExists = await Channel.findById(channelId);
    if (!channelExists) {
      return res.status(404).json({ error: 'El canal especificado no existe' });
    }

    const messages = await Message.find({ channelId })
      .sort({ createdAt: -1 })
      .limit(50);

    // Return messages in chronological order (oldest to newest)
    return res.json(messages.reverse());
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener el historial de mensajes' });
  }
});

// Realtime active connections counter
let activeConnections = 0;

// Broadcast a message to all connected clients
function broadcastToAll(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Broadcast user count update
function broadcastUserCount() {
  broadcastToAll({
    type: 'connection_count',
    count: activeConnections
  });
}

// WebSocket Upgrade Handling with Cookie Authentication
server.on('upgrade', (request, socket, head) => {
  const parsedCookies = cookie.parse(request.headers.cookie || '');
  const rawCookie = parsedCookies.username || '';
  const username = cookieParser.signedCookie(rawCookie, SESSION_SECRET);

  if (!username) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.username = username; // Store authenticated username on the WebSocket object
    wss.emit('connection', ws, request);
  });
});

// WebSocket Server Event Handlers
wss.on('connection', (ws) => {
  activeConnections++;
  broadcastUserCount();

  // Send initial connection count to the newly connected client
  ws.send(JSON.stringify({
    type: 'connection_count',
    count: activeConnections
  }));

  ws.currentChannel = null;

  ws.on('message', async (messageData) => {
    try {
      const data = JSON.parse(messageData);

      if (data.type === 'subscribe') {
        // Subscribe client to a specific channel
        const { channelName } = data;
        if (channelName && typeof channelName === 'string') {
          ws.currentChannel = channelName.trim();
        }
      } else if (data.type === 'message') {
        const { channelName, content } = data;

        if (!channelName || typeof channelName !== 'string') {
          return;
        }
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
          return;
        }

        const trimmedContent = content.substring(0, 2000); // Enforce max 2000 chars limit

        // Look up channel by name
        const channel = await Channel.findOne({ name: channelName.trim() });
        if (!channel) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'El canal de destino no existe'
          }));
          return;
        }

        // Save message with the authenticated username from session cookie
        const newMessage = new Message({
          channelId: channel._id,
          author: ws.username, // Using secure session username instead of client-supplied author
          content: trimmedContent
        });

        await newMessage.save();

        // Broadcast message to all users subscribed to this channel
        const broadcastPayload = JSON.stringify({
          type: 'message',
          channelName: channel.name,
          message: newMessage
        });

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.currentChannel === channel.name) {
            client.send(broadcastPayload);
          }
        });
      }
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error procesando la solicitud'
      }));
    }
  });

  ws.on('close', () => {
    activeConnections--;
    broadcastUserCount();
  });
});

// Fallback to index.html for single page app routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
