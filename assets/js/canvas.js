
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Set canvas to full-screen size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Array to hold square objects
const squares = [];
const clouds = [];

// Generate random squares
for (let i = 0; i < 100; i++) {
  squares.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 20 + 10,
    speed: Math.random() * 3 + 1,
    color: `rgba(255, 255, 255, ${Math.random()})`
  });
}


// Function to draw squares
function drawSquares() {
  squares.forEach((square) => {
    ctx.fillStyle = square.color;
    ctx.fillRect(square.x, square.y, square.size, square.size);

    // Move square upwards
    square.y -= square.speed;
    if (square.y < -square.size) {
      square.y = canvas.height + square.size;
    }
  });
}

// Function to draw clouds
function drawClouds() {
  clouds.forEach((cloud) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.ellipse(cloud.x, cloud.y, cloud.width, cloud.height, 0, 0, Math.PI * 2);
    ctx.fill();

    // Move cloud to the right
    cloud.x += cloud.speed;
    if (cloud.x > canvas.width) {
      cloud.x = -cloud.width;
    }
  });
}

// Animation loop
function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawClouds();
  drawSquares();

  requestAnimationFrame(animate);
}

// Resize canvas dynamically on window resize
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});

animate();