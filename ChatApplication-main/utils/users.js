const users = [];
const activeSessions = new Map(); // Track active user sessions
const userProfiles = new Map(); // Store user profile images

// Join user to chat
function userJoin(id, username, room, profileImage = null) {
  // Check if user is already active in a session
  const existingSession = activeSessions.get(username);
  if (existingSession && room !== null) {  // Only check if joining a room
    return { error: 'USER_ALREADY_ACTIVE', existingSocketId: existingSession.socketId };
  }

  // Store or update profile image if provided
  if (profileImage) {
    userProfiles.set(username, profileImage);
  }

  // If this is just a profile update (room is null), don't create a new user
  if (room === null) {
    return { success: true };
  }

  const user = { 
    id, 
    username, 
    room,
    profileImage: userProfiles.get(username) || null
  };
  
  users.push(user);
  
  // Store the new session
  activeSessions.set(username, { 
    socketId: id, 
    room,
    profileImage: user.profileImage 
  });

  return user;
}

// Get current user
function getCurrentUser(id) {
  const user = users.find(user => user.id === id);
  if (user) {
    user.profileImage = userProfiles.get(user.username) || null;
  }
  return user;
}

// User leaves chat
function userLeave(id) {
  const index = users.findIndex(user => user.id === id);

  if (index !== -1) {
    const user = users[index];
    // Remove from active sessions but keep profile image
    activeSessions.delete(user.username);
    return users.splice(index, 1)[0];
  }
}

// Get room users
function getRoomUsers(room) {
  return users.filter(user => user.room === room).map(user => ({
    ...user,
    profileImage: userProfiles.get(user.username) || null
  }));
}

// Check if user is active
function isUserActive(username) {
  return activeSessions.has(username);
}

// Force disconnect user
function forceDisconnectUser(username) {
  const session = activeSessions.get(username);
  if (session) {
    const index = users.findIndex(user => user.username === username);
    if (index !== -1) {
      users.splice(index, 1);
    }
    activeSessions.delete(username);
    return session.socketId;
  }
  return null;
}

// Update user profile
function updateUserProfile(username, profileImage) {
  if (profileImage) {
    userProfiles.set(username, profileImage);
    return true;
  }
  return false;
}

export {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
  isUserActive,
  forceDisconnectUser,
  updateUserProfile
};
