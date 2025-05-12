import path from 'path';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { formatMessage } from './utils/messages.js';
import { userJoin, getCurrentUser, userLeave, getRoomUsers, isUserActive, forceDisconnectUser } from './utils/users.js';
import multer from 'multer';
import fetch from 'node-fetch';
import { FormData } from 'undici';
import { Blob } from 'buffer';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app first
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST"],
    transports: ['websocket', 'polling'],
    credentials: true
  },
  allowEIO3: true
});

// Add CORS middleware for Express
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Set paths for face recognition and profile images
const faceRecognitionDir = path.join(__dirname, '..', 'face_recognition', 'known_faces');

// Create face recognition directory if it doesn't exist
if (!fs.existsSync(faceRecognitionDir)) {
  fs.mkdirSync(faceRecognitionDir, { recursive: true });
}

// Set static folder
app.use(express.static(path.join(__dirname, 'public')));

// Add detailed logging middleware for profile images
app.use('/profile_images', (req, res, next) => {
  console.log('Profile image request:', {
    url: req.url,
    method: req.method,
    headers: req.headers,
    path: req.path
  });
  next();
});

// Serve profile images with proper CORS and content type handling
app.use('/profile_images', (req, res) => {
  const requestUrl = req.url.startsWith('/') ? req.url.slice(1) : req.url;
  console.log('Processing profile image request:', requestUrl);

  // Set CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  // Get the username part from the request
  const match = requestUrl.match(/known_face_([^.]+)/);
  if (!match) {
    console.log('Invalid profile image request format:', requestUrl);
    return res.status(400).send('Invalid request format');
  }

  const requestedUsername = match[1].split('-')[0].toLowerCase();
  console.log('Looking for profile image for username:', requestedUsername);

  try {
    // List all files in the directory
    const files = fs.readdirSync(faceRecognitionDir);
    console.log('Available profile images:', files);

    // Find a matching file
    const matchingFile = files.find(file => {
      if (!file.startsWith('known_face_')) return false;
      const fileMatch = file.match(/known_face_([^-]+)/);
      const matches = fileMatch && fileMatch[1].toLowerCase() === requestedUsername;
      console.log('Checking file:', file, 'Match result:', matches);
      return matches;
    });

    if (matchingFile) {
      console.log('Found matching profile image:', matchingFile);
      const filePath = path.join(faceRecognitionDir, matchingFile);
      
      // Set appropriate content type based on file extension
      const contentType = matchingFile.endsWith('.jpeg') ? 'image/jpeg' : 'image/jpg';
      res.header('Content-Type', contentType);
      
      // Stream the file
      const stream = fs.createReadStream(filePath);
      stream.on('error', (error) => {
        console.error('Error streaming profile image:', error);
        res.status(500).send('Error reading profile image');
      });
      stream.pipe(res);
    } else {
      console.log('No matching profile image found for:', requestedUsername);
      return res.status(404).send('Profile image not found');
    }
  } catch (error) {
    console.error('Error serving profile image:', error);
    return res.status(500).send('Internal server error');
  }
});

// Configure multer for handling file uploads
const upload = multer();

const botName = 'Bot';

// Face recognition server URL from environment
const FACE_RECOGNITION_URL = process.env.FACE_RECOGNITION_URL || 'http://localhost:5001';

// Serve face recognition images with proper CORS headers
app.use('/face_recognition/known_faces', express.static(path.join(__dirname, '..', 'face_recognition', 'known_faces')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chat server is running' });
});

// Check user active status endpoint
app.get('/api/check-user/:username', (req, res) => {
  const { username } = req.params;
  const isActive = isUserActive(username);
  res.json({ 
    isActive,
    message: isActive ? 'User is already logged in on another device.' : 'User is not currently active.'
  });
});

