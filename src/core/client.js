const { Client, LocalAuth } = require('whatsapp-web.js');

function criarClientWhatsApp() {
    return new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: false,
            executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                '--disable-application-cache',
                '--disk-cache-size=0',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-features=NetworkService'
            ]
        }
    });
}

module.exports = { criarClientWhatsApp };