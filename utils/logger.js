const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

if (!process.env.VERCEL) {
    if (!fs.existsSync(config.paths.logsDir)) {
        fs.mkdirSync(config.paths.logsDir, { recursive: true });
    }
}

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `[${timestamp}] ${level}: ${message}`;
        if (Object.keys(meta).length > 0 && meta.stack === undefined) {
            log += ` | ${JSON.stringify(meta)}`;
        }
        return log;
    })
);

const customLevels = {
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        http: 3,
        verbose: 4,
        debug: 5,
        silly: 6,
    },
    colors: {
        error: 'red',
        warn: 'yellow',
        info: 'green',
        http: 'magenta',
        verbose: 'cyan',
        debug: 'blue',
        silly: 'gray',
    },
};

winston.addColors(customLevels.colors);

const transports = [];
if (process.env.VERCEL) {
    transports.push(new winston.transports.Console({ format: consoleFormat }));
} else {
    transports.push(
        new winston.transports.File({
            filename: path.join(config.paths.logsDir, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join(config.paths.logsDir, 'combined.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 10,
        }),
        new winston.transports.Console({
            format: consoleFormat,
        })
    );
}

const logger = winston.createLogger({
    levels: customLevels.levels,
    level: config.server.env === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'notification-system' },
    transports: transports,
});

module.exports = logger;
