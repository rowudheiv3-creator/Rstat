// server.js (Node.js Backend - V2.3: Method Support)

const express = require('express');
const axios = require('axios');
const cors = require('cors'); 

const app = express();
const PORT = 3000;
const CHECK_HOST_BASE_URL = 'https://check-host.net';

// --- CONFIGURATION ---
const DEFAULT_NODE_ID = 'sg1.node.check-host.net'; 

// V2.3: Mapping Method ที่ผู้ใช้เลือก กับ Endpoint ของ check-host.net
const METHOD_ENDPOINT_MAP = {
    'http': 'check-http',
    'ping': 'check-ping',
    'tcp': 'check-tcp',
    'udp': 'check-udp', // อาจต้องระบุพอร์ตใน URL ด้วย
    'dns': 'check-dns',
    'whois': 'check-whois' // ไม่รองรับการ Polling แบบ Real-time
};

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Middleware & CORS FIX ---
app.use(cors()); 
app.use(express.json());

app.get('/', (req, res) => {
    res.status(200).send({ status: 'Backend running OK', message: 'Ready to receive checks on /api/check' });
});

// --- Backend Endpoint for Real URL Check using check-host.net ---
app.post('/api/check', async (req, res) => {
    const { url, method } = req.body; // V2.3 Change: รับ method มาด้วย

    if (!url || !method) {
        return res.status(400).json({ error: 'URL and Method are required.' });
    }
    
    // V2.3: ตรวจสอบ Method และ Endpoint
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
        // ------------------------------------------------------------------
        // STEP 1: START CHECK & GET REQUEST ID (ใช้ Endpoint ตาม Method)
        // ------------------------------------------------------------------
        const checkUrl = `${CHECK_HOST_BASE_URL}/${apiEndpoint}?host=${url}&node=${node_id}`;
        
        const startResponse = await axios.get(checkUrl, {
            headers: { 'Accept': 'application/json' },
            timeout: 8000 
        });

        if (startResponse.data.ok !== 1 || !startResponse.data.request_id) {
            // Whois และ DNS บางครั้งอาจตอบกลับทันทีโดยไม่ให้ request_id
            if (apiEndpoint === 'check-whois' || apiEndpoint === 'check-dns') {
                return res.status(200).json({ 
                    isUp: true, 
                    latency: 0, 
                    statusCode: 200, 
                    message: `Initial result for ${method}: ${startResponse.data.message || 'Data received.'}` 
                });
            }

            return res.status(200).json({ 
                isBackendError: true,
                errorDetail: `Check-Host API rejected the request for method ${method}.`,
                statusCode: 0 
            });
        }

        request_id = startResponse.data.request_id;
        
        // ------------------------------------------------------------------
        // STEP 2: WAIT AND GET CHECK RESULTS (POLLING)
        // ------------------------------------------------------------------
        let checkResult = null;
        let attempt = 0;
        const maxAttempts = 6;
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

        // ------------------------------------------------------------------
        // STEP 3: PROCESS AND RETURN DATA TO FRONTEND
        // ------------------------------------------------------------------
        // V2.3: การประมวลผลผลลัพธ์จาก check-host.net ขึ้นอยู่กับ Method:
        // http, ping, tcp มักใช้ [isUp, latency, message, statusCode]
        const [isUpRaw, latencySeconds, message, statusCodeRaw] = checkResult;

        const isUp = isUpRaw === 1;
        const latencyMs = Math.round((latencySeconds || 0) * 1000); // 0 ถ้าไม่มี latency (เช่น DNS)
        const statusCode = parseInt(statusCodeRaw || '0'); 
        const errorRate = isUp ? 0 : 1;
        
        res.status(200).json({
            latency: latencyMs,
            statusCode: statusCode,
            isUp: isUp,
            errorRate: errorRate,
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

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`✅ Backend Monitor Server running on http://localhost:${PORT}`);
    console.log(`   (Monitoring Node: ${DEFAULT_NODE_ID})`);
});