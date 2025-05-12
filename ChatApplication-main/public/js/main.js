import config from './config.js';

const chatForm = document.getElementById('chat-form');
const chatMessages = document.querySelector('.chat-messages');
const roomName = document.getElementById('room-name');
const userList = document.getElementById('users');
const typingIndicator = document.getElementById('typing-indicator');
const themeToggle = document.querySelector('.theme-toggle');
const emojiBtn = document.querySelector('.emoji-btn');

// Get username and room from URL
const { username, room } = Qs.parse(location.search, {
  ignoreQueryPrefix: true,
});

// Initialize Socket.IO connection
const socket = io(config.socketURL, {
  transports: ['websocket', 'polling']
});

// Handle page refresh and close
window.addEventListener('beforeunload', (event) => {
  // Don't clear session on refresh, only on actual close
  if (!event.persisted) {
    socket.emit('leaveRoom');
  }
  return undefined;
});

// Handle page refresh and session restoration
window.addEventListener('load', async () => {
  const currentPath = window.location.pathname;
  const session = JSON.parse(sessionStorage.getItem('chatSession') || '{}');
  const isRefresh = performance.navigation.type === performance.navigation.TYPE_RELOAD;

  if (currentPath.includes('chat.html')) {
    if (!session.username || !session.room) {
      // No valid session, redirect to login
      window.location.href = '../index.html';
    } else if (isRefresh) {
      // This is a refresh, try to rejoin the room
      socket.emit('rejoinRoom', { 
        username: session.username, 
        room: session.room,
        timestamp: Date.now()
      });
    }
  }
});

// Handle multiple login attempt
socket.on('multipleLogin', (data) => {
  showToast(data.message, 'error');
  // Clear session and redirect to login
  sessionStorage.removeItem('chatSession');
  setTimeout(() => {
    window.location.href = '../index.html';
  }, 2000);
});

// Handle force disconnect from another device
socket.on('forceDisconnect', (data) => {
  showToast(data.message, 'error');
  // Clear session and redirect to login
  sessionStorage.removeItem('chatSession');
  socket.disconnect();
  setTimeout(() => {
    window.location.href = '../index.html';
  }, 2000);
});

// Function to get profile image URL
function getProfileImageUrl(username) {
  if (!username) return null;
  // Keep the numbers and special characters in the username
  const baseUsername = username.toLowerCase();
  return `/profile_images/known_face_${baseUsername}`;
}

// Function to create profile image element
function createProfileImage(username, size = 'small') {
  const img = document.createElement('img');
  img.className = 'profile-pic ' + size;
  const initial = username ? username.charAt(0).toUpperCase() : '?';
  img.alt = initial;
  
  const imageUrl = getProfileImageUrl(username);
  console.log('Attempting to load profile image for:', username);
  console.log('Image URL base:', imageUrl);
  
  if (imageUrl) {
    // Try both .jpg and .jpeg extensions
    const tryNextExtension = () => {
      if (img.dataset.triedJpeg) {
        console.log('Failed to load profile image for:', username, 'after trying both extensions');
        img.removeAttribute('src');
        // Show initial as fallback
        img.style.backgroundColor = '#e0e0e0';
        img.style.color = '#666';
        img.textContent = initial;
        return;
      }
      if (!img.dataset.triedJpg) {
        img.dataset.triedJpg = 'true';
        const jpgUrl = `${imageUrl}.jpg`;
        console.log('Trying .jpg extension:', jpgUrl);
        img.src = jpgUrl;
      } else {
        img.dataset.triedJpeg = 'true';
        const jpegUrl = `${imageUrl}.jpeg`;
        console.log('Trying .jpeg extension:', jpegUrl);
        img.src = jpegUrl;
      }
    };
    
    // Add error handling
    img.onerror = tryNextExtension;
    
    // Start with .jpg
    tryNextExtension();
  } else {
    console.log('No image URL available for:', username);
    // Show initial as fallback
    img.style.backgroundColor = '#e0e0e0';
    img.style.color = '#666';
    img.textContent = initial;
  }
  
  return img;
}

// Store session data when joining
socket.on('connect', () => {
  const session = {
    username,
    room,
    connected: true,
    timestamp: Date.now(),
    socketId: socket.id,
    profileImage: getProfileImageUrl(username)
  };
  sessionStorage.setItem('chatSession', JSON.stringify(session));
});

// Handle successful room rejoin
socket.on('roomRejoinSuccess', () => {
  const session = JSON.parse(sessionStorage.getItem('chatSession') || '{}');
  session.connected = true;
  session.timestamp = Date.now();
  sessionStorage.setItem('chatSession', JSON.stringify(session));
});

