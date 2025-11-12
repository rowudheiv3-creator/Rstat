// ====================================================================
// full_stack_monitor_single_file.js (V3.0)
// Full-Stack URL Monitor: Serves Frontend and handles Check-Host API
// Dependencies: express, axios, cors
// ====================================================================

const express = require('express');
const axios = require('axios');
const cors = require('cors'); 

const app = express();

// ** IMPORTANT: Cloud Hosting Port Configuration **
// Use the port defined by the environment (e.g., Koyeb's 8000), or default to 3000 for local development.
const PORT = process.env.PORT || 3000; 
const CHECK_HOST_BASE_URL = 'https://check-host.net';

// --- CONFIGURATION ---
// ******************************************************************
// แนะนำให้เปลี่ยน DEFAULT_NODE_ID หากโหนดปัจจุบัน (sg1) ถูก Rate Limit
const DEFAULT_NODE_ID = 'sg1.node.check-host.net'; 
// ลองเปลี่ยนเป็น 'ny1.node.check-host.net' หรือ 'de1.node.check-host.net' หากมีปัญหา
// ******************************************************************

// Mapping Method to check-host.net Endpoint
const METHOD_ENDPOINT_MAP = {
    'http': 'check-http',
    'ping': 'check-ping',
    'tcp': 'check-tcp',
    'dns': 'check-dns',
    'whois': 'check-whois'
};

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Middleware ---
app.use(cors()); 
app.use(express.json());


// ====================================================================
// 🌐 1. NODE.JS BACKEND (API Handler)
// ====================================================================

app.post('/api/check', async (req, res) => {
    const { url, method } = req.body; 

    if (!url || !method) {
        return res.status(400).json({ error: 'URL and Method are required.' });
    }

    const apiEndpoint = METHOD_ENDPOINT_MAP[method];

    if (!apiEndpoint) {
        return res.status(400).json({ 
            isBackendError: true,
            errorDetail: `Unsupported method: ${method}.`,
            statusCode: 0 
        });
    }

    const node_id = DEFAULT_NODE_ID;
    let request_id = null;

    try {
        // STEP 1: START CHECK & GET REQUEST ID
        const checkUrl = `${CHECK_HOST_BASE_URL}/${apiEndpoint}?host=${url}&node=${node_id}`;

        const startResponse = await axios.get(checkUrl, {
            headers: { 'Accept': 'application/json' },
            timeout: 8000 
        });

        if (startResponse.data.ok !== 1 || !startResponse.data.request_id) {

            // Fix 2: ดึงข้อความ error จาก Check-Host มาแสดงผล
            const checkHostMessage = startResponse.data.message || 'No specific error message provided by Check-Host.';

            if (apiEndpoint === 'check-whois' || apiEndpoint === 'check-dns') {
                 // Non-polling methods return initial result immediately
                return res.status(200).json({ 
                    isUp: true, 
                    latency: 0, 
                    statusCode: 200, 
                    message: `Initial result for ${method}: ${checkHostMessage}` 
                });
            }

            return res.status(200).json({ 
                isBackendError: true,
                errorDetail: `Check-Host API rejected the request for method ${method}. Message: ${checkHostMessage}`,
                statusCode: 0 
            });
        }

        request_id = startResponse.data.request_id;

        // STEP 2: WAIT AND GET CHECK RESULTS (POLLING)
        let checkResult = null;
        let attempt = 0;
        const maxAttempts = 6;
        // พิจารณาเพิ่ม delay เป็น 3500ms หากเกิดปัญหา Rate Limit ซ้ำ
        await delay(2500); 

        while (!checkResult && attempt < maxAttempts) {
            const resultUrl = `${CHECK_HOST_BASE_URL}/check-result/${request_id}`;
            const resultResponse = await axios.get(resultUrl, {
                headers: { 'Accept': 'application/json' },
                timeout: 5000
            });

            const nodeResult = resultResponse.data[node_id];

            if (nodeResult && nodeResult[0]) {
                checkResult = nodeResult[0]; 
                break;
            }

            attempt++;
            await delay(1500); 
        }

        if (!checkResult) {
            return res.status(200).json({
                latency: 6000,
                statusCode: 599, 
                isUp: false,
                errorRate: 1,
                errorDetail: `Check-Host node did not return result for ${method} within timeout.`
            });
        }

        // STEP 3: PROCESS AND RETURN DATA TO FRONTEND
        const [isUpRaw, latencySeconds, message, statusCodeRaw] = checkResult;

        const isUp = isUpRaw === 1;
        const latencyMs = Math.round((latencySeconds || 0) * 1000); 
        const statusCode = parseInt(statusCodeRaw || '0'); 

        res.status(200).json({
            latency: latencyMs,
            statusCode: statusCode,
            isUp: isUp,
            message: message 
        });

    } catch (error) {
        let errorDetail = `Backend failed to connect to Check-Host: ${error.message}`;
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            errorDetail = `Backend Timeout when calling Check-Host API for ${method}.`;
        }

        console.error('[BACKEND ERROR]', errorDetail);

        res.status(200).json({ 
            isBackendError: true,
            errorDetail: errorDetail,
            statusCode: 0 
        });
    }
});


