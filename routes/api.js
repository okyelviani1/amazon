const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');
const { sanitizeData } = require('../utils/security');

function buildResponseMessage(overallStatus) {
    switch (overallStatus) {
        case 'SUCCESS':
            return 'Form received and notifications sent successfully';
        case 'PARTIAL':
            return 'Form received but some notification channels failed. Data is backed up for retry.';
        case 'FAILED':
            return 'Form received but all notification channels failed. Data is backed up for retry.';
        case 'SKIPPED':
            return 'Form received but no notification channels configured. Data is saved.';
        default:
            return 'Form submission received';
    }
}

router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'form-notification-system',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

router.get('/health/detailed', async (req, res) => {
    try {
        const details = await notificationService.healthCheck();
        const allOk = details.telegram.connection || details.email.connection;
        res.status(allOk ? 200 : 503).json({
            status: allOk ? 'ok' : 'degraded',
            services: details,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(500).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

router.post('/submit', async (req, res) => {
    try {
        let rawData = req.body;
        if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request body: expected JSON object with form data',
            });
        }

        const fieldCount = Object.keys(rawData).length;
        if (fieldCount === 0) {
            return res.status(400).json({
                success: false,
                error: 'Empty form data received: at least one field is required',
            });
        }

        const maxSize = 100 * 1024;
        const bodySize = Buffer.byteLength(JSON.stringify(rawData), 'utf8');
        if (bodySize > maxSize) {
            return res.status(413).json({
                success: false,
                error: `Request body too large (${bodySize} bytes). Maximum allowed: ${maxSize} bytes`,
            });
        }

        const result = await notificationService.processSubmission(req, rawData);

        const allSkipped = result.telegram.skipped && result.email.skipped;
        const anyFailed = !result.telegram.success && !result.telegram.skipped && !result.email.success && !result.email.skipped;
        const partialFailed = (result.telegram.success && !result.email.success && !result.email.skipped) ||
                              (result.email.success && !result.telegram.success && !result.telegram.skipped);

        let httpStatus = 200;
        if (allSkipped) httpStatus = 202;
        else if (anyFailed) httpStatus = 500;
        else if (partialFailed) httpStatus = 207;

        res.status(httpStatus).json({
            success: result.overallStatus !== 'FAILED' && result.overallStatus !== 'SKIPPED',
            submissionId: result.submissionId,
            overallStatus: result.overallStatus,
            notifications: {
                telegram: {
                    sent: result.telegram.success,
                    skipped: result.telegram.skipped,
                    error: result.telegram.error,
                },
                email: {
                    sent: result.email.success,
                    skipped: result.email.skipped,
                    error: result.email.error,
                },
            },
            message: buildResponseMessage(result.overallStatus),
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('Unhandled error in submit endpoint', {
            error: error.message,
            stack: error.stack,
            client_ip: req.ip,
        });
        res.status(500).json({
            success: false,
            error: 'Internal server error occurred while processing submission',
            errorCode: 'SERVER_ERROR',
            timestamp: new Date().toISOString(),
        });
    }
});

router.post('/retry-failed', async (req, res) => {
    try {
        const result = await notificationService.retryFailedSubmissions();
        res.status(200).json({
            success: true,
            message: `Retry process completed: ${result.processed} submissions processed, ${result.succeeded} succeeded`,
            ...result,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('Manual retry failed', { error: error.message, stack: error.stack });
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});

module.exports = router;
