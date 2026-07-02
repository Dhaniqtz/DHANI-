const fs = require('fs');
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });

function convertToBool(text, fault = 'true') {
    return text === fault;
}

module.exports = {
    SESSION_ID: process.env.SESSION_ID || "bTYTnITD#-zsLzxo9YC9rSA4Z_LC6aZWDqD5jO3RN4eg_xtHs_-w",
    ALIVE_IMG: process.env.ALIVE_IMG || "https://raw.githubusercontent.com/Dhaniqtz/DHANI-/main/images/",
    ALIVE_MSG: process.env.ALIVE_MSG || "*Hello👋 DHANI-MD Is Alive Now😍*",
    BOT_OWNER: process.env.BOT_OWNER || '94719002563',  // Replace with the owner's phone number
    convertToBool
};
