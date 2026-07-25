const telegramService = require('./telegramService');
const emailService = require('./emailService');
const databaseService = require('./databaseService');
const logger = require('../utils/logger');
const { sanitizeData, generateSubmissionId, getClientIp, getUserAgent } = require('../utils/security');

class NotificationService {
    constructor() {
        this.retryIntervalMs = 5 * 60 * 1000;
        this.maxRetries = 5;
        this.retryTimer = null;
    }

    async processSubmission(req, rawData) {
        const submissionId = generateSubmissionId();
        const clientIp = getClientIp(req);
        const userAgent = getUserAgent(req);
        const sanitizedData = sanitizeData(rawData, false);

        logger.info(`Processing new submission: ${submissionId}`, {
            client_ip: clientIp,
            fields: Object.keys(rawData),
        });

        try {
            databaseService.saveSubmission({
                submission_id: submissionId,
                raw_data: JSON.stringify(rawData),
                sanitized_data: JSON.stringify(sanitizedData),
                client_ip: clientIp,
                user_agent: userAgent,
                telegram_status: 'PENDING',
                email_status: 'PENDING',
                overall_status: 'PENDING',
            });
        } catch (dbError) {
            logger.error('Critical: Failed to save initial submission to database', {
                submission_id: submissionId,
                error: dbError.message,
            });
        }

        const meta = {
            clientIp,
            userAgent,
            createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        };

        const [telegramResult, emailResult] = await Promise.allSettled([
            this.sendWithLogging(submissionId, 'telegram', sanitizedData, meta),
            this.sendWithLogging(submissionId, 'email', sanitizedData, meta),
        ]);

        const tgStatus = this.extractStatus(telegramResult, 'telegram');
        const emStatus = this.extractStatus(emailResult, 'email');

        const overall = this.computeOverallStatus(tgStatus, emStatus);
        const updates = {
            telegram_status: tgStatus,
            email_status: emStatus,
            overall_status: overall,
        };

        if (telegramResult.status === 'rejected') {
            updates.telegram_error = String(telegramResult.reason?.message || telegramResult.reason || 'Unknown');
        }
        if (emailResult.status === 'rejected') {
            updates.email_error = String(emailResult.reason?.message || emailResult.reason || 'Unknown');
        }

        try {
            databaseService.updateSubmissionStatus(submissionId, updates);
        } catch (dbError) {
            logger.error('Failed to update final submission status', {
                submission_id: submissionId,
                error: dbError.message,
            });
        }

        return {
            submissionId,
            telegram: this.summarizeResult(telegramResult, 'telegram'),
            email: this.summarizeResult(emailResult, 'email'),
            overallStatus: overall,
        };
    }

    async sendWithLogging(submissionId, channel, sanitizedData, meta) {
        let result;
        if (channel === 'telegram') {
            result = await telegramService.sendMessage(submissionId, sanitizedData, meta);
        } else if (channel === 'email') {
            result = await emailService.sendEmail(submissionId, sanitizedData, meta);
        } else {
            throw new Error(`Unknown notification channel: ${channel}`);
        }

        const status = result.skipped ? 'SKIPPED' : (result.success ? 'SUCCESS' : 'FAILED');
        const errorMsg = result.error || null;
        const responseData = { ...result };
        delete responseData.results;

        try {
            databaseService.logNotification(submissionId, channel, status, errorMsg, responseData);
        } catch (dbErr) {
            logger.error('Failed to log notification', { channel, submission_id: submissionId });
        }

        if (status === 'FAILED') {
            const err = new Error(`Failed to send ${channel} notification: ${errorMsg || 'unknown error'}`);
            err.result = result;
            databaseService.logError(submissionId, `${channel}_send`, err, { result });
            throw err;
        }

        return result;
    }

    extractStatus(promiseSettledResult, channel) {
        if (promiseSettledResult.status === 'fulfilled') {
            const val = promiseSettledResult.value;
            if (val?.skipped) return 'SKIPPED';
            return val?.success ? 'SUCCESS' : 'FAILED';
        }
        return 'FAILED';
    }

    computeOverallStatus(tgStatus, emStatus) {
        const bothSuccess = tgStatus === 'SUCCESS' && emStatus === 'SUCCESS';
        const bothSkipped = (tgStatus === 'SKIPPED' || tgStatus === 'SUCCESS') &&
                            (emStatus === 'SKIPPED' || emStatus === 'SUCCESS') &&
                            !(tgStatus === 'SUCCESS' && emStatus === 'SUCCESS');
        const atLeastOneFailed = tgStatus === 'FAILED' || emStatus === 'FAILED';
        const atLeastOneSuccess = tgStatus === 'SUCCESS' || emStatus === 'SUCCESS';

        if (tgStatus === 'SKIPPED' && emStatus === 'SKIPPED') return 'SKIPPED';
        if (bothSuccess) return 'SUCCESS';
        if (atLeastOneFailed && atLeastOneSuccess) return 'PARTIAL';
        if (bothSkipped && !atLeastOneFailed) return 'SUCCESS';
        if (atLeastOneFailed && !atLeastOneSuccess) return 'FAILED';
        return atLeastOneSuccess ? 'PARTIAL' : 'PENDING';
    }

