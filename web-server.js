const http = require("http");

const API_BASE = process.env.API_URL;

console.log(`[API] Trying to connect to ${API_BASE}`);
http
  .get(API_BASE + "?limit=1", (apiRes) => {
    console.log(`[API] Successfully connected to ${API_BASE}`);
  })
  .on("error", (err) => {
    console.error(`[API] Failed to connect to ${API_BASE}: ${err.message}`);
  });

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/readings") {
    // Forward query params (since, limit, sensor_id) to the upstream API
    const params = new URLSearchParams(url.searchParams);
    if (!params.has("limit")) params.set("limit", "100000");
    const apiUrl = API_BASE + "?" + params.toString();

    http
      .get(apiUrl, (apiRes) => {
        let body = "";
        apiRes.on("data", (chunk) => (body += chunk));
        apiRes.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(body);
        });
      })
      .on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch readings" }));
      });
    return;
  }

  if (url.pathname === "/api/history") {
    const params = new URLSearchParams(url.searchParams);
    const qs = params.toString();
    const apiUrl = API_BASE + "/history" + (qs ? "?" + qs : "");
    http
      .get(apiUrl, (apiRes) => {
        let body = "";
        apiRes.on("data", (chunk) => (body += chunk));
        apiRes.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(body);
        });
      })
      .on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch history" }));
      });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Grow Tent Monitor</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: sans-serif;
      background: #111;
      color: #eee;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      padding: 40px 20px;
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
    .chart-container {
      background: #1e1e1e;
      border-radius: 20px;
      padding: 30px;
      margin-top: 30px;
      width: 100%;
      max-width: 900px;
      box-shadow: 0 0 40px rgba(0,0,0,0.5);
    }
    .chart-container h2 {
      color: #aaa;
      font-size: 1rem;
      margin-bottom: 20px;
      text-align: center;
    }
    canvas { width: 100% !important; }
    .time-buttons {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 30px;
    }
    .time-buttons button {
      background: #2a2a2a;
      color: #aaa;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .time-buttons button.active {
      background: #4ecdc4;
      color: #111;
    }
    .time-buttons button:hover { background: #3a3a3a; }
    .time-buttons button.active:hover { background: #4ecdc4; }
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

  <div class="time-buttons">
    <button data-range="1800000" >30m</button>
    <button data-range="3600000">1h</button>
    <button data-range="21600000">6h</button>
    <button data-range="86400000">24h</button>
    <button data-range="604800000">7d</button>
    <button data-range="0" class="active">All</button>
  </div>

  <div class="chart-container">
    <h2>Temperature History</h2>
    <canvas id="tempChart"></canvas>
  </div>

  <div class="chart-container">
    <h2>Humidity History</h2>
    <canvas id="humChart"></canvas>
  </div>

  <script>
    const temp   = document.getElementById('temp');
    const hum    = document.getElementById('hum');
    const status = document.getElementById('status');

    // --- Live WebSocket ---
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

    // --- Chart.js config ---
    const rangeAnnotation = (min, max) => ({
      goodZone: {
        type: 'box',
        yMin: min,
        yMax: max,
        backgroundColor: 'rgba(76, 175, 80, 0.03)',
        borderColor: 'rgba(76, 175, 80, 0.15)',
        borderWidth: 1,
      },
      lowZone: {
        type: 'box',
        yMin: -Infinity,
        yMax: min,
        backgroundColor: 'rgba(255, 107, 107, 0.03)',
        borderWidth: 0,
      },
      highZone: {
        type: 'box',
        yMin: max,
        yMax: Infinity,
        backgroundColor: 'rgba(255, 107, 107, 0.03)',
        borderWidth: 0,
      },
      minLine: {
        type: 'line',
        yMin: min,
        yMax: min,
        borderColor: 'rgba(76, 175, 80, 0.2)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: { display: true, content: min.toString(), position: 'start', color: '#4caf50', backgroundColor: 'transparent', font: { size: 10 } },
      },
      maxLine: {
        type: 'line',
        yMin: max,
        yMax: max,
        borderColor: 'rgba(76, 175, 80, 0.2)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: { display: true, content: max.toString(), position: 'start', color: '#4caf50', backgroundColor: 'transparent', font: { size: 10 } },
      },
    });

    const chartOpts = (label, color, goodMin = null, goodMax = null, yMin = undefined, yMax = undefined) => ({
      type: 'line',
      data: {
        datasets: [{
          label,
          borderColor: color,
          backgroundColor: color + '20',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          annotation: goodMin !== null ? { annotations: rangeAnnotation(goodMin, goodMax) } : {},
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'MMM d, HH:mm' },
            ticks: { color: '#555', maxTicksLimit: 8 },
            grid: { color: '#2a2a2a' },
          },
          y: {
            ...(yMin !== undefined && { min: yMin }),
            ...(yMax !== undefined && { max: yMax }),
            ticks: { color: '#555' },
            grid: { color: '#2a2a2a' },
          }
        }
      }
    });

    const tempChart = new Chart(document.getElementById('tempChart'), chartOpts('Temperature °C', '#ff6b6b', 20, 27, 15, 30));
    const humChart  = new Chart(document.getElementById('humChart'),  chartOpts('Humidity %', '#4ecdc4'));

    // --- Time range ---
    let activeRange = 0; // ms, 0 = all

    document.querySelectorAll('.time-buttons button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector('.time-buttons button.active').classList.remove('active');
        btn.classList.add('active');
        activeRange = parseInt(btn.dataset.range);
        loadHistory();
      });
    });

    // --- Fetch historical data ---
    // 30m, 1h = raw readings | 6h+ and All = 10min avg buckets
    const USE_HISTORY_THRESHOLD = 3600000; // ranges > 1h use /api/history

    async function loadHistory() {
      try {
        const useHistory = activeRange === 0 || activeRange > USE_HISTORY_THRESHOLD;
        const since = activeRange > 0 ? Math.floor((Date.now() - activeRange) / 1000) : null;
        let url;

        if (useHistory) {
          url = '/api/history' + (since ? '?since=' + since : '');
        } else {
          url = '/api/readings?since=' + since;
        }

        const res = await fetch(url);
        const data = await res.json();

        // API returns newest first — show latest reading immediately
        if (data.length > 0) {
          const latest = data[0];
          temp.textContent = parseFloat(latest.temperature).toFixed(1);
          hum.textContent  = parseFloat(latest.humidity).toFixed(1);
        }

        // Reverse for chronological order
        data.reverse();

        const timeKey = useHistory ? 'bucket' : 'timestamp';
        const tempData = data.map(d => ({ x: d[timeKey] * 1000, y: d.temperature }));
        const humData  = data.map(d => ({ x: d[timeKey] * 1000, y: d.humidity }));

        tempChart.data.datasets[0].data = tempData;
        humChart.data.datasets[0].data  = humData;

        tempChart.update();
        humChart.update();
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    }

    loadHistory();
    // Refresh history every 5 minutes
    setInterval(loadHistory, 5 * 60 * 1000);
  </script>
</body>
</html>`);
});

httpServer.listen(3001, () => {
  console.log("Web server running on port 3001");
});
