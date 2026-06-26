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
const User = require('./models/User');
const bcrypt = require('bcrypt');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

// Memory session tracking for private channel access (Requirement 5.5)
const verifiedChannels = {}; // userId -> Set of channelIds

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
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'"]
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

// Auth and validation utilities
const DUMMY_HASH = '$2b$10$Kpx13W6nQ808tCjYv/38.eRk0M3Q82Gv4rM8HnJqK/7nI2v1m5x6.';

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [localPart, domainPart] = parts;
  if (localPart.length === 0) return false;
  if (!domainPart.includes('.')) return false;
  return true;
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 8 && password.length <= 128;
}

function validateUsername(username) {
  if (!username || typeof username !== 'string') return false;
  const trimmed = username.trim();
  return trimmed.length >= 1 && trimmed.length <= 32;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 requests per 15 minutes (Requirement 6.1)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de autenticacion, por favor intente mas tarde' }
});

// Helper to set session cookie
function setSessionCookie(res, userId) {
  res.cookie('userId', userId.toString(), {
    signed: true,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours (Requirement 2.4)
  });
}

// API Routes

// Register
app.post('/api/auth/register', checkDbConnection, authLimiter, async (req, res) => {
  const { email, password, username } = req.body;

  // Validate presence first
  if (!email || !password || !username) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }

  // Validate format and constraints (Requirements 1.2, 1.3, 1.4)
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Correo electronico no valido' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 128 caracteres' });
  }
  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'El nombre de pantalla debe tener entre 1 y 32 caracteres' });
  }

  try {
    // Check if email already exists (Requirement 1.5)
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'El correo ya esta en uso' });
    }

    // Hash password with bcrypt cost factor of 10 (Requirement 1.6)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Save user
    const newUser = new User({
      email: normalizedEmail,
      password: passwordHash,
      username: username.trim()
    });
    await newUser.save();

    // Set active session cookie (Requirement 1.1)
    setSessionCookie(res, newUser._id);

    return res.status(201).json({ username: newUser.username, userId: newUser._id });
  } catch (err) {
    return res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// Login
app.post('/api/auth/login', checkDbConnection, authLimiter, async (req, res) => {
  const { email, password } = req.body;

  // Validate presence first before DB query or hashing (Requirement 2.5)
  if (!email || !password || email.trim() === '' || password.trim() === '') {
    return res.status(400).json({ error: 'Correo y contraseña son requeridos' });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    let isMatch = false;
    if (user) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      // Timing attack mitigation: run fake hash comparison (Requirement 6.2)
      await bcrypt.compare(password, DUMMY_HASH);
    }

    if (!isMatch) {
      // Generic error message (Requirement 2.2)
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }

    // Set signed session cookie (Requirement 2.4)
    setSessionCookie(res, user._id);

    return res.json({ username: user.username, userId: user._id });
  } catch (err) {
    return res.status(500).json({ error: 'Error al iniciar sesion' });
  }
});

// Check current session
app.get('/api/session', async (req, res) => {
  const userId = req.signedCookies.userId;
  if (!userId) {
    return res.json({ username: null });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'La base de datos no esta disponible' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ username: null });
    }
    return res.json({ username: user.username, userId: user._id });
  } catch (err) {
    return res.json({ username: null });
  }
});

// Logout
app.delete('/api/session', (req, res) => {
  const userId = req.signedCookies.userId;
  if (userId) {
    delete verifiedChannels[userId.toString()];
  }
  // Clear cookie with exact same options (Requirement 4.2)
  res.clearCookie('userId', {
    signed: true,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production'
  });
  return res.json({ success: true });
});

// Middleware to require authentication (Requirement 3.2, 3.4)
const requireAuth = async (req, res, next) => {
  const userId = req.signedCookies.userId;
  if (!userId) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'La base de datos no esta disponible' });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'No autorizado' });
  }
};

// Get channels list
app.get('/api/channels', requireAuth, checkDbConnection, async (req, res) => {
  try {
    // Exclude accessKeyHash (Requirement 2.2, 6.2)
    const channels = await Channel.find({}).select('-accessKeyHash').sort({ name: 1 });
    return res.json(channels);
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener los canales' });
  }
});