// Face authentication endpoint
app.post('/auth/face', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    // Create FormData for face recognition server
    const formData = new FormData();
    formData.append('image', new Blob([req.file.buffer]), 'face.jpg');

    const response = await fetch(`${FACE_RECOGNITION_URL}/verify-face`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();

    // If face verification was successful
    if (data.success) {
      const username = data.user;
      
      // Check if user is already active in a session
      if (isUserActive(username)) {
        console.log(`User ${username} attempted login but is already active`);
        return res.json({
          success: false,
          error: 'USER_ALREADY_ACTIVE',
          message: 'This user is already logged in on another device.',
          username: username
        });
      }
      
      // Only proceed with profile image if user isn't already active
      try {
        const files = fs.readdirSync(faceRecognitionDir);
        const userImageFile = files.find(file => 
          file.toLowerCase().startsWith(`known_face_${username.toLowerCase()}`)
        );
        
        if (!userImageFile) {
          console.error(`Profile image not found for user: ${username}`);
          return res.json({
            success: false,
            error: 'PROFILE_IMAGE_NOT_FOUND',
            message: 'Profile image not found.'
          });
        }
        
        // Get the profile image path with correct extension
        const profileImagePath = `/profile_images/${userImageFile}`;
        data.profileImage = profileImagePath;
      } catch (fileError) {
        console.error('Error accessing profile image:', fileError);
        // Continue without profile image
        data.profileImage = null;
      }
    }

    res.json(data);
  } catch (error) {
    console.error('Face authentication error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'AUTHENTICATION_FAILED',
      message: 'Face authentication failed. Please try again.' 
    });
  }
});

// Socket.IO connection handling
io.on('connection', socket => {
  socket.on('joinRoom', ({ username, room }) => {
    const result = userJoin(socket.id, username, room);
    
    if (result.error === 'USER_ALREADY_ACTIVE') {
      // Notify the new connection that user is already active
      socket.emit('multipleLogin', {
        message: 'This user is already logged in on another device.'
      });
      return;
    }

    const user = result;
    socket.join(user.room);

    // Welcome current user
    socket.emit('message', formatMessage(botName, 'Welcome to Project Discussions!'));

    // Broadcast when a user connects
    socket.broadcast
      .to(user.room)
      .emit('message', formatMessage(botName, `${user.username} has joined the chat`));

    // Send users and room info
    io.to(user.room).emit('roomUsers', {
      room: user.room,
      users: getRoomUsers(user.room)
    });
  });

  // Handle room rejoin attempts
  socket.on('rejoinRoom', ({ username, room }) => {
    try {
      // Check if user is already active in another session
      if (isUserActive(username)) {
        const existingSocketId = forceDisconnectUser(username);
        if (existingSocketId) {
          // Notify the existing session
          io.to(existingSocketId).emit('forceDisconnect', {
            message: 'Your account has been logged in from another device.'
          });
        }
      }

      const user = userJoin(socket.id, username, room);
      socket.join(room);
      
      socket.emit('roomRejoinSuccess');
      socket.emit('message', formatMessage(botName, 'Welcome back to Project Discussions!'));
      
      // Send users and room info
      io.to(room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });
    } catch (error) {
      console.error('Error rejoining room:', error);
      socket.emit('roomRejoinFailed');
    }
  });

  // Listen for chatMessage
  socket.on('chatMessage', msg => {
    const user = getCurrentUser(socket.id);
    if (user) {
      io.to(user.room).emit('message', formatMessage(user.username, msg));
    }
  });

  // Handle explicit leave room
  socket.on('leaveRoom', () => {
    const user = userLeave(socket.id);
    if (user) {
      // Leave the socket room
      socket.leave(user.room);
      
      // Notify other users
      io.to(user.room).emit(
        'message',
        formatMessage(botName, `${user.username} has left the chat`)
      );

      // Send updated users list to room
      io.to(user.room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });

      // Send confirmation to the leaving user
      socket.emit('leaveRoomSuccess');
    }
  });

  // Runs when client disconnects
  socket.on('disconnect', () => {
    const user = userLeave(socket.id);
    if (user) {
      io.to(user.room).emit(
        'message',
        formatMessage(botName, `${user.username} has left the chat`)
      );

      // Send users and room info
      io.to(user.room).emit('roomUsers', {
        room: user.room,
        users: getRoomUsers(user.room)
      });
    }
  });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

// Export for Vercel
export default app;
