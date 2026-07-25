require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const https = require('https');
const config = require('./config/config');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');
const notificationService = require('./services/notificationService');
const emailService = require('./services/emailService');
const databaseService = require('./services/databaseService');

const app = express();

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
    origin: (origin, callback) => {
        if (config.server.env === 'development' || !origin) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
}));

app.use(express.json({
    limit: '100kb',
    strict: true,
    type: 'application/json',
}));

app.use(express.urlencoded({
    extended: true,
    limit: '100kb',
}));

app.use((req, res, next) => {
    logger.http(`${req.method} ${req.originalUrl}`, {
        method: req.method,
        url: req.originalUrl,
        ip: req.headers['x-forwarded-for'] || req.ip,
        user_agent: req.headers['user-agent'],
    });
    next();
});

app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        logger.warn('Invalid JSON payload received', {
            ip: req.ip,
            error: err.message,
        });
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON format in request body',
            errorCode: 'INVALID_JSON',
        });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            error: 'Request payload too large',
            errorCode: 'PAYLOAD_TOO_LARGE',
        });
    }
    next(err);
});

app.use(express.static(path.join(__dirname), {
    index: false,
    maxAge: config.server.env === 'production' ? '1h' : 0,
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/api', apiRoutes);

app.use((req, res) => {
    if (req.accepts('html') && req.method === 'GET') {
        res.status(404).sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({
            success: false,
            error: 'Endpoint not found',
            path: req.originalUrl,
            method: req.method,
        });
    }
});

let server;

function startServer() {
    const port = config.server.port;

    if (config.server.enableHttps) {
        try {
            const key = fs.readFileSync(path.resolve(config.server.sslKeyPath), 'utf8');
            const cert = fs.readFileSync(path.resolve(config.server.sslCertPath), 'utf8');
            const httpsOptions = { key, cert, minVersion: 'TLSv1.2' };
            server = https.createServer(httpsOptions, app);
        } catch (err) {
            logger.error('Failed to load SSL certificates, falling back to HTTP', {
                error: err.message,
            });
            config.server.enableHttps = false;
            return startServer();
        }
    } else {
        const http = require('http');
        server = http.createServer(app);
    }

    const protocol = config.server.enableHttps ? 'https' : 'http';

    server.listen(port, config.server.host, () => {
        logger.info('╔══════════════════════════════════════════════╗');
        logger.info('║  🚀 Form Notification System Started         ║');
        logger.info('╠══════════════════════════════════════════════╣');
        logger.info(`║  • Protocol : ${protocol.toUpperCase().padEnd(33)}║`);
        logger.info(`║  • Host     : ${String(config.server.host).padEnd(33)}║`);
        logger.info(`║  • Port     : ${String(port).padEnd(33)}║`);
        logger.info(`║  • Env      : ${config.server.env.padEnd(33)}║`);
        logger.info(`║  • URL      : ${(`${protocol}://${config.server.host}:${port}`).padEnd(33)}║`);
        logger.info('╠══════════════════════════════════════════════╣');

        notificationService.healthCheck().then(status => {
            const tg = status.telegram;
            const em = status.email;
            logger.info(`║  📱 Telegram: ${tg.configured ? (tg.connection ? '✅ CONNECTED' : '⚠️  CONFIGURED (Auth Fail)') : '❌ NOT CONFIGURED'}  ║`);
            logger.info(`║  📧 Email   : ${em.configured ? (em.connection ? '✅ CONNECTED' : '⚠️  CONFIGURED (Auth Fail)') : '❌ NOT CONFIGURED'}  ║`);
            logger.info(`║  🗄️  Database: ✅ READY                        ║`);
            logger.info('╚══════════════════════════════════════════════╝');
        }).catch(() => {
            logger.info('╚══════════════════════════════════════════════╝');
        });

        notificationService.startRetryScheduler();
    });

    server.on('error', (error) => {
        if (error.syscall !== 'listen') {
            throw error;
        }
        switch (error.code) {
            case 'EACCES':
                logger.error(`Port ${port} requires elevated privileges`);
                process.exit(1);
                break;
            case 'EADDRINUSE':
                logger.error(`Port ${port} is already in use`);
                process.exit(1);
                break;
            default:
                throw error;
        }
    });

    return server;
}

const gracefulShutdown = (signal) => {
    logger.info(`${signal} received: starting graceful shutdown`);
    notificationService.stopRetryScheduler();
    if (server && server.close) {
        server.close(async () => {
            logger.info('HTTP server closed');
            try {
                await emailService.close();
                databaseService.close();
            } catch (err) {
                logger.error('Error during cleanup', { error: err.message });
            }
            logger.info('Shutdown complete');
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 15000);
    } else {
        process.exit(0);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION', {
        error: err.message,
        stack: err.stack,
    });
    databaseService.logError(null, 'uncaught_exception', err);
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('UNHANDLED PROMISE REJECTION', {
        reason: reason?.message || String(reason),
        stack: reason?.stack,
    });
    databaseService.logError(null, 'unhandled_rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

if (require.main === module) {
    startServer();
}

module.exports = app;
