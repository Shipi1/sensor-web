const http = require("http");
const https = require("https");

const API_BASE = process.env.API_URL;

// Pick http or https based on the upstream URL
const upstream = API_BASE?.startsWith("https") ? https : http;

console.log(`[ENV] API_URL=${API_BASE || "NOT SET"}`);

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/tent/readings") {
    const params = new URLSearchParams(url.searchParams);
    if (!params.has("limit")) params.set("limit", "100000");
    const apiUrl = API_BASE + "?" + params.toString();

    upstream
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

  if (url.pathname === "/api/tent/readings/history") {
    const params = new URLSearchParams(url.searchParams);
    const qs = params.toString();
    const apiUrl = API_BASE + "/history" + (qs ? "?" + qs : "");
    upstream
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
    .uptime { color: #777; margin-left: 12px; }
    #monitors { display: flex; flex-direction: column; gap: 40px; width: 100%; align-items: center; }
    .monitor { display: flex; flex-direction: column; align-items: center; width: 100%; }
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
    .zone-controls {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      font-size: 0.8rem;
      color: #777;
    }
    .zone-controls input {
      background: #2a2a2a;
      color: #eee;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 4px 8px;
      width: 70px;
      font-size: 0.85rem;
    }
    .zone-controls input:focus { outline: none; border-color: #4ecdc4; }
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
  <div id="monitors"></div>

  <div class="time-buttons">
    <button data-range="1800000" >30m</button>
    <button data-range="3600000">1h</button>
    <button data-range="21600000" class="active">6h</button>
    <button data-range="86400000">24h</button>
    <button data-range="604800000">7d</button>
    <button data-range="0">All</button>
  </div>

  <script>
    // --- Shared WebSocket dispatcher ---
    const wsListeners = new Set();
    let wsStatus = 'disconnected';
    function connect() {
      const ws = new WebSocket('wss://shipisnature.com:8443');
      ws.onopen = () => {
        wsStatus = 'connected';
        wsListeners.forEach(fn => fn({ type: 'status', status: 'connected' }));
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        wsListeners.forEach(fn => fn({ type: 'reading', data }));
      };
      ws.onclose = () => {
        wsStatus = 'disconnected';
        wsListeners.forEach(fn => fn({ type: 'status', status: 'disconnected' }));
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

    const chartOpts = (label, color) => ({
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
          annotation: { annotations: {} },
        },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'MMM d, HH:mm' },
            ticks: { color: '#555', maxTicksLimit: 8 },
            grid: { color: '#2a2a2a' },
          },
          y: {
            ticks: { color: '#555' },
            grid: { color: '#2a2a2a' },
          }
        }
      }
    });

    // --- Constants ---
    const USE_HISTORY_THRESHOLD = 3600000; // ranges > 1h use bucketed history
    const READING_INTERVAL_SEC = 30;       // one reading every 30s
    const BUCKET_STEP_SEC = 600;           // 10-min buckets
    const EXPECTED_PER_BUCKET = 20;        // 600s / 30s

    // --- Monitor factory ---
    function createMonitor({ sensorId = null, label, defaults = {} }) {
      const storageKey = 'goodZone:' + (sensorId ?? 'default');
      const ZONE_DEFAULTS = { tempMin: 20, tempMax: 27, humMin: 85, humMax: 95, ...defaults };
      const zone = { ...ZONE_DEFAULTS, ...JSON.parse(localStorage.getItem(storageKey) || '{}') };

      // Build DOM
      const root = document.createElement('div');
      root.className = 'monitor';
      root.innerHTML = \`
        <div class="card">
          <h1>\${label}</h1>
          <div class="value temp">--.-</div>
          <div class="label">TEMPERATURE °C</div>
          <div class="value hum">--.-</div>
          <div class="label">HUMIDITY %</div>
          <div class="status disconnected">● disconnected<span class="uptime"></span></div>
        </div>
        <div class="chart-container">
          <h2>Temperature History</h2>
          <div class="zone-controls">
            <span>Good zone:</span>
            <input type="number" class="z-tempMin" step="0.1" placeholder="min">
            <span>–</span>
            <input type="number" class="z-tempMax" step="0.1" placeholder="max">
            <span>°C</span>
          </div>
          <canvas class="tempChart"></canvas>
        </div>
        <div class="chart-container">
          <h2>Humidity History</h2>
          <div class="zone-controls">
            <span>Good zone:</span>
            <input type="number" class="z-humMin" step="0.1" placeholder="min">
            <span>–</span>
            <input type="number" class="z-humMax" step="0.1" placeholder="max">
            <span>%</span>
          </div>
          <canvas class="humChart"></canvas>
        </div>
      \`;
      document.getElementById('monitors').appendChild(root);

      const $ = sel => root.querySelector(sel);
      const tempEl = $('.value.temp');
      const humEl = $('.value.hum');
      const statusEl = $('.status');
      const uptimeEl = $('.uptime');

      const tempChart = new Chart($('.tempChart'), chartOpts('Temperature °C', '#ff6b6b'));
      const humChart = new Chart($('.humChart'), chartOpts('Humidity %', '#4ecdc4'));

      // Zone controls
      const applyZone = (chart, minVal, maxVal) => {
        const min = parseFloat(minVal);
        const max = parseFloat(maxVal);
        chart.options.plugins.annotation.annotations =
          Number.isFinite(min) && Number.isFinite(max) && max > min
            ? rangeAnnotation(min, max)
            : {};
        chart.update();
      };
      const refreshZones = () => {
        applyZone(tempChart, zone.tempMin, zone.tempMax);
        applyZone(humChart, zone.humMin, zone.humMax);
      };
      ['tempMin', 'tempMax', 'humMin', 'humMax'].forEach(key => {
        const el = $('.z-' + key);
        el.value = zone[key];
        el.addEventListener('input', () => {
          zone[key] = el.value;
          localStorage.setItem(storageKey, JSON.stringify(zone));
          refreshZones();
        });
      });
      refreshZones();

      // Subscribe to shared WS
      const setStatus = (state) => {
        statusEl.textContent = state === 'connected' ? '● connected' : '● disconnected';
        statusEl.className = 'status ' + state;
        statusEl.appendChild(uptimeEl);
      };
      setStatus(wsStatus);
      wsListeners.add((msg) => {
        if (msg.type === 'status') {
          setStatus(msg.status);
        } else if (msg.type === 'reading') {
          // Filter by sensor_id if we have one set
          if (sensorId !== null && msg.data.sensor_id !== sensorId) return;
          tempEl.textContent = parseFloat(msg.data.temperature).toFixed(1);
          humEl.textContent  = parseFloat(msg.data.humidity).toFixed(1);
        }
      });

      // Compute uptime % from the fetched data + active range
      const computeUptime = (data, useHistory, rangeMs) => {
        if (data.length === 0) return 0;
        if (useHistory) {
          let windowSec;
          if (rangeMs > 0) {
            windowSec = rangeMs / 1000;
          } else {
            // "all": span from oldest bucket to now
            const oldest = data.reduce((m, d) => Math.min(m, d.bucket), Infinity);
            windowSec = Date.now() / 1000 - oldest;
          }
          const expectedBuckets = Math.max(1, Math.ceil(windowSec / BUCKET_STEP_SEC));
          const expected = expectedBuckets * EXPECTED_PER_BUCKET;
          const received = data.reduce((sum, d) => sum + (d.count || 0), 0);
          return Math.min(100, (received / expected) * 100);
        } else {
          const expected = Math.max(1, rangeMs / 1000 / READING_INTERVAL_SEC);
          return Math.min(100, (data.length / expected) * 100);
        }
      };

      const rangeLabel = (rangeMs) => {
        if (rangeMs === 0) return 'all';
        const btn = document.querySelector('.time-buttons button[data-range="' + rangeMs + '"]');
        return btn ? btn.textContent : '';
      };

      // Fetch + render
      async function loadHistory(rangeMs) {
        try {
          const useHistory = rangeMs === 0 || rangeMs > USE_HISTORY_THRESHOLD;
          const since = rangeMs > 0 ? Math.floor((Date.now() - rangeMs) / 1000) : null;
          const params = new URLSearchParams();
          if (since) params.set('since', since);
          if (sensorId !== null) params.set('sensor_id', sensorId);
          const base = useHistory ? '/api/tent/readings/history' : '/api/tent/readings';
          if (!useHistory && !since) params.set('since', Math.floor(Date.now() / 1000) - 3600);
          const qs = params.toString();
          const url = base + (qs ? '?' + qs : '');

          const res = await fetch(url);
          const data = await res.json();

          if (!useHistory && data.length > 0) {
            const latest = data[0];
            tempEl.textContent = parseFloat(latest.temperature).toFixed(1);
            humEl.textContent  = parseFloat(latest.humidity).toFixed(1);
          }

          const uptime = computeUptime(data, useHistory, rangeMs);
          uptimeEl.textContent = ' · ' + uptime.toFixed(1) + '% uptime (' + rangeLabel(rangeMs) + ')';

          data.reverse();
          const timeKey = useHistory ? 'bucket' : 'timestamp';
          tempChart.data.datasets[0].data = data.map(d => ({ x: d[timeKey] * 1000, y: d.temperature }));
          humChart.data.datasets[0].data  = data.map(d => ({ x: d[timeKey] * 1000, y: d.humidity }));
          tempChart.update();
          humChart.update();
        } catch (err) {
          console.error('Failed to load history for', sensorId ?? 'default', err);
        }
      }

      // Initial latest-reading fetch for live display
      const latestParams = new URLSearchParams({ limit: '1' });
      if (sensorId !== null) latestParams.set('sensor_id', sensorId);
      fetch('/api/tent/readings?' + latestParams.toString())
        .then(res => res.json())
        .then(data => {
          if (data.length > 0) {
            tempEl.textContent = parseFloat(data[0].temperature).toFixed(1);
            humEl.textContent  = parseFloat(data[0].humidity).toFixed(1);
          }
        })
        .catch(() => {});

      return { loadHistory };
    }

    // --- Bootstrap monitors ---
    const monitors = [
      createMonitor({ label: '🍄 Grow Tent Monitor' }),
      // To add another: createMonitor({ sensorId: 'second-sensor-id', label: 'Other Tent' }),
    ];

    // Place the (global) time-range buttons between the first monitor's card and its charts
    document.querySelector('.monitor .card').after(document.querySelector('.time-buttons'));

    // --- Global time range ---
    let activeRange = 21600000;
    const refreshAll = () => monitors.forEach(m => m.loadHistory(activeRange));

    document.querySelectorAll('.time-buttons button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelector('.time-buttons button.active').classList.remove('active');
        btn.classList.add('active');
        activeRange = parseInt(btn.dataset.range);
        refreshAll();
      });
    });

    refreshAll();
    setInterval(refreshAll, 5 * 60 * 1000);
  </script>
</body>
</html>`);
});

httpServer.listen(3001, () => {
  console.log("Web server running on port 3001");
});
