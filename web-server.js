const http = require('http');

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Grow Tent Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: sans-serif;
      background: #111;
      color: #eee;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
    }
    .card {
      background: #1e1e1e;
      border-radius: 20px;
      padding: 50px 70px;
      text-align: center;
      box-shadow: 0 0 40px rgba(0,0,0,0.5);
    }
    h1 { color: #aaa; font-size: 1.3rem; margin-bottom: 40px; }
    .value { font-size: 3.5rem; font-weight: bold; }
    .temp  { color: #ff6b6b; }
    .hum   { color: #4ecdc4; }
    .label { color: #555; font-size: 0.85rem; margin-bottom: 30px; letter-spacing: 1px; }
    .status { margin-top: 30px; font-size: 0.8rem; color: #444; }
    .status.connected { color: #4ecdc4; }
    .status.disconnected { color: #ff6b6b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🍄 Grow Tent Monitor</h1>
    <div class="value temp" id="temp">--.-</div>
    <div class="label">TEMPERATURE °C</div>
    <div class="value hum" id="hum">--.-</div>
    <div class="label">HUMIDITY %</div>
    <div class="status disconnected" id="status">● disconnected</div>
  </div>

  <script>
    const temp   = document.getElementById('temp');
    const hum    = document.getElementById('hum');
    const status = document.getElementById('status');

    function connect() {
      const ws = new WebSocket('ws://165.1.123.182:8080');

      ws.onopen = () => {
        status.textContent = '● connected';
        status.className = 'status connected';
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        temp.textContent = parseFloat(data.temperature).toFixed(1);
        hum.textContent  = parseFloat(data.humidity).toFixed(1);
      };

      ws.onclose = () => {
        status.textContent = '● disconnected';
        status.className = 'status disconnected';
        setTimeout(connect, 3000);
      };
    }

    connect();
  </script>
</body>
</html>`);
});

httpServer.listen(3001, () => {
  console.log('Web server running on port 3001');
});
