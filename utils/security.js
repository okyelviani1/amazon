const SENSITIVE_FIELDS = [
    'password',
    'pass',
    'pwd',
    'secret',
    'token',
    'api_key',
    'apikey',
    'credit_card',
    'creditcard',
    'card_number',
    'cardnumber',
    'cc_number',
    'ccv',
    'cvv',
    'expiry',
    'expiration',
    'ssn',
    'nip',
    'nik',
    'ktp',
];

function isSensitiveField(fieldName) {
    if (!fieldName) return false;
    const lower = String(fieldName).toLowerCase();
    return SENSITIVE_FIELDS.some(sensitive =>
        lower.includes(sensitive) || sensitive.includes(lower)
    );
}

function maskString(value) {
    if (!value || typeof value !== 'string') return value;
    const len = value.length;
    if (len <= 2) return '*'.repeat(len);
    if (len <= 4) return value[0] + '*'.repeat(len - 1);
    if (len <= 8) return value[0] + '*'.repeat(len - 2) + value[len - 1];
    const visibleStart = 4;
    const visibleEnd = 2;
    return value.slice(0, visibleStart) + '*'.repeat(len - visibleStart - visibleEnd) + value.slice(-visibleEnd);
}

function maskCreditCard(cardNumber) {
    if (!cardNumber || typeof cardNumber !== 'string') return cardNumber;
    const digits = cardNumber.replace(/\D/g, '');
    if (digits.length < 13) return maskString(cardNumber);
    const last4 = digits.slice(-4);
    return `****-****-****-${last4}`;
}

function isCreditCardValue(key, value) {
    if (typeof value !== 'string') return false;
    const keyLower = String(key).toLowerCase();
    const creditCardKeys = ['credit_card', 'creditcard', 'card_number', 'cardnumber', 'cc_number', 'cc'];
    if (creditCardKeys.some(cck => keyLower.includes(cck))) return true;
    const digits = value.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && /^\d+$/.test(digits);
}

function sanitizeData(data, maskSensitive = true) {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
        return data.map(item => sanitizeData(item, maskSensitive));
    }
    if (typeof data === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            if (maskSensitive && isSensitiveField(key)) {
                if (isCreditCardValue(key, value)) {
                    sanitized[key] = maskCreditCard(value);
                } else {
                    sanitized[key] = maskString(String(value));
                }
            } else if (maskSensitive && typeof value === 'string' && isCreditCardValue(key, value)) {
                sanitized[key] = maskCreditCard(value);
            } else {
                sanitized[key] = sanitizeData(value, maskSensitive);
            }
        }
        return sanitized;
    }
    return data;
}

function getClientIp(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
}

function generateSubmissionId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `SUB-${timestamp}-${random}`;
}

module.exports = {
    isSensitiveField,
    maskString,
    maskCreditCard,
    sanitizeData,
    getClientIp,
    getUserAgent,
    generateSubmissionId,
    SENSITIVE_FIELDS,
};
