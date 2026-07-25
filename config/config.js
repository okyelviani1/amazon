require('dotenv').config();

const config = {
    server: {
        port: parseInt(process.env.PORT) || 3000,
        host: process.env.HOST || '0.0.0.0',
        env: process.env.NODE_ENV || 'development',
        enableHttps: process.env.ENABLE_HTTPS === 'true',
        sslCertPath: process.env.SSL_CERT_PATH || './certs/cert.pem',
        sslKeyPath: process.env.SSL_KEY_PATH || './certs/key.pem',
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatIds: (process.env.TELEGRAM_CHAT_ID || '')
            .split(',')
            .map(id => id.trim())
            .filter(id => id !== ''),
        apiBaseUrl: 'https://api.telegram.org',
    },
    smtp: {
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        fromName: process.env.SMTP_FROM_NAME || 'Form Notification System',
        toAddresses: (process.env.SMTP_TO || '')
            .split(',')
            .map(addr => addr.trim())
            .filter(addr => addr !== ''),
    },
    paths: {
        dataDir: process.env.VERCEL ? '/tmp/data' : './data',
        logsDir: process.env.VERCEL ? '/tmp/logs' : './logs',
        dbFile: process.env.VERCEL ? '/tmp/data/submissions.db' : './data/submissions.db',
    },
};

module.exports = config;
