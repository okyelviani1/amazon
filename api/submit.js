require('dotenv').config();
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

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

module.exports = async function handler(req, res) {
    // Add CORS headers just in case
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    try {
        let rawData = req.body;
        
        // Vercel parses JSON automatically. If it's a string, try parsing it (fallback)
        if (typeof rawData === 'string') {
            try { rawData = JSON.parse(rawData); } catch(e) {}
        }

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

        const result = await notificationService.processSubmission(req, rawData);

        const allSkipped = result.telegram.skipped && result.email.skipped;
        const anyFailed = !result.telegram.success && !result.telegram.skipped && !result.email.success && !result.email.skipped;
        const partialFailed = (result.telegram.success && !result.email.success && !result.email.skipped) ||
                              (result.email.success && !result.telegram.success && !result.telegram.skipped);

        let httpStatus = 200;
        if (allSkipped) httpStatus = 202;
        else if (anyFailed) httpStatus = 500;
        else if (partialFailed) httpStatus = 207;

        return res.status(httpStatus).json({
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
            client_ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
        });
        return res.status(500).json({
            success: false,
            error: 'Internal server error occurred while processing submission',
            errorCode: 'SERVER_ERROR',
            timestamp: new Date().toISOString(),
        });
    }
};