    summarizeResult(promiseSettledResult, channel) {
        if (promiseSettledResult.status === 'fulfilled') {
            const value = promiseSettledResult.value;
            return {
                success: !!value?.success,
                skipped: !!value?.skipped,
                error: value?.error || null,
            };
        }
        return {
            success: false,
            skipped: false,
            error: String(promiseSettledResult.reason?.message || promiseSettledResult.reason || 'Unknown error'),
        };
    }

    async retryFailedSubmissions() {
        logger.info('Starting retry process for failed submissions');
        const pending = databaseService.getPendingSubmissions(50);
        let retried = 0;
        let succeeded = 0;

        for (const sub of pending) {
            try {
                databaseService.incrementRetryCount(sub.submission_id);
                const meta = {
                    clientIp: sub.client_ip,
                    userAgent: sub.user_agent,
                    createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                };

                const needsTelegram = sub.telegram_status !== 'SUCCESS' && sub.telegram_status !== 'SKIPPED';
                const needsEmail = sub.email_status !== 'SUCCESS' && sub.email_status !== 'SKIPPED';

                let tgResult = { success: sub.telegram_status === 'SUCCESS', skipped: sub.telegram_status === 'SKIPPED' };
                let emResult = { success: sub.email_status === 'SUCCESS', skipped: sub.email_status === 'SKIPPED' };

                if (needsTelegram) {
                    try {
                        tgResult = await this.sendWithLogging(sub.submission_id, 'telegram', sub.sanitized_data, meta);
                        tgResult = { success: tgResult?.success, skipped: tgResult?.skipped, error: tgResult?.error };
                    } catch (err) {
                        tgResult = { success: false, skipped: false, error: err.message };
                    }
                }
                if (needsEmail) {
                    try {
                        emResult = await this.sendWithLogging(sub.submission_id, 'email', sub.sanitized_data, meta);
                        emResult = { success: emResult?.success, skipped: emResult?.skipped, error: emResult?.error };
                    } catch (err) {
                        emResult = { success: false, skipped: false, error: err.message };
                    }
                }

                const tgStatus = tgResult.skipped ? 'SKIPPED' : (tgResult.success ? 'SUCCESS' : 'FAILED');
                const emStatus = emResult.skipped ? 'SKIPPED' : (emResult.success ? 'SUCCESS' : 'FAILED');
                const overall = this.computeOverallStatus(tgStatus, emStatus);

                const updates = { telegram_status: tgStatus, email_status: emStatus, overall_status: overall };
                if (tgResult.error) updates.telegram_error = tgResult.error;
                if (emResult.error) updates.email_error = emResult.error;

                databaseService.updateSubmissionStatus(sub.submission_id, updates);

                retried++;
                if (overall === 'SUCCESS') succeeded++;
            } catch (error) {
                logger.error(`Error retrying submission ${sub.submission_id}`, { error: error.message });
                databaseService.logError(sub.submission_id, 'retry_process', error);
            }
        }

        logger.info(`Retry process completed: ${retried} submissions processed, ${succeeded} succeeded`);
        return { processed: retried, succeeded };
    }

    startRetryScheduler() {
        if (this.retryTimer) return;
        this.retryTimer = setInterval(() => {
            this.retryFailedSubmissions().catch(err => {
                logger.error('Retry scheduler error', { error: err.message, stack: err.stack });
            });
        }, this.retryIntervalMs);
        logger.info(`Retry scheduler started (every ${this.retryIntervalMs / 1000}s)`);
    }

    stopRetryScheduler() {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
            logger.info('Retry scheduler stopped');
        }
    }

    async healthCheck() {
        const [tgHealth, emailHealth] = await Promise.all([
            telegramService.testConnection().catch(e => ({ success: false, error: e.message })),
            emailService.testConnection().catch(e => ({ success: false, error: e.message })),
        ]);
        return {
            telegram: {
                configured: telegramService.isAvailable(),
                connection: tgHealth.success,
                bot_username: tgHealth.bot?.username || null,
                error: tgHealth.error || null,
            },
            email: {
                configured: emailService.isAvailable(),
                connection: emailHealth.success,
                error: emailHealth.error || null,
            },
            database: {
                configured: true,
            },
        };
    }
}

const notificationService = new NotificationService();
module.exports = notificationService;
