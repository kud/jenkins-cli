import chalk from 'chalk';
import hljs from 'highlight.js';
const DISABLE_UNICODE_ICONS = process.env.JENKINS_CLI_NO_ICONS === '1' || process.env.JENKINS_CLI_PLAIN === '1' || process.env.TERM_PROGRAM === 'vscode' || process.env.CI || process.env.TERM === 'dumb';
const emojiRegex = /✅|❌|⚠️|✂️|⏰|💥|📄|🏷️|💻|🐳|🔧|🔀|🔄|📥|📁|🔨|🔍|⏭️|📌|✨|🔥|💀|🐛|🔗|⋯/g;
const ICON_FALLBACK = { '✅': '[OK]', '❌': '[X]', '⚠️': '[!]', '✂️': '[CUT]', '⏰': '[T]', '💥': '[ERR]', '📄': '[F]', '🏷️': '[TAG]', '💻': '[CMD]', '🐳': '[DOCKER]', '🔧': '[GIT]', '🔀': '[MERGE]', '🔄': '[...]', '📥': '[DL]', '📁': '[DIR]', '🔨': '[BUILD]', '🔍': '[SRCH]', '⏭️': '[SKIP]', '📌': '[*]', '✨': '*', '🔥': '[ERR]', '💀': '[FATAL]', '🐛': '[DBG]', '🔗': '[URL]', '⋯': '...' };
const statusColor = (result) => {
    switch (result) {
        case 'SUCCESS': return chalk.green(result + ' ✅');
        case 'FAILURE': return chalk.red(result + ' ❌');
        case 'ABORTED': return chalk.gray(result + ' ✂');
        case 'UNSTABLE': return chalk.yellow(result + ' ⚠');
        default: return chalk.cyan(result || 'RUNNING');
    }
};
export function formatStatus(build, { pretty = false } = {}) {
    const { number, result, building, duration, estimatedDuration, timestamp } = build;
    if (pretty) {
        const state = building ? chalk.blue('RUNNING') : result ? statusColor(result) : chalk.blue('RUNNING');
        const dur = building ? `~${Math.round(duration / 1000)}s` : `${Math.round(duration / 1000)}s`;
        return `Build #${number}: ${state} (${dur})`;
    }
    return `#${number} ${building ? 'RUNNING' : (result || 'UNKNOWN')} duration=${duration}`;
}
export function formatBuildList(builds, { pretty = false } = {}) {
    return builds.map(b => formatStatus(b, { pretty })).join('\n');
}
export function formatError(err) {
    if (err && (err.status === 401 || err.status === 403)) {
        console.error('Auth error (check user/token permissions)');
    }
    // Friendly guidance for 404s (e.g. user passed only a build number without job)
    if (err && err.status === 404) {
        console.error('Not found (404).');
        console.error('Likely causes:');
        console.error('  - Wrong job name');
        console.error('  - You supplied only a build number but omitted the job');
        console.error('  - Build number does not exist for that job');
        console.error('\nUsage examples:');
        console.error('  jenkins console my-job 123');
        console.error('  jenkins status my-job');
        console.error('  jenkins logs my-job -f');
        console.error('\nTip: format is <job> [buildNumber] or full job/build URL.');
        return;
    }
    // Suppress noisy HTML bodies
    const msg = (err && err.message) ? err.message : String(err);
    if (/<!DOCTYPE html>/i.test(msg)) {
        console.error(msg.split(/</)[0].trim() || 'Error (HTML body suppressed)');
    }
    else {
        console.error(msg);
    }
}
// Convert highlight.js tokens to chalk formatting
const hljs2chalk = (tokens) => {
    return tokens.map(token => {
        if (typeof token === 'string')
            return token;
        const className = token.className || '';
        let text = token.value;
        // Map highlight.js classes to chalk colors
        switch (className) {
            case 'keyword': return chalk.blue.bold(text);
            case 'built_in': return chalk.cyan(text);
            case 'string': return chalk.green(text);
            case 'number': return chalk.yellow(text);
            case 'comment': return chalk.gray.dim(text);
            case 'regexp': return chalk.magenta(text);
            case 'symbol': return chalk.yellow(text);
            case 'class': return chalk.blue(text);
            case 'function': return chalk.cyan.bold(text);
            case 'variable': return chalk.white(text);
            case 'constant': return chalk.yellow.bold(text);
            case 'operator': return chalk.gray(text);
            case 'punctuation': return chalk.dim(text);
            case 'tag': return chalk.blue(text);
            case 'attr': return chalk.cyan(text);
            case 'attribute': return chalk.cyan(text);
            case 'title': return chalk.blue.bold(text);
            case 'meta': return chalk.gray(text);
            case 'section': return chalk.magenta.bold(text);
            case 'name': return chalk.blue(text);
            case 'literal': return chalk.green(text);
            case 'subst': return chalk.white(text);
            default: return text;
        }
    }).join('');
};
// Detect code blocks and apply appropriate syntax highlighting
const detectAndHighlightCode = (line) => {
    // Detect common programming languages and formats
    const codePatterns = [
        // JSON
        { pattern: /^\s*[{[].*[}\]]\s*$/, lang: 'json' },
        // XML/HTML
        { pattern: /^\s*<[^>]+>.*<\/[^>]+>\s*$/, lang: 'xml' },
        // Shell/Bash commands
        { pattern: /^\s*[\$#]\s*\w+/, lang: 'bash' },
        // Python
        { pattern: /^\s*(def|class|import|from|if __name__)/i, lang: 'python' },
        // JavaScript
        { pattern: /^\s*(function|const|let|var|=>|console\.log)/i, lang: 'javascript' },
        // Java
        { pattern: /^\s*(public|private|protected|class|import|package)/i, lang: 'java' },
        // SQL
        { pattern: /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)/i, lang: 'sql' },
        // Dockerfile
        { pattern: /^\s*(FROM|RUN|COPY|ADD|EXPOSE|CMD|ENTRYPOINT)/i, lang: 'dockerfile' },
        // YAML
        { pattern: /^\s*[\w-]+:\s*.+/, lang: 'yaml' },
        // Properties
        { pattern: /^\s*[\w.-]+\s*=\s*.+/, lang: 'properties' }
    ];
    for (const { pattern, lang } of codePatterns) {
        if (pattern.test(line)) {
            try {
                const result = hljs.highlight(line, { language: lang, ignoreIllegals: true });
                if (result.relevance > 5) { // Only use if confidence is high
                    return hljs2chalk([{ value: result.value, className: 'highlighted' }]);
                }
            }
            catch (e) {
                // Fall through to manual highlighting if hljs fails
            }
            break;
        }
    }
    return null; // Let manual highlighting handle it
};
import { sanitizeLogChunk } from './log-sanitizer.js';
export function formatLogsChunk(chunk) {
    const sanitized = sanitizeLogChunk(chunk, { stripAnsi: false });
    let text = sanitized;
    if (DISABLE_UNICODE_ICONS) {
        text = text.replace(emojiRegex, m => ICON_FALLBACK[m] || '');
    }
    // Enhanced colouring & comprehensive syntax highlighting with highlight.js
    return text.split(/\n/).map(rawLine => {
        if (!rawLine)
            return rawLine;
        // Jenkins-specific build status messages (highest priority)
        const plainLine = sanitizeLogChunk(rawLine, { stripAnsi: true });
        if (/BUILD (SUCCESS|SUCCESSFUL)/i.test(plainLine))
            return chalk.bold.green('✅ ' + plainLine);
        if (/BUILD (FAIL|FAILURE|FAILED)/i.test(plainLine))
            return chalk.bold.red('❌ ' + plainLine);
        if (/UNSTABLE/i.test(plainLine))
            return chalk.bold.yellow('⚠️  ' + plainLine);
        if (/ABORTED/i.test(plainLine))
            return chalk.bold.gray('✂️  ' + plainLine);
        // Maven/Gradle build phases
        if (/\[INFO\].*--- .* ---/.test(plainLine))
            return chalk.bold.cyan(plainLine);
        if (/\[INFO\] BUILD SUCCESS/.test(plainLine))
            return chalk.bold.green('🎉 ' + plainLine);
        if (/\[ERROR\] BUILD FAILURE/.test(plainLine))
            return chalk.bold.red('💥 ' + plainLine);
        // Test results with enhanced formatting
        if (/Tests run:.*Failures:.*Errors:/.test(plainLine)) {
            return plainLine.replace(/Tests run: (\d+)/, (_m, n) => `Tests run: ${chalk.cyan.bold(n)}`)
                .replace(/Failures: (\d+)/, (_m, n) => n === '0' ? `Failures: ${chalk.green.bold(n)}` : `Failures: ${chalk.red.bold(n)}`)
                .replace(/Errors: (\d+)/, (_m, n) => n === '0' ? `Errors: ${chalk.green.bold(n)}` : `Errors: ${chalk.red.bold(n)}`)
                .replace(/Skipped: (\d+)/, (_m, n) => n === '0' ? `Skipped: ${chalk.gray(n)}` : `Skipped: ${chalk.yellow(n)}`);
        }
        // Try intelligent syntax highlighting first
        const codeHighlighted = detectAndHighlightCode(plainLine);
        if (codeHighlighted) {
            if (/^\s*[{[]/.test(plainLine))
                return '📄 ' + codeHighlighted;
            if (/^\s*</.test(plainLine))
                return '🏷️  ' + codeHighlighted;
            if (/^\s*[\$#]/.test(plainLine))
                return '💻 ' + codeHighlighted;
            return codeHighlighted;
        }
        // Docker commands with enhanced detection
        if (/^\s*[\+>]*\s*docker/.test(plainLine))
            return chalk.blue('🐳 ' + plainLine);
        if (/Successfully built|Successfully tagged|Image.*built/i.test(plainLine))
            return chalk.green('✅ ' + plainLine);
        if (/Pulling|Downloading|Extracting/i.test(plainLine))
            return chalk.cyan('📥 ' + plainLine);
        // Git operations
        if (/^\s*[\+>]*\s*git/.test(plainLine))
            return chalk.magenta('🔧 ' + plainLine);
        if (/Cloning into|Clone completed/i.test(plainLine))
            return chalk.cyan('📥 ' + plainLine);
        if (/Switched to|Checkout|merge/i.test(plainLine))
            return chalk.blue('🔀 ' + plainLine);
        // CI/CD pipeline stages
        if (/Stage|Pipeline|Step/i.test(plainLine) && /started|completed|running/i.test(plainLine)) {
            if (/completed|finished|done/i.test(plainLine))
                return chalk.green('✅ ' + plainLine);
            if (/started|running|executing/i.test(plainLine))
                return chalk.yellow('🔄 ' + plainLine);
            if (/failed|error/i.test(plainLine))
                return chalk.red('❌ ' + plainLine);
        }
        // File system operations
        if (/^\s*[\+>]*\s*(mkdir|rm|cp|mv|chmod|chown)/.test(plainLine))
            return chalk.gray('📁 ' + plainLine);
        // Compilation and build tools
        if (/^\s*[\+>]*\s*(npm|yarn|pip|mvn|gradle|make|cargo|go build)/.test(plainLine))
            return chalk.blue('🔨 ' + plainLine);
        // Diff style (enhanced)
        if (/^@@ .* @@/.test(plainLine))
            return chalk.magenta.bold(plainLine);
        if (/^[+][^+]/.test(plainLine))
            return chalk.green('+ ' + plainLine.slice(1));
        if (/^-[^-]/.test(plainLine))
            return chalk.red('- ' + plainLine.slice(1));
        let line = plainLine;
        // Enhanced timestamps (multiple formats) with better detection
        line = line.replace(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/, m => chalk.dim.gray(`⏰ ${m}`));
        line = line.replace(/^(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/, m => chalk.dim.gray(`⏰ ${m}`));
        line = line.replace(/\[(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})\]/, m => chalk.dim.gray(`⏰ ${m}`));
        // Enhanced log levels with better regex and icons
        const lvl = line.match(/^\s*(?:\[?\s*)?(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\s*(?:\]?\s*[:\-]?\s*)/i);
        if (lvl) {
            const level = lvl[1].toUpperCase();
            const levelFormatted = {
                ERROR: chalk.bold.red('🔥 ERROR'),
                FATAL: chalk.bold.bgRed.white('💀 FATAL'),
                WARN: chalk.bold.yellow('⚠️  WARN'),
                WARNING: chalk.bold.yellow('⚠️  WARNING'),
                INFO: chalk.bold.blue('ℹ️  INFO'),
                DEBUG: chalk.gray('🐛 DEBUG'),
                TRACE: chalk.dim.gray('🔍 TRACE')
            }[level] || chalk.cyan(level);
            line = line.replace(lvl[0], levelFormatted + ' ');
        }
        // Enhanced exceptions and stack traces with better detection
        if (/Exception|Error:|Traceback|Caused by/i.test(line) && !/INFO|DEBUG/i.test(line)) {
            return chalk.bold.red('💥 ' + line);
        }
        if (/^\s*at\s+[\w.$]+\(/.test(line))
            return chalk.dim.red('  ↳ ' + line.trim());
        if (/^\s*\.{3}\s*\d+\s+more/i.test(line))
            return chalk.dim.red('  ⋯ ' + line.trim());
        // Enhanced JSON formatting with better detection
        if (/^\s*[{[]/.test(line) && /[}\]]\s*$/.test(line)) {
            try {
                const parsed = JSON.parse(line.trim());
                const highlighted = hljs.highlight(JSON.stringify(parsed, null, 2), { language: 'json' }).value;
                return '📄 ' + hljs2chalk([{ value: highlighted }]);
            }
            catch {
                // Fallback to manual JSON highlighting
                line = line
                    .replace(/"([^"]+)"\s*:/g, (_m, k) => chalk.cyan.bold(`"${k}"`) + ':')
                    .replace(/:\s*"([^"]*)"/g, (_m, v) => ': ' + chalk.green(`"${v}"`))
                    .replace(/:\s*(\d+(?:\.\d+)?)/g, (_m, v) => ': ' + chalk.yellow(v))
                    .replace(/:\s*(true|false|null)/g, (_m, v) => ': ' + chalk.magenta.bold(v))
                    .replace(/[{}]/g, m => chalk.white.bold(m))
                    .replace(/[\[\]]/g, m => chalk.blue.bold(m));
                return '📄 ' + line;
            }
        }
        // URL detection with better formatting
        line = line.replace(/(https?:\/\/[^\s,]+)/g, m => chalk.underline.blue('🔗 ' + m));
        // File paths with better detection
        line = line.replace(/([/~][\w/-]*\.[a-zA-Z0-9]{1,4})(?=[\s,]|$)/g, m => chalk.cyan('📄 ' + m));
        line = line.replace(/([A-Za-z]:\\[\w\\-]*\.[a-zA-Z0-9]{1,4})(?=[\s,]|$)/g, m => chalk.cyan('📄 ' + m));
        // Enhanced numbers in context
        line = line.replace(/\b(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?)\s*(?:MB|GB|KB|bytes?|ms|seconds?|minutes?|hours?)\b/gi, m => chalk.yellow.bold(m));
        line = line.replace(/\b(\d+(?:\.\d+)?)\s*%/g, m => chalk.cyan.bold(m));
        // Status indicators with better detection
        line = line.replace(/\b(PASS|PASSED|SUCCESS|SUCCESSFUL|OK|DONE|COMPLETE)\b/gi, m => chalk.green.bold('✅ ' + m));
        line = line.replace(/\b(FAIL|FAILED|FAILURE|ERROR)\b/gi, m => chalk.red.bold('❌ ' + m));
        line = line.replace(/\b(SKIP|SKIPPED|IGNORED|PENDING)\b/gi, m => chalk.yellow.bold('⏭️  ' + m));
        line = line.replace(/\b(WARN|WARNING|CAUTION)\b/gi, m => chalk.yellow.bold('⚠️  ' + m));
        // Progress indicators and ratios
        line = line.replace(/(\d+)\/(\d+)(?:\s*\((\d+)%\))?/g, (_m, current, total, percent) => {
            const pct = percent || (parseInt(current) / parseInt(total) * 100).toFixed(0);
            return chalk.cyan(`${current}`) + '/' + chalk.cyan(`${total}`) + chalk.gray(` (${pct}%)`);
        });
        // Generic keyword highlighting (fallback with lower priority)
        if (/ERROR|FAILURE/i.test(line) && !line.includes('🔥') && !line.includes('💥')) {
            return chalk.red(line);
        }
        if (/WARN|WARNING/i.test(line) && !line.includes('⚠️')) {
            return chalk.yellow(line);
        }
        if (/\bINFO\b/i.test(line) && !line.includes('ℹ️')) {
            return chalk.dim(line);
        }
        // Strip any remaining ANSI codes (both proper escape sequences and bare bracket codes)
        line = line.replace(/\x1b\[[0-9;]*m/g, ''); // Real ANSI codes
        line = line.replace(/\[([0-9]{1,3}(;[0-9]{1,3})*)?m/g, ''); // Bare bracket codes from Jenkins
        return line;
    }).join('\n');
}