// Create new channel
app.post('/api/channels', requireAuth, checkDbConnection, creationLimiter, async (req, res) => {
  const { name, isPrivate: isPrivateRaw, accessKey } = req.body;

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

  // R4.3: isPrivate must be declared explicitly as a boolean
  const isPrivate = isPrivateRaw === true || isPrivateRaw === 'true';
  const hasKey = typeof accessKey === 'string' && accessKey.trim() !== '';

  // R5.1: Private channel without key
  if (isPrivate && !hasKey) {
    return res.status(400).json({ error: 'La clave de acceso es obligatoria para canales privados' });
  }

  // R5.2: Private channel with invalid key format
  if (isPrivate && hasKey && !/^[a-zA-Z0-9]{7}$/.test(accessKey)) {
    return res.status(400).json({ error: 'La clave debe tener exactamente 7 caracteres alfanuméricos' });
  }

  // R5.3: Public channel with key provided
  if (!isPrivate && hasKey) {
    return res.status(400).json({ error: 'Los canales públicos no pueden tener clave de acceso' });
  }

  // R4.1 + R4.2: Build channel data
  let accessKeyHash = null;
  if (isPrivate && hasKey) {
    try {
      accessKeyHash = await bcrypt.hash(accessKey, 10);
    } catch (hashErr) {
      return res.status(500).json({ error: 'Error al procesar la clave de acceso' });
    }
  }

  try {
    const newChannel = new Channel({
      name: trimmedName,
      creatorId: req.user._id,
      isPrivate,
      accessKeyHash,
      members: []
    });
    await newChannel.save();

    // Sanitize for broadcast — never expose the hash (R4.2)
    const channelObj = newChannel.toObject();
    delete channelObj.accessKeyHash;

    // Broadcast new channel to all connected WebSockets
    broadcastToAll({
      type: 'channel_created',
      channel: channelObj
    });

    return res.status(201).json(channelObj);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Ya existe un canal con ese nombre' });
    }
    return res.status(500).json({ error: 'Error al crear el canal' });
  }
});

// Get messages for a channel
app.get('/api/channels/:id/messages', requireAuth, checkDbConnection, async (req, res) => {
  const channelId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ error: 'Identificador de canal no valido' });
  }

  try {
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'El canal especificado no existe' });
    }

    const userId = req.user._id.toString();
    const isCreator = channel.creatorId && channel.creatorId.toString() === userId;

    if (channel.isPrivate) {
      const hasVerified = verifiedChannels[userId] && verifiedChannels[userId].has(channelId);
      if (!isCreator && !hasVerified) {
        return res.status(403).json({ error: 'Acceso denegado: se requiere clave de acceso' });
      }
    } else {
      // Public channel: if not the creator, automatically add to members (Requirement 1.16)
      if (!isCreator) {
        await Channel.findByIdAndUpdate(channelId, { $addToSet: { members: req.user._id } });
      }
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

// Magic bytes validation for audio files (Requirement 7.1)
function checkMagicBytes(filePath) {
  const buffer = Buffer.alloc(12);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  // WebM: 1A 45 DF A3
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return 'audio/webm';
  }
  // Ogg: 4F 67 67 53 ("OggS")
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'audio/ogg';
  }
  // MP4: check for "ftyp" (bytes 4-7: 66 74 79 70)
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return 'audio/mp4';
  }
  return null;
}

// Multer setup for audio upload (Requirement 2.1, 2.3)
const uploadDir = path.join(__dirname, 'uploads', 'audio');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: path.join(__dirname, 'uploads', 'temp'), // Temporary folder for uploads
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB strict limit (Requirement 2.3)
});

const uploadSingleAudio = upload.single('audio');