// Handle rejoin failure
socket.on('roomRejoinFailed', () => {
  sessionStorage.removeItem('chatSession');
  window.location.href = '../index.html';
});

// Handle disconnection
socket.on('disconnect', () => {
  const session = JSON.parse(sessionStorage.getItem('chatSession') || '{}');
  
  // Update session with disconnect info but don't remove it
  sessionStorage.setItem('chatSession', JSON.stringify({
    ...session,
    connected: false,
    disconnectedAt: Date.now()
  }));

  // Only redirect if:
  // 1. It's been more than 5 seconds since last activity
  // 2. This is not a temporary disconnect (like switching pages)
  const timeSinceLastActivity = Date.now() - (session.lastActivity || 0);
  if (timeSinceLastActivity > 5000) {
    sessionStorage.removeItem('chatSession');
    window.location.href = '../index.html';
  }
});

// Update last activity timestamp
function updateActivity() {
  const session = JSON.parse(sessionStorage.getItem('chatSession') || '{}');
  sessionStorage.setItem('chatSession', JSON.stringify({
    ...session,
    lastActivity: Date.now()
  }));
}

// Track user activity
['click', 'keypress', 'mousemove', 'touchstart'].forEach(event => {
  document.addEventListener(event, updateActivity);
});

// Check if user is coming from a refresh
window.addEventListener('load', () => {
  const currentPath = window.location.pathname;
  const session = JSON.parse(sessionStorage.getItem('chatSession') || '{}');
  
  if (currentPath.includes('chat.html')) {
    // Check if this is a page refresh
    const isRefresh = performance.navigation.type === performance.navigation.TYPE_RELOAD;
    
    if (!session.username || !session.room) {
      // No valid session data
      window.location.href = '../index.html';
    } else if (!isRefresh && Date.now() - session.timestamp > 3600000) {
      // Session expired (1 hour) and not a refresh
      sessionStorage.removeItem('chatSession');
      window.location.href = '../index.html';
    } else {
      // Valid session, update timestamp
      updateActivity();
    }
  }
});

// Theme handling
const isDarkMode = localStorage.getItem('darkMode') === 'true';
if (isDarkMode) {
  document.body.classList.add('dark-mode');
  themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
}

themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark);
  themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  showToast('Theme updated!', 'success');
});

