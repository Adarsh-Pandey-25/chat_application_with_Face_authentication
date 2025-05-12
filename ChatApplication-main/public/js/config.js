// Socket.IO server URL configuration
const config = {
    socketURL: window.location.hostname === 'localhost' ? 'http://localhost:4000' : window.location.origin
};

// Generate and save favicon if it doesn't exist
(function createFavicon() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Draw chat bubble
    ctx.fillStyle = '#4a90e2';
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(28, 4);
    ctx.quadraticCurveTo(32, 4, 32, 8);
    ctx.lineTo(32, 20);
    ctx.quadraticCurveTo(32, 24, 28, 24);
    ctx.lineTo(16, 24);
    ctx.lineTo(12, 28);
    ctx.lineTo(8, 24);
    ctx.lineTo(4, 24);
    ctx.quadraticCurveTo(0, 24, 0, 20);
    ctx.lineTo(0, 8);
    ctx.quadraticCurveTo(0, 4, 4, 4);
    ctx.fill();

    // Add dots
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(8, 14, 2, 0, Math.PI * 2);
    ctx.arc(16, 14, 2, 0, Math.PI * 2);
    ctx.arc(24, 14, 2, 0, Math.PI * 2);
    ctx.fill();

    // Convert to favicon
    const link = document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    link.href = canvas.toDataURL("image/x-icon");
    document.head.appendChild(link);
})();

export default config; 