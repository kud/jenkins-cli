import { sanitizeLogChunk } from './log-sanitizer.js';
const raw = "Line one with color \x1b[31mRED\x1b[0m\nCarriage return spinner test|-\rCarriage return spinner test|/\rFinal line after spinner\nESC leftover:\x1b[0m End\n";
console.log('RAW BYTES HEX:');
console.log(Buffer.from(raw, 'utf8').toString('hex').match(/.{1,32}/g)?.join('\n'));
console.log('\nOriginal Output (may show ? characters):');
process.stdout.write(raw + '\n');
const sanitized = sanitizeLogChunk(raw);
console.log('\nSanitized Output:');
console.log(sanitized);