// Audio upload API (Requirement 2.1 - 2.7)
app.post('/api/channels/:id/audio', requireAuth, checkDbConnection, creationLimiter, (req, res) => {
  uploadSingleAudio(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo supera el limite de 10 MB' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(500).json({ error: 'Error al procesar la subida del archivo' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se ha proporcionado ningun archivo de audio' });
    }

    const tempPath = req.file.path;

    // Validate MIME type by magic bytes (Requirement 7.1)
    let detectedMime = null;
    try {
      detectedMime = checkMagicBytes(tempPath);
    } catch (readErr) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(500).json({ error: 'Error al validar la firma de bytes del archivo' });
    }

    const allowedMimes = ['audio/webm', 'audio/ogg', 'audio/mp4'];
    if (!detectedMime || !allowedMimes.includes(detectedMime)) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(415).json({ error: 'Tipo de archivo no permitido. Solo se permiten formatos webm, ogg y mp4' });
    }

    // Generate unique UUID name (Requirement 7.3)
    const extMap = {
      'audio/webm': '.webm',
      'audio/ogg': '.ogg',
      'audio/mp4': '.mp4'
    };
    const uniqueFilename = `${crypto.randomUUID()}${extMap[detectedMime]}`;
    const targetPath = path.join(uploadDir, uniqueFilename);

    try {
      // Ensure target folder exists and move file
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.renameSync(tempPath, targetPath);
    } catch (moveErr) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return res.status(500).json({ error: 'Error al almacenar el archivo de audio' });
    }

    // Database persistence
    const channelId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(channelId)) {
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      return res.status(400).json({ error: 'Identificador de canal no valido' });
    }

    try {
      const channel = await Channel.findById(channelId);
      if (!channel) {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        return res.status(404).json({ error: 'El canal especificado no existe' });
      }

      // Access verification for private channel audio messages (Requirement 5.1)
      const userId = req.user._id.toString();
      const isCreator = channel.creatorId && channel.creatorId.toString() === userId;
      if (channel.isPrivate) {
        const hasVerified = verifiedChannels[userId] && verifiedChannels[userId].has(channelId);
        if (!isCreator && !hasVerified) {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          return res.status(403).json({ error: 'Acceso denegado: se requiere clave de acceso' });
        }
      }

      const audioUrl = `/uploads/audio/${uniqueFilename}`;
      const newMessage = new Message({
        channelId: channel._id,
        author: req.user.username,
        type: 'audio',
        audioUrl: audioUrl
      });
      await newMessage.save();

      // Broadcast to WebSocket clients (Requirement 3.1)
      broadcastToAll({
        type: 'message',
        channelName: channel.name,
        message: newMessage
      });

      return res.status(201).json(newMessage);
    } catch (dbErr) {
      // Clean up orphaned file (Requirement 2.7)
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      return res.status(500).json({ error: 'Error al guardar el mensaje de audio en la base de datos' });
    }
  });
});

// Protected Audio File Service (Requirement 7.5, 4.3)
app.get('/uploads/audio/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;

  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Nombre de archivo no valido' });
  }

  const filePath = path.join(uploadDir, filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  // Serve static file
  res.sendFile(filePath);
});

// Verify Private Channel Key (Requirement 4.1 - 4.7, 8.3, 8.4)
app.post('/api/channels/:id/verify-key', requireAuth, checkDbConnection, async (req, res) => {
  const channelId = req.params.id;
  const { accessKey } = req.body;

  if (!mongoose.Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ error: 'Identificador de canal no valido' });
  }

  if (accessKey === undefined || accessKey === '') {
    return res.status(400).json({ error: 'La clave de acceso es requerida' });
  }

  if (typeof accessKey !== 'string' || !/^[a-zA-Z0-9]{7}$/.test(accessKey)) {
    return res.status(400).json({ error: 'La clave debe tener exactamente 7 caracteres alfanuméricos' });
  }

  try {
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'El canal especificado no existe' });
    }

    if (!channel.isPrivate) {
      return res.status(400).json({ error: 'Este canal no requiere clave de acceso' });
    }

    const isMatch = await bcrypt.compare(accessKey, channel.accessKeyHash || '');
    if (!isMatch) {
      return res.status(403).json({ error: 'Clave de acceso incorrecta' });
    }

    // Register access in memory session (Requirement 5.5)
    const userId = req.user._id.toString();
    if (!verifiedChannels[userId]) {
      verifiedChannels[userId] = new Set();
    }
    verifiedChannels[userId].add(channelId);

    // Add user to members list if not creator (Requirement 10.2)
    if (channel.creatorId.toString() !== userId) {
      await Channel.findByIdAndUpdate(channelId, { $addToSet: { members: req.user._id } });
    }

    // Return channel object without accessKeyHash (Requirement 6.2)
    const channelObj = channel.toObject();
    delete channelObj.accessKeyHash;

    return res.json(channelObj);
  } catch (err) {
    return res.status(500).json({ error: 'Error al verificar la clave de acceso' });
  }
});