// Toast notification system
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
    <span>${message}</span>
  `;
  document.getElementById('toast-container').appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// Typing indicator
let typingTimeout;
const msgInput = document.getElementById('msg');

msgInput.addEventListener('input', () => {
  clearTimeout(typingTimeout);
  socket.emit('typing', { username, room });
  
  typingTimeout = setTimeout(() => {
    socket.emit('stopTyping', { username, room });
  }, 1000);
});

socket.on('userTyping', (data) => {
  if (data.username !== username) {
    typingIndicator.textContent = `${data.username} is typing...`;
  }
});

socket.on('userStoppedTyping', () => {
  typingIndicator.textContent = '';
});

// Join chatroom
socket.emit('joinRoom', { username, room });

// Get room and users
socket.on('roomUsers', ({ room, users }) => {
  outputRoomName(room);
  outputUsers(users);
  showToast(`Welcome to ${room}!`, 'success');
});

// Message from server
socket.on('message', (message) => {
  console.log(message);
  outputMessage(message);
  
  // Play notification sound for new messages
  if (message.username !== username) {
    playNotificationSound();
  }

  // Scroll down
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: 'smooth'
  });
});

// Simple notification sound
function playNotificationSound() {
  const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRQ0PVqzn77BdGAg+ltryxnMpBSh+zPLaizsIGGS57OihUBELTKXh8bllHgU2jdXzzn0vBSF1xe/glEILElyx6OyrWBUIQ5zd8sFuJAUuhM/z1YU2Bhxqvu7mnEgODlOq5O+zYBoGPJPY88p2KwUme8rx3I4+CRZiturqpVITC0mi4PK8aB8GM4nU8tGAMQYfcsLu45ZFDBFYr+ftrVoXCECY3PLEcSYELIHO8diJOQgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZRQ0PVqzn77BdGAg+ltryxnMpBSh+zPLaizsIGGS57OihUBELTKXh8bllHgU2jdXzzn0vBSF1xe/glEILElyx6OyrWBUIQ5zd8sFuJAUuhM/z1YU2Bhxqvu7mnEgODlOq5O+zYBoGPJPY88p2KwUme8rx3I4+CRZiturqpVITC0mi4PK8aB8GM4nU8tGAMQYfcsLu45ZFDBFYr+ftrVoXCECY3PLEcSYE');
  audio.volume = 0.5;
  audio.play().catch(() => {}); // Ignore autoplay restrictions
}

// Message submit
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();

  // Get message text
  let msg = e.target.elements.msg.value.trim();

  if (!msg) {
    return false;
  }

  // Handle commands
  if (msg.startsWith('/')) {
    handleCommand(msg);
    e.target.elements.msg.value = '';
    return;
  }

  // Emit message to server
  socket.emit('chatMessage', msg);

  // Clear input
  e.target.elements.msg.value = '';
  e.target.elements.msg.focus();
});

// Command handling
function handleCommand(msg) {
  const command = msg.slice(1).split(' ')[0];
  
  switch(command.toLowerCase()) {
    case 'help':
      outputMessage({
        username: 'System',
        time: new Date().toLocaleTimeString(),
        text: 'Available commands: /help, /clear, /users'
      });
      break;
    case 'clear':
      chatMessages.innerHTML = '';
      showToast('Chat cleared!', 'success');
      break;
    case 'users':
      const users = Array.from(userList.children).map(li => li.textContent);
      outputMessage({
        username: 'System',
        time: new Date().toLocaleTimeString(),
        text: `Online users: ${users.join(', ')}`
      });
      break;
    default:
      showToast('Unknown command', 'error');
  }
}

// Update outputMessage function to use profile images
function outputMessage(message) {
  const div = document.createElement('div');
  div.classList.add('message');
  if (message.username === username) {
    div.classList.add('own-message');
  }

  const header = document.createElement('div');
  header.className = 'message-header';
  
  // Create user info container
  const userInfo = document.createElement('div');
  userInfo.className = 'user-info';
  
  // Add profile picture
  const profilePic = createProfileImage(message.username, 'small');
  userInfo.appendChild(profilePic);
  
  // Add username
  const usernameDiv = document.createElement('div');
  usernameDiv.className = 'username';
  usernameDiv.textContent = message.username;
  userInfo.appendChild(usernameDiv);
  
  header.appendChild(userInfo);
  div.appendChild(header);
  
  // Add message content container
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  
  // Add message text
  const messageText = document.createElement('p');
  messageText.className = 'text';
  messageText.textContent = message.text;
  messageContent.appendChild(messageText);
  
  // Add time
  const timeDiv = document.createElement('div');
  timeDiv.className = 'time';
  timeDiv.textContent = message.time;
  messageContent.appendChild(timeDiv);
  
  div.appendChild(messageContent);
  
  document.querySelector('.chat-messages').appendChild(div);
}

// Add room name to DOM
function outputRoomName(room) {
  roomName.innerText = room;
}

// Update outputUsers function to use profile images
function outputUsers(users) {
  userList.innerHTML = users
    .map(user => `
      <li class="user-item">
        ${createProfileImage(user.username).outerHTML}
        <span class="user-name">${user.username}</span>
        <span class="online-indicator">●</span>
      </li>
    `)
    .join('');
}

// Handle leave room success
socket.on('leaveRoomSuccess', () => {
  // Clear the session
  sessionStorage.removeItem('chatSession');
  // Disconnect socket
  socket.disconnect();
  // Redirect to login page with a small delay to ensure cleanup
  setTimeout(() => {
    window.location.href = '../index.html';
  }, 100);
});

// Prompt the user before leaving chat room
document.getElementById('leave-btn').addEventListener('click', () => {
  const leaveRoom = confirm('Are you sure you want to leave this chatroom?');
  if (leaveRoom) {
    socket.emit('leaveRoom');
  }
});

// Handle emoji button click
emojiBtn.addEventListener('click', () => {
  // Simple emoji picker implementation
  const emojis = ['😊', '👍', '❤️', '😂', '🎉', '👋', '🤔', '👏'];
  const emojiPicker = document.createElement('div');
  emojiPicker.className = 'emoji-picker';
  emojiPicker.innerHTML = emojis
    .map(emoji => `<span class="emoji">${emoji}</span>`)
    .join('');
  
  // Position the picker
  const inputRect = msgInput.getBoundingClientRect();
  emojiPicker.style.position = 'absolute';
  emojiPicker.style.bottom = `${window.innerHeight - inputRect.top + 10}px`;
  emojiPicker.style.left = `${inputRect.left}px`;
  
  // Handle emoji selection
  emojiPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji')) {
      msgInput.value += e.target.textContent;
      msgInput.focus();
      emojiPicker.remove();
    }
  });
  
  // Remove picker when clicking outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.remove();
    }
  }, { once: true });
  
  document.body.appendChild(emojiPicker);
});


