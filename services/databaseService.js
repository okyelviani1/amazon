let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    Database = null;
}
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');

class DatabaseService {
    constructor() {
        if (process.env.VERCEL || !Database) {
            this.isMock = true;
            this.db = null;
            logger.warn('Running in Vercel or better-sqlite3 failed to load. Database is mocked and data will NOT be saved.');
            return;
        }
        if (!fs.existsSync(config.paths.dataDir)) {
            fs.mkdirSync(config.paths.dataDir, { recursive: true });
        }
        this.dbPath = path.resolve(config.paths.dbFile);
        this.db = null;
        this.init();
    }

    init() {
        try {
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('foreign_keys = ON');
            this.createTables();
            logger.info(`Database initialized at ${this.dbPath}`);
        } catch (error) {
            logger.error('Failed to initialize database', {
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }

    createTables() {
        const createSubmissions = `
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id TEXT UNIQUE NOT NULL,
                raw_data TEXT NOT NULL,
                sanitized_data TEXT NOT NULL,
                client_ip TEXT,
                user_agent TEXT,
                telegram_status TEXT DEFAULT 'PENDING',
                telegram_error TEXT,
                email_status TEXT DEFAULT 'PENDING',
                email_error TEXT,
                overall_status TEXT DEFAULT 'PENDING',
                retry_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const createNotificationLogs = `
            CREATE TABLE IF NOT EXISTS notification_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                response_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (submission_id) REFERENCES submissions(submission_id)
            )
        `;

        const createErrorLogs = `
            CREATE TABLE IF NOT EXISTS error_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id TEXT,
                component TEXT NOT NULL,
                error_message TEXT NOT NULL,
                error_stack TEXT,
                context_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        const idxSubmissionId = `CREATE INDEX IF NOT EXISTS idx_submissions_submission_id ON submissions(submission_id)`;
        const idxSubmissionStatus = `CREATE INDEX IF NOT EXISTS idx_submissions_overall_status ON submissions(overall_status)`;
        const idxNotificationSubmission = `CREATE INDEX IF NOT EXISTS idx_notif_logs_submission_id ON notification_logs(submission_id)`;

        this.db.exec(createSubmissions);
        this.db.exec(createNotificationLogs);
        this.db.exec(createErrorLogs);
        this.db.exec(idxSubmissionId);
        this.db.exec(idxSubmissionStatus);
        this.db.exec(idxNotificationSubmission);
    }

    saveSubmission(submission) {
        if (this.isMock) return Date.now();
        try {
            const stmt = this.db.prepare(`
                INSERT INTO submissions (
                    submission_id, raw_data, sanitized_data, client_ip, user_agent,
                    telegram_status, email_status, overall_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(
                submission.submission_id,
                submission.raw_data,
                submission.sanitized_data,
                submission.client_ip || null,
                submission.user_agent || null,
                submission.telegram_status || 'PENDING',
                submission.email_status || 'PENDING',
                submission.overall_status || 'PENDING'
            );
            logger.debug(`Submission saved: ${submission.submission_id}`, { rowId: result.lastInsertRowid });
            return result.lastInsertRowid;
        } catch (error) {
            logger.error('Failed to save submission to database', {
                error: error.message,
                submission_id: submission?.submission_id,
            });
            this.logError(null, 'database_save_submission', error, { submission });
            throw error;
        }
    }

    updateSubmissionStatus(submissionId, updates) {
        if (this.isMock) return 1;
        try {
            const allowedFields = ['telegram_status', 'telegram_error', 'email_status', 'email_error', 'overall_status', 'retry_count'];
            const fields = [];
            const values = [];
            for (const field of allowedFields) {
                if (updates.hasOwnProperty(field)) {
                    fields.push(`${field} = ?`);
                    values.push(updates[field]);
                }
            }
            fields.push('updated_at = CURRENT_TIMESTAMP');
            values.push(submissionId);
            const stmt = this.db.prepare(`UPDATE submissions SET ${fields.join(', ')} WHERE submission_id = ?`);
            const result = stmt.run(...values);
            logger.debug(`Submission status updated: ${submissionId}`, { updates });
            return result.changes;
        } catch (error) {
            logger.error('Failed to update submission status', {
                error: error.message,
                submission_id: submissionId,
            });
            this.logError(submissionId, 'database_update_status', error, { updates });
            throw error;
        }
    }

    logNotification(submissionId, channel, status, errorMessage = null, responseData = null) {
        if (this.isMock) return;
        try {
            const stmt = this.db.prepare(`
                INSERT INTO notification_logs (submission_id, channel, status, error_message, response_data)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(
                submissionId,
                channel,
                status,
                errorMessage,
                responseData ? JSON.stringify(responseData) : null
            );
        } catch (error) {
            logger.error('Failed to log notification', {
                error: error.message,
                submission_id: submissionId,
                channel,
            });
        }
    }

    logError(submissionId, component, error, context = null) {
        if (this.isMock) return;
        try {
            const stmt = this.db.prepare(`
                INSERT INTO error_logs (submission_id, component, error_message, error_stack, context_data)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(
                submissionId || null,
                component,
                error?.message || String(error),
                error?.stack || null,
                context ? JSON.stringify(context) : null
            );
        } catch (dbError) {
            logger.error('Failed to write error log to database', {
                error: dbError.message,
            });
        }
    }

    getPendingSubmissions(limit = 100) {
        if (this.isMock) return [];
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM submissions
                WHERE overall_status IN ('PENDING', 'PARTIAL', 'FAILED')
                AND retry_count < 5
                ORDER BY created_at ASC
                LIMIT ?
            `);
            const rows = stmt.all(limit);
            return rows.map(row => ({
                ...row,
                raw_data: JSON.parse(row.raw_data),
                sanitized_data: JSON.parse(row.sanitized_data),
            }));
        } catch (error) {
            logger.error('Failed to get pending submissions', { error: error.message });
            return [];
        }
    }

    incrementRetryCount(submissionId) {
        if (this.isMock) return 1;
        try {
            const stmt = this.db.prepare(`
                UPDATE submissions
                SET retry_count = retry_count + 1, updated_at = CURRENT_TIMESTAMP
                WHERE submission_id = ?
            `);
            return stmt.run(submissionId).changes;
        } catch (error) {
            logger.error('Failed to increment retry count', { error: error.message, submission_id: submissionId });
            return 0;
        }
    }

    close() {
        if (this.isMock) return;
        if (this.db) {
            this.db.close();
            logger.info('Database connection closed');
        }
    }
}

const databaseService = new DatabaseService();
module.exports = databaseService;
