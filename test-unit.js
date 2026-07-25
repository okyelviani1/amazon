require('dotenv').config();
const { sanitizeData, maskString, maskCreditCard, generateSubmissionId, isSensitiveField } = require('./utils/security');
const logger = require('./utils/logger');

let passed = 0;
let failed = 0;

function assert(label, condition, info) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.log(`  ❌ ${label}  ${info ? ' | ' + info : ''}`);
        failed++;
    }
}

console.log('\n🧪 UNIT TEST: Security & Data Masking Utilities\n');

console.log('--- 1. isSensitiveField() ---');
assert('password = sensitive', isSensitiveField('password'));
assert('PASSWORD = sensitive (case-insensitive)', isSensitiveField('PASSWORD'));
assert('User_Pass = sensitive', isSensitiveField('User_Pass'));
assert('credit_card = sensitive', isSensitiveField('credit_card'));
assert('card_number = sensitive', isSensitiveField('card_number'));
assert('cvv = sensitive', isSensitiveField('cvv'));
assert('api_key = sensitive', isSensitiveField('api_key'));
assert('nama = NOT sensitive', !isSensitiveField('nama'));
assert('email = NOT sensitive', !isSensitiveField('email'));
assert('kota = NOT sensitive', !isSensitiveField('kota'));

console.log('\n--- 2. maskString() ---');
assert('empty string handled', maskString('') === '');
assert('short (2 chars): "ab" -> "**"', maskString('ab') === '**');
assert('4 chars: "abcd" -> "a***"', maskString('abcd') === 'a***');
{
    const r = maskString('Rahasia1');
    assert('8 chars: "Rahasia1" -> first+mask+last',
        r.startsWith('R') && r.endsWith('1') && r.includes('*') && r.length === 8,
        `got: ${r}`);
}
{
    const input = 'RahasiaBanget123';
    const r = maskString(input);
    assert('16 chars password: first 4 + mask + last 2',
        r.startsWith(input.slice(0, 4)) && r.endsWith(input.slice(-2)) && r.includes('*'),
        `got: ${r}`);
}

console.log('\n--- 3. maskCreditCard() ---');
assert('Visa 16 digit: 4111111111111111 -> ****-****-****-1111',
    maskCreditCard('4111111111111111') === '****-****-****-1111');
assert('Mastercard 16 digit: 5500000000000004 -> ****-****-****-0004',
    maskCreditCard('5500000000000004') === '****-****-****-0004');
assert('Card with dashes: 4111-1111-1111-1111 works',
    maskCreditCard('4111-1111-1111-1111') === '****-****-****-1111');

console.log('\n--- 4. generateSubmissionId() ---');
const id1 = generateSubmissionId();
const id2 = generateSubmissionId();
assert('Format prefix SUB-', id1.startsWith('SUB-'));
assert('Format unique (no collision)', id1 !== id2);
assert('Pattern sub-[alnum]-[alnum]', /^SUB-[A-Z0-9]+-[A-Z0-9]+$/.test(id1));

console.log('\n--- 5. sanitizeData() end-to-end ---');
const original = {
    nama: 'Budi Santoso',
    email: 'budi@example.com',
    password: 'RahasiaSuper123',
    credit_card: '4111111111111111',
    cvv: '321',
    password_confirmation: 'RahasiaSuper123',
    alamat: {
        jalan: 'Jl. Sudirman',
        rt_rw: '001/002',
    },
    kartu_kredit: '5500000000000004',
};
const s = sanitizeData(original, true);

assert('Nama tetap utuh', s.nama === original.nama);
assert('Email tetap utuh', s.email === original.email);
assert('Password di-masking (tidak bocor)', s.password !== original.password && s.password.includes('*'));
assert('credit_card: masking kartu kredit pattern', /^\*\*\*\*-\*\*\*\*-\*\*\*\*-\d{4}$/.test(s.credit_card));
assert('CVV 3 digit: di-mask penuh/bintang', s.cvv !== original.cvv);
assert('password_confirmation juga terdeteksi sensitif', s.password_confirmation !== original.password_confirmation);
assert('Nested object alamat.jalan tetap utuh', s.alamat?.jalan === original.alamat.jalan);
assert('kartu_kredit juga terdeteksi kartu', /^\*\*\*\*-\*\*\*\*-\*\*\*\*-\d{4}$/.test(s.kartu_kredit));
assert('Raw asli TIDAK DIUBAH', original.password === 'RahasiaSuper123');

console.log('\n--- 6. Logger initialization ---');
assert('Logger instance exists', !!logger);
assert('Logger has levels', logger.levels && logger.levels.error === 0);
logger.info('Logger test message from unit test (ignore me)');

console.log('\n--- 7. Config load ---');
const config = require('./config/config');
assert('Server port is number', typeof config.server.port === 'number');
assert('Paths defined', !!config.paths.dbFile && !!config.paths.logsDir);

console.log(`\n🏁 Unit Test Result: ${passed} LULUS, ${failed} GAGAL`);
if (failed === 0) {
    console.log('🎉 SEMUA UNIT TEST LULUS!\n');
    process.exit(0);
} else {
    console.log('❌ Ada yang gagal, periksa output di atas.\n');
    process.exit(1);
}
