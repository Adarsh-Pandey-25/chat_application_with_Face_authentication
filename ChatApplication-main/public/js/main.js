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

// Store session data when joining
socket.on('connect', () => {
  const session = {
    username,
    room,
    connected: true,
    timestamp: Date.now(),
    socketId: socket.id,
    profileImage: sessionStorage.getItem('userProfileImage')
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
  }, 3000);
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

// Output message to DOM
function outputMessage(message) {
  const div = document.createElement('div');
  div.classList.add('message');
  
  // Add special styling for system messages
  if (message.username === 'System' || message.username === 'Bot') {
    div.classList.add('system-message');
    
    // Add close button for welcome messages
    if (message.text.includes('Welcome to')) {
      div.innerHTML = `
        <div class="message-header">
          <p class="meta">
            ${message.username} 
            <span>${message.time}</span>
          </p>
          <button class="close-message" title="Dismiss message">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <p class="text">${message.text}</p>
      `;

      // Add event listener to close button
      setTimeout(() => {
        const closeBtn = div.querySelector('.close-message');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            div.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => div.remove(), 300);
          });
        }
      }, 0);
    } else {
      div.innerHTML = `
        <p class="meta">
          ${message.username} 
          <span>${message.time}</span>
        </p>
        <p class="text">${message.text}</p>
      `;
    }
  } else {
    // Add class for own messages
    if (message.username === username) {
      div.classList.add('own-message');
    }
    
    div.innerHTML = `
      <p class="meta">
        ${message.username} 
        <span>${message.time}</span>
        ${message.username === username ? '<span class="message-status">✓</span>' : ''}
      </p>
      <p class="text">${message.text}</p>
    `;
  }
  
  // Add message to DOM
  chatMessages.appendChild(div);
  
  // Scroll to bottom smoothly
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: 'smooth'
  });
}

// Add room name to DOM
function outputRoomName(room) {
  roomName.innerText = room;
}

// Add users to DOM
function outputUsers(users) {
  userList.innerHTML = users
    .map(user => `
      <li>
        <div class="user-item">
          ${user.profileImage 
            ? `<img src="${user.profileImage}" alt="${user.username}" class="user-avatar" />`
            : `<i class="fas fa-circle online-indicator"></i>`
          }
          <span class="user-name">
            ${user.username}
            ${user.username === username ? ' (You)' : ''}
          </span>
        </div>
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