// ====================================================================
// 🖥️ 2. NODE.JS FRONTEND (HTML/CSS/JS Serving)
// ====================================================================

const htmlContent = `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title id="appTitle">URL Monitor V3.0 (Single File)</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">

    <style>
        :root {
            --primary-color: #0d6efd;
            --success-color: #00e676;
            --warning-color: #ffb300;
            --danger-color: #ef5350;
            --bg-dark: #0a0a0a;
            --card-dark: #1c1c1c;
        }

        body { 
            background-color: var(--bg-dark); 
            font-family: 'Consolas', monospace; 
            color: #f0f2f5;
            transition: background-color 0.5s;
        }
        .full-screen-center {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .main-container { max-width: 1400px; }
        .config-card { 
            background-color: var(--card-dark); 
            padding: 25px; 
            border-radius: 12px; 
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6); 
            margin-bottom: 20px; 
            border: 1px solid #00ffff;
        }
        .metric-value { 
            font-size: 2.5rem; 
            font-weight: 700; 
            color: #fff;
            margin-top: -5px; 
            text-shadow: 0 0 15px rgba(0, 255, 255, 0.2); 
        }
        .text-latency { color: var(--warning-color); }
        .text-error { color: var(--danger-color); }

        .navbar-dark { background-color: #000; border-bottom: 3px solid #00ffff; } 
        .log-output { 
            background-color: #000; 
            border: 1px solid #00ffff; 
            color: var(--success-color); 
            font-family: monospace;
            height: 150px;
            overflow-y: scroll;
        }

        .status-critical {
            animation: pulse-red 1s infinite alternate;
            background-color: var(--danger-color) !important;
            color: white !important;
        }
        @keyframes pulse-red {
            from { box-shadow: 0 0 5px var(--danger-color); }
            to { box-shadow: 0 0 20px var(--danger-color); }
        }
        #splashScreen {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: var(--bg-dark); z-index: 9999; opacity: 1;
            transition: opacity 1s ease-out; 
        }
        .splash-content { text-align: center; color: #00ffff; }
        .splash-title {
            font-size: 4rem; text-shadow: 0 0 20px rgba(0, 255, 255, 0.5);
            animation: bounce-in 1.5s ease-out forwards;
        }
        @keyframes bounce-in {
            0% { transform: scale(0.5); opacity: 0; }
            70% { transform: scale(1.1); opacity: 1; }
            100% { transform: scale(1); }
        }
        .fade-out { opacity: 0 !important; visibility: hidden; }

        .triage-card {
            background-color: #ffc107; 
            border: 3px solid #dc3545; 
            color: #000;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none; 
        }
        .triage-card h4 { color: #dc3545; }
    </style>
</head>
<body>

    <div id="splashScreen" class="full-screen-center">
        <div class="splash-content">
            <h1 class="splash-title mb-4">
                <i class="fas fa-network-wired"></i> URL MONITOR
            </h1>
            <div class="spinner-border text-info" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-3 text-muted">Initializing application...</p>
        </div>
    </div>

    <div id="urlInputPage" class="full-screen-center" style="display: none;">
        <div class="card shadow p-5 bg-dark text-white" style="width: 550px; border: 1px solid #00ffff;">
            <h3 class="card-title text-center mb-4"><i class="fas fa-microchip text-danger"></i> URL MONITOR SETUP (V3.0)</h3>
            <p class="text-center text-muted">ตรวจสอบ URL ทั่วไปผ่าน Check-Host.net</p>

            <form id="urlInputForm">
                <div class="mb-3">
                    <label for="targetUrl" class="form-label">URL ที่ต้องการตรวจสอบ:</label>
                    <input type="url" class="form-control bg-dark text-white border-secondary" id="targetUrl" placeholder="https://www.google.com" required>
                </div>

                <div class="mb-4">
                    <label for="monitoringMethod" class="form-label">MONITORING METHOD:</label>
                    <select class="form-select bg-dark text-white border-secondary" id="monitoringMethod">
                        <option value="http">HTTP/HTTPS (Status Code, Latency)</option>
                        <option value="ping">PING (ICMP Latency)</option>
                        <option value="tcp">TCP Port Check</option>
                        <option value="dns">DNS Lookup</option>
                        <option value="whois" disabled>WHOIS (Requires Backend update)</option>
                    </select>
                </div>

                <button type="submit" class="btn btn-danger w-100 mt-4"><i class="fas fa-satellite-dish"></i> START REAL-TIME FETCH</button>

                <p class="small text-muted text-center mt-3">
                    <i class="fas fa-exclamation-triangle"></i> **INFO:** Server Address: <span id="serverAddress">Loading...</span>
                </p>
            </form>
        </div>
    </div>

    <div id="mainDashboard" class="container-fluid main-container" style="display: none;">
        <nav class="navbar navbar-expand-lg navbar-dark">
            <div class="container-fluid main-container">
                <a class="navbar-brand" href="#" onclick="resetApp()"><i class="fas fa-redo text-warning"></i> RESTART / CHANGE URL</a>
                <span class="navbar-text text-white">
                    <i class="fas fa-server text-info"></i> MONITORING: <strong id="monitoredUrl">N/A</strong>
                    | METHOD: <strong id="monitoredMethod" class="text-success">N/A</strong>
                </span>
            </div>
        </nav>

        <div class="row mt-4">

            <div class="col-12" id="triageSection">
                <div class="triage-card">
                    <h4><i class="fas fa-exclamation-circle"></i> AI SELF-TRIAGE (การแก้ไขข้อผิดพลาดอัตโนมัติ)</h4>
                    <p class="mb-1"><strong>สาเหตุที่ตรวจพบ:</strong> <span id="triageIssue"></span></p>
                    <hr>
                    <p class="mb-1"><strong><i class="fas fa-wrench"></i> ขั้นตอนที่ 1 (อัตโนมัติ):</strong> <span id="triageAction1">หยุดการตรวจสอบชั่วคราวเพื่อป้องกันการเกิดข้อผิดพลาดซ้ำ</span></p>
                    <p class="mb-1"><strong><i class="fas fa-rocket"></i> ขั้นตอนที่ 2 (คุณต้องทำ):</strong> <span id="triageAction2"></span></p>
                    <button class="btn btn-danger btn-sm mt-2" onclick="resumeMonitoring()"><i class="fas fa-play"></i> คลิกเพื่อเริ่มตรวจสอบต่อ (หลังแก้ไขแล้ว)</button>
                </div>
            </div>

            <div class="col-lg-3">
                <div class="config-card text-center">
                    <span class="d-block text-secondary small">CURRENT STATUS</span>
                    <h2 class="metric-value mt-2" id="currentStatusText">OFFLINE</h2>
                    <span class="badge bg-secondary p-2" id="currentStatusCode">CODE: 000</span>
                </div>
                <div class="config-card text-center">
                    <span class="d-block text-secondary small">AVERAGE LATENCY (ms)</span>
                    <h2 class="text-latency metric-value" id="metricLatency">0</h2>
                </div>
                <div class="config-card text-center">
                    <span class="d-block text-secondary small">URL ERROR RATE (%)</span>
                    <h2 class="text-error metric-value" id="metricErrors">0.00%</h2>
                </div>

                <div class="mt-3 p-3 bg-dark rounded config-card" style="border: 1px solid var(--warning-color);">
                    <h6 class="text-white"><i class="fas fa-brain text-success"></i> INSIGHT (Triage)</h6>
                    <p class="small mb-0 text-muted" id="insightText">Awaiting data...</p>
                </div>
            </div>

            <div class="col-lg-9">
                <div class="config-card">
                    <h4 class="text-info"><i class="fas fa-chart-area"></i> UPTIME TREND (LAST 5 MINUTES)</h4>
                    <div class="chart-area" style="height: 400px;">
                        <canvas id="loadChart"></canvas>
                    </div>
                </div>

                <div class="config-card mt-4">
                    <h5 class="text-danger"><i class="fas fa-radiation"></i> LOG: CRITICAL ALERTS</h5>
                    <div class="log-output p-3" id="logOutput">
                        <li>[00:00:00] <span style="color:var(--primary-color);">INFO:</span> SYSTEM INIT OK.</li>
                    </div>
                </div>
            </div>
        </div>

        <footer class="text-center mt-5 mb-3 text-muted small">
            © 2025 URL MONITOR V3.0. Single File Edition.
        </footer>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

    <script>
        // --- CONSTANTS ---
        const DEFAULT_INTERVAL_SECONDS = 5; 
        const UPDATE_INTERVAL_MS = DEFAULT_INTERVAL_SECONDS * 1000;
        const MAX_DATA_POINTS = 60; 
        const HIGH_LATENCY_THRESHOLD = 2000; 
        // ** API Endpoint คือของตัวเอง ไม่ต้องระบุ localhost/URL ภายนอก **
        const BACKEND_API_ENDPOINT = '/api/check'; 
        const SPLASH_DISPLAY_TIME_MS = 1000; 

        let chartInstance;
        let testTimer;
        let isMonitoringPaused = false; 
        let monitoredTarget = null;
        let errorRateHistory = []; 

        // --- V17: Triage Functions ---
        function pauseMonitoring(issue, action) {
            if (isMonitoringPaused) return;

            clearInterval(testTimer);
            isMonitoringPaused = true;

            document.getElementById('triageIssue').textContent = issue;
            document.getElementById('triageAction2').innerHTML = action;
            document.getElementById('triageSection').style.display = 'block';

            logMessage(\`[AUTO-TRIAGE] Monitoring PAUSED. Issue: \${issue}\`, 'danger');
        }

        function resumeMonitoring() {
            if (!isMonitoringPaused) return;

            document.getElementById('triageSection').style.display = 'none';
            isMonitoringPaused = false;

            logMessage(\`[AUTO-TRIAGE] Monitoring RESUMED. Starting check cycle.\`, 'warning');
            startMonitoring(monitoredTarget.interval);
        }

        // --- 6.1 Initialization & Splash Screen Logic ---
        document.addEventListener('DOMContentLoaded', () => {
            initializeChart();
            document.getElementById('serverAddress').textContent = window.location.origin;

            setTimeout(() => {
                const splash = document.getElementById('splashScreen');
                splash.classList.add('fade-out'); 

                setTimeout(() => {
                    splash.style.display = 'none';
                    document.getElementById('urlInputPage').style.display = 'flex';
                }, 1000); 

            }, SPLASH_DISPLAY_TIME_MS);
        });

        // --- 6.2 Form Submission (Start Monitoring) ---
        document.getElementById('urlInputForm').addEventListener('submit', function(e) {
            e.preventDefault();

            const url = document.getElementById('targetUrl').value;
            const method = document.getElementById('monitoringMethod').value;

            monitoredTarget = { 
                url: url, 
                method: method, 
                interval: UPDATE_INTERVAL_MS
            };

            showDashboard(url, method); 

            if (chartInstance) {
                chartInstance.data.labels = [];
                chartInstance.data.datasets[0].data = [];
                chartInstance.update();
            }

            startMonitoring(monitoredTarget.interval);
        });

        function resetApp() {
            if (testTimer) {
                clearInterval(testTimer);
            }
            monitoredTarget = null;
            errorRateHistory = [];
            isMonitoringPaused = false; 
            document.getElementById('triageSection').style.display = 'none';

            if (chartInstance) {
                chartInstance.data.labels = [];
                chartInstance.data.datasets[0].data = [];
                chartInstance.update();
            }

            document.getElementById('mainDashboard').style.display = 'none';
            document.getElementById('urlInputPage').style.display = 'flex';
            logMessage('MONITORING TERMINATED.', 'danger');
        }

        function showDashboard(url, method) {
            document.getElementById('monitoredUrl').textContent = new URL(url).hostname;
            document.getElementById('monitoredMethod').textContent = method.toUpperCase(); 
            document.getElementById('urlInputPage').style.display = 'none';
            document.getElementById('mainDashboard').style.display = 'block';

            logMessage(\`DASHBOARD LOADED. Starting check via Backend: \${window.location.origin}\${BACKEND_API_ENDPOINT} with METHOD: \${method}\`, 'success');
        }

        function startMonitoring(interval) {
            if (testTimer) clearInterval(testTimer);
            if (isMonitoringPaused) return; 

            fetchRealData(); 
            testTimer = setInterval(fetchRealData, interval);
        }

        // --------------------------------------------------------
        // V3.0: CORE FETCH FUNCTION (Sends URL and Method to self)
        // --------------------------------------------------------
        async function fetchRealData() { 
            if (!monitoredTarget || isMonitoringPaused) return;

            logMessage(\`[FETCH] Requesting check for \${monitoredTarget.url} using \${monitoredTarget.method}...\`, 'info');

            let avgLatency = 0;
            let errorRate = 1;
            let statusCode = 0;
            let insightMessage = "Waiting for data...";
            let isBackendIssue = false; 

            try {
                // Use relative path: /api/check
                const response = await fetch(BACKEND_API_ENDPOINT, { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        url: monitoredTarget.url,
                        method: monitoredTarget.method 
                    })
                });

                if (!response.ok) {
                    throw new Error(\`Backend HTTP Error: Status \${response.status}\`);
                }

                const data = await response.json();

                if (data.isBackendError) {
                    isBackendIssue = true;
                    insightMessage = \`🚨 **BACKEND ERROR:** Server มีปัญหาในการติดต่อ Check-Host API (\${data.errorDetail}) อาจเกิดจาก Network/Firewall.\`;
                    logMessage(\`[BACKEND ERROR] \${data.errorDetail}\`, 'danger');

                    pauseMonitoring(
                        'Server Node.js ไม่สามารถติดต่อ Check-Host.net ได้', 
                        'ตรวจสอบ **Network/Firewall** ของ Server หรือผู้ให้บริการ Cloud ว่ามีการบล็อกการเชื่อมต่อขาออก (Outbound) หรือไม่'
                    );

                } else {
                    avgLatency = parseFloat(data.latency).toFixed(2);
                    errorRate = data.isUp ? 0 : 1; 
                    statusCode = data.statusCode;
                    logMessage(\`[RESULT:\${monitoredTarget.method}] CODE \${statusCode} | Latency \${avgLatency}ms\`, data.isUp ? 'success' : 'danger');
                }

            } catch(e) {
                isBackendIssue = true;
                avgLatency = 0;
                errorRate = 1; 
                statusCode = 0;
                insightMessage = \`❌ **FATAL CONNECTION ERROR:** ไม่สามารถติดต่อ Server API ได้ (\${e.message}).\`;
                logMessage(\`[CRITICAL ERROR] Failed to fetch API: \${e.message}\`, 'danger');

                pauseMonitoring(
                    'Server API ออฟไลน์/ล่ม/ถูกบล็อกการเชื่อมต่อ', 
                    'ถ้าคุณรันในเครื่อง: ตรวจสอบ Terminal ว่า Node.js ยังทำงานอยู่หรือไม่ ถ้าเป็น Cloud: ตรวจสอบ Log และสถานะ Health Check'
                );
            }

            // 1. Core Metrics Calculation
            const uptimePercent = ((1 - errorRate) * 100).toFixed(2);

            // 2. Update UI
            let statusText = 'OPERATIONAL';
            let statusClass = 'text-uptime';
            let statusCodeDisplay = \`\${statusCode}\`;

            if (isBackendIssue) {
                statusText = isMonitoringPaused ? 'MONITORING PAUSED' : 'SERVER ERROR';
                statusClass = 'text-error status-critical';
                statusCodeDisplay = 'N/A';
            } else if (errorRate > 0) { 
                statusText = (statusCode >= 500 || statusCode === 599 || statusCode === 0) ? 'SERVER OUTAGE' : 'REQUEST FAILURE';
                statusClass = 'text-error status-critical';
                statusCodeDisplay = \`\${statusCode} FAILURE\`;
                insightMessage = \`🚨 **CRITICAL!** \${monitoredTarget.method.toUpperCase()} Check Failed (\${statusCode}). **ACTION: Check target URL/Service.**\`;

            } else if (avgLatency >= HIGH_LATENCY_THRESHOLD) { 
                statusText = 'HIGH LATENCY';
                statusClass = 'text-latency';
                statusCodeDisplay = \`\${statusCode} Latency Warning\`;
                insightMessage = \`🐌 **BOTTLENECK:** High latency (**\${avgLatency}ms**) detected for \${monitoredTarget.method.toUpperCase()}. **ACTION: Check network path.**\`;

            } else {
                statusCodeDisplay = \`\${statusCode} OK\`;
                insightMessage = \`Real-time data for \${monitoredTarget.url} via \${monitoredTarget.method.toUpperCase()}. Latency is stable.\`;
            }

            document.getElementById('currentStatusText').textContent = statusText;
            document.getElementById('currentStatusText').className = \`metric-value mt-2 \${statusClass}\`;
            document.getElementById('currentStatusCode').textContent = \`CODE: \${statusCodeDisplay}\`;
            document.getElementById('currentStatusCode').className = \`badge p-2 \${statusClass.includes('status-critical') ? 'bg-danger' : 'bg-primary'}\`;

            document.getElementById('metricLatency').textContent = avgLatency;
            document.getElementById('metricErrors').textContent = \`\${(errorRate * 100).toFixed(2)}%\`;
            document.getElementById('insightText').innerHTML = insightMessage;

            if (chartInstance && !isMonitoringPaused) {
                errorRateHistory.push(errorRate);
                if (errorRateHistory.length > MAX_DATA_POINTS) errorRateHistory.shift(); 
                updateChart(parseFloat(uptimePercent));
            } else if (!chartInstance) {
                initializeChart();
            }
        }

        // --- 6.3 Chart Setup / Utility Functions (Unchanged) ---
        function initializeChart() { 
            const ctx = document.getElementById('loadChart');
            if (chartInstance) { chartInstance.destroy(); }
            Chart.defaults.color = '#ccc';
            Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.1)';

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Uptime %',
                        data: [],
                        borderColor: '#00ff73', 
                        tension: 0.4,
                        fill: true,
                        backgroundColor: 'rgba(0, 255, 115, 0.1)',
                        pointRadius: 3 
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, max: 100, title: { display: true, text: 'Uptime %' }, grid: { color: 'rgba(255, 255, 255, 0.08)' } },
                        x: { display: false }
                    },
                    plugins: { legend: { display: true } }
                }
            });
        }

        function updateChart(uptimeValue) {
            const now = new Date();
            const timeLabel = now.toLocaleTimeString('th-TH');

            const numericUptime = isNaN(uptimeValue) ? 100 : uptimeValue; 

            chartInstance.data.labels.push(timeLabel);
            chartInstance.data.datasets[0].data.push(numericUptime);

            if (chartInstance.data.labels.length > MAX_DATA_POINTS) {
                chartInstance.data.labels.shift();
                chartInstance.data.datasets[0].data.shift(); 
            }

            let borderColor = 'var(--success-color)';
            if (numericUptime < 95) borderColor = 'var(--warning-color)'; 
            if (numericUptime < 90) borderColor = 'var(--danger-color)'; 
            chartInstance.data.datasets[0].borderColor = borderColor;

            chartInstance.update('none'); 
        }

        // Fix 1: แก้ไขการใช้ String Template Literal ซ้อนกัน (ReferenceError: time is not defined)
        function logMessage(message, type = 'info') {
            const logElement = document.getElementById('logOutput');
            const item = document.createElement('li');
            const time = new Date().toLocaleTimeString('th-TH');

            let color = '';
            if (type === 'success') color = 'var(--success-color)'; 
            else if (type === 'danger') color = 'var(--danger-color)'; 
            else if (type === 'warning') color = 'var(--warning-color)';
            else if (type === 'info') color = 'var(--primary-color)';

            item.innerHTML = '<span style="color: ' + color + ';">[' + time + '] ' + message + '</span>';
            logElement.appendChild(item);
            logElement.scrollTop = logElement.scrollHeight;
        }

    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(htmlContent);
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`✅ Full-Stack Monitor Server running on port ${PORT}`);
    if (PORT == 3000) {
        console.log(`🌐 Open in browser: http://localhost:3000`);
    } else {
        console.log(`⚠️ Check your Cloud provider's logs for the public URL.`);
    }
});
