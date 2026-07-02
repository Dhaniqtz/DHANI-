const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const P = require('pino');
const express = require('express');
const axios = require('axios');
const path = require('path');
const qrcode = require('qrcode-terminal');

const config = require('./config');
const { sms, downloadMediaMessage } = require('./lib/msg');
const {
  getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson
} = require('./lib/functions');
const { File } = require('megajs');
const { commands, replyHandlers } = require('./command');

const app = express();
const port = process.env.PORT || 8000;

const prefix = '.';
const ownerNumber = ['94719002563'];
const credsPath = path.join(__dirname, '/auth_info_baileys/creds.json');

async function ensureSessionFile() {
  // Make sure auth directory exists
  fs.mkdirSync(path.join(__dirname, '/auth_info_baileys/'), { recursive: true });

  if (!fs.existsSync(credsPath)) {
    // If SESSION_ID is not provided, allow fresh auth (QR) instead of exiting
    if (!config.SESSION_ID) {
      console.warn('⚠️  creds.json not found and SESSION_ID not provided. Proceeding with fresh auth — a QR will be printed to the console.');
      // Start the connection flow which will generate auth files and QR
      setTimeout(() => connectToWA(), 1000);
      return;
    }

    console.log("🔄 creds.json not found. Downloading session from MEGA...");

    const sessdata = config.SESSION_ID;
    try {
      const filer = File.fromURL(`https://mega.nz/file/${sessdata}`);

      filer.download((err, data) => {
        if (err) {
          console.error("❌ Failed to download session file from MEGA:", err);
          process.exit(1);
        }

        fs.writeFileSync(credsPath, data);
        console.log("✅ Session downloaded and saved. Restarting bot...");
        setTimeout(() => {
          connectToWA();
        }, 2000);
      });
    } catch (e) {
      console.error('❌ Error while fetching session from MEGA:', e);
      process.exit(1);
    }
  } else {
    setTimeout(() => {
      connectToWA();
    }, 1000);
  }
}

async function connectToWA() {
  console.log("Connecting DHANI-MD 🧬...");
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '/auth_info_baileys/'));
  const { version } = await fetchLatestBaileysVersion();

  const dhani = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Firefox"),
    auth: state,
    version,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
  });

  dhani.ev.on('connection.update', async (update) => {
    // If QR is present (fresh auth), print it so the user can scan it
    if (update.qr) {
      console.log('🔐 Please scan the QR code with your WhatsApp account:');
      qrcode.generate(update.qr, { small: true });
    }

    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        connectToWA();
      } else {
        console.log('➡️ Logged out from WA, please restore session or login again.');
      }
    } else if (connection === 'open') {
      console.log('✅ DHANI-MD connected to WhatsApp');

      const up = `DHANI-MD connected ✅\n\nPREFIX: ${prefix}`;
      // send a simple text notification to the owner to avoid invalid image URL issues
      try {
        await dhani.sendMessage(ownerNumber[0] + "@s.whatsapp.net", { text: up });
      } catch (e) {
        console.warn('⚠️ Failed to notify owner on connect:', e && e.message ? e.message : e);
      }

      try {
        if (fs.existsSync('./plugins/')) {
          fs.readdirSync("./plugins/").forEach((plugin) => {
            if (path.extname(plugin).toLowerCase() === ".js") {
              try { require(`./plugins/${plugin}`); } catch (err) { console.error('[PLUGIN LOAD ERROR]', plugin, err); }
            }
          });
        } else {
          console.log('ℹ️ No plugins directory found.');
        }
      } catch (e) {
        console.error('Error loading plugins:', e);
      }
    }
  });

  dhani.ev.on('creds.update', saveCreds);

  dhani.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.messageStubType === 68) {
        await dhani.sendMessageAck(msg.key);
      }
    }

    const mek = messages[0];
    if (!mek || !mek.message) return;

    mek.message = getContentType(mek.message) === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message;
    if (mek.key.remoteJid === 'status@broadcast') return;

    const m = sms(dhani, mek);
    const type = getContentType(mek.message);
    const from = mek.key.remoteJid;
    const body = type === 'conversation' ? mek.message.conversation : mek.message[type]?.text || mek.message[type]?.caption || '';
    const isCmd = body.startsWith(prefix);
    const commandName = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : '';
    const args = body.trim().split(/ +/).slice(1);
    const q = args.join(' ');

    const sender = mek.key.fromMe ? dhani.user.id : (mek.key.participant || mek.key.remoteJid);
    const senderNumber = sender.split('@')[0];
    const isGroup = from.endsWith('@g.us');
    const botNumber = dhani.user.id.split(':')[0];
    const pushname = mek.pushName || 'Sin Nombre';
    const isMe = botNumber.includes(senderNumber);
    const isOwner = ownerNumber.includes(senderNumber) || isMe;
    const botNumber2 = await jidNormalizedUser(dhani.user.id);

    const groupMetadata = isGroup ? await dhani.groupMetadata(from).catch(() => {}) : '';
    const groupName = isGroup ? groupMetadata.subject : '';
    const participants = isGroup ? groupMetadata.participants : '';
    const groupAdmins = isGroup ? await getGroupAdmins(participants) : '';
    const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
    const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

    const reply = (text) => dhani.sendMessage(from, { text }, { quoted: mek });

    if (isCmd) {
      const cmd = commands.find((c) => c.pattern === commandName || (c.alias && c.alias.includes(commandName)));
      if (cmd) {
        if (cmd.react) dhani.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          cmd.function(dhani, mek, m, {
            from, quoted: mek, body, isCmd, command: commandName, args, q,
            isGroup, sender, senderNumber, botNumber2, botNumber, pushname,
            isMe, isOwner, groupMetadata, groupName, participants, groupAdmins,
            isBotAdmins, isAdmins, reply,
          });
        } catch (e) {
          console.error("[PLUGIN ERROR]", e);
        }
      }
    }

    const replyText = body;
    for (const handler of replyHandlers) {
      if (handler.filter(replyText, { sender, message: mek })) {
        try {
          await handler.function(dhani, mek, m, {
            from, quoted: mek, body: replyText, sender, reply,
          });
          break;
        } catch (e) {
          console.log("Reply handler error:", e);
        }
      }
    }
  });
}

ensureSessionFile();

app.get("/", (req, res) => {
  res.send("Hey, DHANI-MD started✅");
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