// Delete Channel (Requirement 9.1 - 9.8)
app.delete('/api/channels/:id', requireAuth, checkDbConnection, async (req, res) => {
  const channelId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ error: 'Identificador de canal no valido' });
  }

  try {
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'El canal especificado no existe' });
    }

    if (channel.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Solo el creador puede eliminar el canal' });
    }

    // Delete all messages in the channel (Requirement 9.4)
    await Message.deleteMany({ channelId: channel._id });

    // Delete the channel itself (Requirement 9.4)
    await Channel.findByIdAndDelete(channel._id);

    // Broadcast deletion to all connected WebSockets (Requirement 9.5)
    broadcastToAll({
      type: 'channel_deleted',
      channelId: channel._id.toString()
    });

    return res.json({ success: true, message: 'Canal eliminado exitosamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar el canal' });
  }
});

// Leave Channel (Requirement 10.1 - 10.8)
app.delete('/api/channels/:id/membership', requireAuth, checkDbConnection, async (req, res) => {
  const channelId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(channelId)) {
    return res.status(400).json({ error: 'Identificador de canal no valido' });
  }

  try {
    const channel = await Channel.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'El canal especificado no existe' });
    }

    const userId = req.user._id.toString();
    if (channel.creatorId.toString() === userId) {
      return res.status(403).json({ error: 'El creador no puede salirse del canal; use la opción de eliminar canal' });
    }

    // Check membership (Requirement 10.8)
    const isMember = channel.members && channel.members.map(m => m.toString()).includes(userId);
    if (!isMember) {
      return res.status(400).json({ error: 'El usuario no es miembro de este canal' });
    }

    // Remove user from members list (Requirement 10.2)
    await Channel.findByIdAndUpdate(channel._id, { $pull: { members: req.user._id } });

    // Invalidate access in session if private (Requirement 10.4)
    if (channel.isPrivate) {
      if (verifiedChannels[userId]) {
        verifiedChannels[userId].delete(channelId);
      }
    }

    return res.json({ success: true, message: 'Has salido del canal voluntariamente' });
  } catch (err) {
    return res.status(500).json({ error: 'Error al salir del canal' });
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
server.on('upgrade', async (request, socket, head) => {
  const parsedCookies = cookie.parse(request.headers.cookie || '');
  const rawCookie = parsedCookies.userId || '';
  const userId = cookieParser.signedCookie(rawCookie, SESSION_SECRET);

  if (!userId) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    // Check if database is available
    if (mongoose.connection.readyState !== 1) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Verify user exists in User_Store (Requirement 3.4)
    const user = await User.findById(userId);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.username = user.username; // Store authenticated username on the WebSocket object
      ws.userId = user._id.toString();
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
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
          const trimmedName = channelName.trim();
          try {
            const channel = await Channel.findOne({ name: trimmedName });
            if (!channel) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'El canal de destino no existe'
              }));
              return;
            }

            const userId = ws.userId;
            const isCreator = channel.creatorId && channel.creatorId.toString() === userId;

            if (channel.isPrivate) {
              const hasVerified = verifiedChannels[userId] && verifiedChannels[userId].has(channel._id.toString());
              if (!isCreator && !hasVerified) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Acceso denegado al canal privado'
                }));
                return; // Do NOT set currentChannel
              }
            } else {
              // Public channel: automatically add membership if not creator (Requirement 1.16, 10.5)
              if (!isCreator) {
                await Channel.findByIdAndUpdate(channel._id, { $addToSet: { members: userId } });
              }
            }

            ws.currentChannel = trimmedName;
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Error al procesar la suscripción al canal'
            }));
          }
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

        // Access check for private channels
        const userId = ws.userId;
        const isCreator = channel.creatorId && channel.creatorId.toString() === userId;
        if (channel.isPrivate) {
          const hasVerified = verifiedChannels[userId] && verifiedChannels[userId].has(channel._id.toString());
          if (!isCreator && !hasVerified) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Acceso denegado: se requiere clave de acceso'
            }));
            return;
          }
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
