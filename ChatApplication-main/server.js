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

// Set paths for face recognition and profile images
const faceRecognitionDir = path.join(__dirname, '..', 'face_recognition', 'known_faces');
const profileImagesDir = path.join(__dirname, 'public', 'profile_images');

// Create profile images directory if it doesn't exist
if (!fs.existsSync(profileImagesDir)) {
  fs.mkdirSync(profileImagesDir, { recursive: true });
}

// Create face recognition directory if it doesn't exist
if (!fs.existsSync(faceRecognitionDir)) {
  fs.mkdirSync(faceRecognitionDir, { recursive: true });
}

// Set static folder
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for handling file uploads
const upload = multer();

const botName = 'Bot';

// Face recognition server URL from environment
const FACE_RECOGNITION_URL = process.env.FACE_RECOGNITION_URL || 'http://localhost:5001';

// Serve face recognition images with proper CORS headers
app.use('/profile_images', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
}, express.static(faceRecognitionDir));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chat server is running' });
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

    // If face verification was successful, check for active session
    if (data.success) {
      const username = data.user;
      if (isUserActive(username)) {
        return res.json({
          error: 'USER_ALREADY_ACTIVE',
          message: 'This user is already logged in on another device.'
        });
      }
      
      // Find the actual file extension by checking the directory
      const files = fs.readdirSync(faceRecognitionDir);
      const userImageFile = files.find(file => 
        file.toLowerCase().startsWith(`known_face_${username.toLowerCase()}`)
      );
      
      if (!userImageFile) {
        console.error(`Profile image not found for user: ${username}`);
        return res.json({
          error: 'PROFILE_IMAGE_NOT_FOUND',
          message: 'Profile image not found.'
        });
      }
      
      // Get the profile image path with correct extension
      const profileImagePath = `/profile_images/${userImageFile}`;
      
      // Add profile image path to response and user data
      data.profileImage = profileImagePath;
      
      // Update user profile in the users utility
      const userWithProfile = userJoin(req.socket?.id, username, null, profileImagePath);
      if (userWithProfile.error) {
        return res.json(userWithProfile);
      }
    }

    res.json(data);
  } catch (error) {
    console.error('Face authentication error:', error);
    res.status(500).json({ error: 'Face authentication failed' });
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

if (process.env.NODE_ENV !== 'production') {
  server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

// Export for Vercel
export default app;
