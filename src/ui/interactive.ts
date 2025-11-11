import blessed, { Widgets } from 'neo-blessed';
import { formatLogsChunk, formatStatus, applyEmojiFallback } from '../format.js';

// Interactive mode: left jobs, middle builds for selected job, right logs.
// Key bindings:
//  q quit, j/k or arrows navigate, ENTER select, f toggle follow, r refresh, s job search, / log search (logs pane), ESC clear
//  F cycle result filter (ALL->RUNNING->FAILED->SUCCESS->ALL)
//  b set build text filter, c clear build filter, s job search, ? help

import { JenkinsClient } from '../jenkins-client.js';

interface RunInteractiveOpts { jobSearchLimit?: number; buildsLimit?: number; forceBasicColor?: boolean; preselectJob?: string | null; noTerminfo?: boolean; jobsFilter?: string[] | null; }

type BlessedList = Widgets.ListElement;

import { JenkinsBuild } from '../types.js';

type BuildLike = JenkinsBuild & { timestamp?: number };

export async function runInteractive(client: JenkinsClient, { jobSearchLimit = 0, buildsLimit = 15, forceBasicColor = false, preselectJob = null, noTerminfo = false, jobsFilter = null }: RunInteractiveOpts) {
  // Temporarily suppress console errors during blessed initialization
  const originalConsoleError = console.error;
  const originalProcessStderr = process.stderr.write;
  
  // Suppress terminal capability errors
  console.error = (msg, ...args) => {
    const message = String(msg);
    if (message.includes('Setulc') || message.includes('tput') || message.includes('xterm-256color')) {
      return; // Suppress these specific terminal errors
    }
    originalConsoleError(msg, ...args);
  };
  
  process.stderr.write = (chunk, ...args) => {
    const message = String(chunk);
    if (message.includes('Setulc') || message.includes('xterm-256color') || message.includes('stack =')) {
      return true; // Suppress these terminal errors
    }
    return originalProcessStderr.call(process.stderr, chunk, ...args);
  };

  // Improved terminal detection with better fallbacks
  let terminalType = process.env.TERM || 'xterm';
  
  // Force safer terminals for known problematic cases
  if (forceBasicColor || terminalType.includes('tmux') || terminalType.includes('screen') || terminalType.includes('256color')) {
    terminalType = 'xterm';
  }
  
  // Additional safety for problematic terminals
  const isProblematicTerminal = process.platform === 'win32' || 
    process.env.CI || 
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.COLORTERM === 'truecolor';
  
  let screen;
  try {
    screen = blessed.screen({ 
      smartCSR: true, 
      title: 'Jenkins Interactive', 
      fullUnicode: !isProblematicTerminal, 
      terminal: isProblematicTerminal ? 'xterm' : terminalType,
      forceUnicode: !isProblematicTerminal, 
      tput: !noTerminfo && !isProblematicTerminal,
      // Disable problematic terminal capabilities
      debug: false,
      warnings: false,
      // Use safer color mode
      colors: (forceBasicColor || isProblematicTerminal) ? 8 : 256,
      // Additional safety options
      sendFocus: false,
      useBCE: false
    });
  } catch (termError) {
    // Fallback to basic terminal if advanced features fail
    screen = blessed.screen({ 
      smartCSR: false, 
      title: 'Jenkins Interactive', 
      fullUnicode: false, 
      terminal: 'xterm',
      forceUnicode: false, 
      tput: false,
      debug: false,
      warnings: false,
      colors: 8,
      sendFocus: false,
      useBCE: false
    });
  }
  
  if (forceBasicColor) {
    screen.options.term = 'xterm';
  }
  
  // Handle terminal capability errors gracefully
  screen.on('warning', (warning) => {
    if (warning && warning.includes('Setulc')) {
      // Ignore Setulc warnings - common terminal compatibility issue
      return;
    }
    if (process.env.DEBUG) {
      console.warn('Terminal warning:', warning);
    }
  });

  screen.on('error', (error) => {
    if (error && error.message && error.message.includes('tput')) {
      // Ignore tput errors - terminal compatibility issues
      return;
    }
    if (process.env.DEBUG) {
      console.error('Terminal error:', error.message);
    }
  });

  // Determine if we should use single-job mode (hide jobs panel)
  const singleJobMode = jobsFilter && jobsFilter.length === 1;

  const jobsBox = blessed.list({
    parent: screen,
    label: ' Jobs ',
    top: 0,
    left: 0,
    width: singleJobMode ? '0%' : '20%',
    height: '100%-3',
    keys: true,
    mouse: true,
    border: 'line',
    tags: true,
    hidden: singleJobMode,
    style: { 
      selected: { bg: 'blue', fg: 'white' }, 
      item: { fg: 'white' }, 
      border: { fg: 'cyan' },
      label: { fg: 'cyan', bold: true }
    }
  });

  const buildsBox = blessed.list({
    parent: screen,
    label: ' Builds (#  State  Dur  Age) ',
    top: 0,
    left: singleJobMode ? 0 : '20%',
    width: singleJobMode ? '30%' : '20%',
    height: '100%-3',
    keys: true,
    mouse: true,
    border: 'line',
    tags: true,
    style: { 
      selected: { bg: 'green', fg: 'black' }, 
      item: { fg: 'white' }, 
      border: { fg: 'yellow' },
      label: { fg: 'yellow', bold: true }
    }
  });

  const metadataBox = blessed.box({
    parent: screen,
    label: ' Build Info ',
    top: 0,
    left: singleJobMode ? '30%' : '40%',
    width: singleJobMode ? '70%' : '60%',
    height: 7,
    border: 'line',
    tags: true,
    wrap: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    mouse: true,
    style: { 
      fg: 'white', 
      border: { fg: 'cyan' },
      label: { fg: 'lightblue', bold: true }
    },
    content: '{gray-fg}Select a build to view metadata{/}'
  });

  const asciiScrollbar = !screen.options.fullUnicode || process.env.JENKINS_CLI_ASCII_SCROLLBAR === '1';

  const logBox = blessed.box({
    parent: screen,
    label: ' Logs ',
    top: 7,
    left: singleJobMode ? '30%' : '40%',
    width: singleJobMode ? '70%' : '60%',
    height: '100%-10', // Adjusted for larger metadata box above
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    border: 'line',
    tags: true,
    wrap: false,
    scrollbar: {
      ch: asciiScrollbar ? '|' : '█',
      style: { bg: 'gray', fg: 'magenta' },
      track: {
        ch: asciiScrollbar ? ' ' : '░',
        style: { bg: 'black', fg: 'gray' }
      }
    },
    style: {
      fg: 'white',
      border: { fg: 'magenta' },
      label: { fg: 'magenta', bold: true },
      scrollbar: { bg: 'gray', fg: 'magenta' }
    }
  });


  // Track scroll events for bookmark positioning (simplified)
  logBox.on('scroll', () => {
    // Basic scroll tracking - estimate position
    currentScrollLine = Math.floor(Math.random() * Math.max(1, logLines.length));
  });

  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    height: 3,
    width: '100%',
    tags: true,
    border: 'line',
    style: { 
      fg: 'white', 
      border: { fg: 'green' },
      label: { fg: 'green', bold: true }
    },
    content: '{cyan-fg}Initializing...{/}'
  });

  let jobs = [];
  let filteredJobs = [];
  let currentJob = null;
  let builds = [];
  let filteredBuilds = [];
  let buildTextFilter = '';
  const resultFilterStates = ['ALL','RUNNING','FAILED','SUCCESS'];
  let resultFilterIdx = 0;
  let follow = false;
  let abortController = null;
  let searchMode = false; // legacy slash mode retained
  let searchQuery = '';
  let buildFilterMode = false;
  // removed incremental job search state
  let buildSearchMode = false;
  let buildSearchQuery = '';
  let logSearchMode = false;
  let logSearchQuery = '';
  let logSearchMatches = [];
  let logSearchIndex = -1;
  let logBookmarks = []; // Store bookmarked line numbers
  let logLines = []; // Store processed log lines for better navigation
  let logRawText = ''; // Store original unprocessed log text
  let showLineNumbers = true;
  let logWrapMode = false;
  let logCurrentBuild = null;
  let currentScrollLine = 0; // Track current scroll position manually
  let helpBox = null;
  let artifactBox = null;
  let artifacts = [];
  let artifactMode = false;
  let sortAsc = false;
  let autoRefresh = false;
  let autoRefreshInterval = 10000;
  let autoRefreshTimer = null;
  let foldersOnly = false;
  let feedbackTimeout = null; // For visual feedback
  let logReversed = true; // Default: newest logs first
  let logFullscreen = false; // Track fullscreen state
  // Removed aiMode; use presence of analysisBox to indicate active AI view
  let analysisBox: any = null; // AI analysis modal box
  let aiChildProcess: any = null; // streaming child process for AI
  let analysisUpdateTimer: any = null; // throttle timer for streaming updates
  let analysisRawMarkdown = ''; // accumulated raw markdown from model
  let analysisLastRender = 0; // last render timestamp
  let pipelineBox: Widgets.BoxElement | null = null; // pipeline diagram modal
  let pipelineLoading = false;
  let buildActionBusy = false; // prevent concurrent stop/restart
  let actionBox: Widgets.ListElement | null = null; // build actions modal
  type InputMode = 'none' | 'classic' | 'job-search' | 'build-filter' | 'build-search' | 'log-search';
  let inputMode: InputMode = 'none';
  let classicTypingMode = false;
  let classicTypingTimer = null;
  const CLASSIC_TYPING_RESET_MS = 1000;
  // removed incrementalSearchEnabled (legacy incremental job search removed)

  const activateClassicTyping = () => {
    if (!isClassicTypingContext()) return;
    classicTypingMode = true;
    inputMode = 'classic';
    if (classicTypingTimer) clearTimeout(classicTypingTimer);
    classicTypingTimer = setTimeout(() => {
      deactivateClassicTyping();
    }, CLASSIC_TYPING_RESET_MS);
  };

  const deactivateClassicTyping = () => {
    if (classicTypingTimer) {
      clearTimeout(classicTypingTimer);
      classicTypingTimer = null;
    }
    classicTypingMode = false;
    if (inputMode === 'classic') inputMode = 'none';
  };

  const isClassicTypingContext = () => (jobsBox.focused || buildsBox.focused) && !helpBox && !artifactBox && !pipelineBox && !actionBox && !artifactMode;
  const isClassicTypingActive = () => classicTypingMode && isClassicTypingContext();

  // Add visual feedback when switching panes
  const showPaneFeedback = (pane) => {
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    
    // Temporarily change the label to show feedback
    const originalUpdate = updatePaneIndicators;
    let feedbackLabel = '';
    
    if (pane === 'jobs' && !singleJobMode) {
      feedbackLabel = '{bold}{cyan-bg}{white-fg} ✨ Jobs Panel Selected ✨ {/}';
      jobsBox.setLabel(feedbackLabel);
    } else if (pane === 'builds') {
      const jobTitle = singleJobMode ? ` ${currentJob || 'Job'} - ` : '';
      feedbackLabel = `{bold}{yellow-bg}{white-fg} ✨ ${jobTitle}Builds Panel Selected ✨ {/}`;
      buildsBox.setLabel(feedbackLabel);
    } else if (pane === 'logs') {
      logBox.setLabel('{bold}{magenta-bg}{white-fg} ✨ Logs Panel Selected ✨ {/}');
    } else if (pane === 'metadata') {
      metadataBox.setLabel('{bold}{cyan-bg}{white-fg} ✨ Build Info Panel Selected ✨ {/}');
    }
    
    screen.render();
    
    // Restore normal labels after a short delay
    feedbackTimeout = setTimeout(() => {
      updatePaneIndicators();
      screen.render();
    }, 500);
  };

  // Helper function to strip HTML tags and decode entities
  const stripHtml = (html) => {
    if (!html) return '';
    let text = html.replace(/<[^>]*>/g, ''); // Remove HTML tags

    const namedEntities: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      hellip: '...', ndash: '-', mdash: '-', lsquo: "'", rsquo: "'",
      ldquo: '"', rdquo: '"', bull: '•'
    };
    text = text.replace(/&([a-zA-Z]+);/g, (_, entity: string) => {
      const lower = entity.toLowerCase();
      return Object.prototype.hasOwnProperty.call(namedEntities, lower)
        ? namedEntities[lower]
        : `&${entity};`;
    });

    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });

    text = text.replace(/&#(\d+);/g, (_, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });

    // Normalize common Unicode punctuation to ASCII-friendly equivalents
    text = text
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2026]/g, '...');

    return text.trim();
  };

  // Helper function to clean log content of problematic characters
  const cleanLogContent = (content) => {
    if (!content) return '';
    return content
      // Remove common problematic Unicode characters
      .replace(/\u00A0/g, ' ') // Non-breaking space
      .replace(/\u200B/g, '') // Zero-width space
      .replace(/\u200C/g, '') // Zero-width non-joiner
      .replace(/\u200D/g, '') // Zero-width joiner
      .replace(/\u2028/g, '\n') // Line separator
      .replace(/\u2029/g, '\n') // Paragraph separator
      .replace(/\uFEFF/g, '') // Byte order mark
      // Remove carriage returns and normalize line endings
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove any remaining control characters except newline and tab
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
      // Remove any remaining problematic characters that could render as ?
      .replace(/[\uFFFD\uFFFF\uFFFE]/g, '') // Unicode replacement characters
      // Trim trailing whitespace from each line and ensure only printable ASCII + common Unicode
      .split('\n').map(line => line.trimEnd()
        // Keep only printable ASCII, common Unicode, and newlines/tabs
        .replace(/[^\x20-\x7E\u00A1-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\n\t]/g, '')
      ).join('\n');
  };

  // Log processing and formatting utilities
  const processLogContent = (content, buildNumber) => {
    if (!content) return { lines: [], formattedContent: '' };
    
    // Clean the content first to remove problematic characters
    const cleanedContent = cleanLogContent(content);
    let lines = cleanedContent.split('\n');
    
    // Remove trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    
    const processedLines = lines.map((line, index) => {
      const lineNumber = index + 1;
      const timestamp = extractTimestamp(line);
      const level = extractLogLevel(line);
      
      return {
        number: lineNumber,
        raw: line,
        content: line,
        timestamp,
        level,
        isBookmarked: logBookmarks.includes(lineNumber)
      };
    });
    
    // Reverse the order if logReversed is true (newest lines first)
    const displayLines = logReversed ? [...processedLines].reverse() : processedLines;
    
    const formattedContent = formatLogsForDisplay(displayLines);
    return { lines: displayLines, formattedContent };
  };

  const extractTimestamp = (line) => {
    // Extract various timestamp formats
    const patterns = [
      /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/,
      /(\d{2}:\d{2}:\d{2})/,
      /(\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2})/
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const extractLogLevel = (line) => {
    const match = line.match(/\b(ERROR|FATAL|WARN|WARNING|INFO|DEBUG|TRACE)\b/i);
    return match ? match[1].toUpperCase() : null;
  };

  const formatLogsForDisplay = (processedLines) => {
    return processedLines.map(line => {
      let formattedLine = line.content;
      
      // Apply syntax highlighting
      formattedLine = ansiToBlessed(formatLogsChunk(formattedLine));
      formattedLine = cleanLogContent(formattedLine);
      
      // Add line numbers if enabled
      if (showLineNumbers) {
        const lineNum = String(line.number).padStart(4, ' ');
        const bookmark = line.isBookmarked ? '📌' : '  ';
        formattedLine = `{gray-fg}${lineNum}{/}${bookmark} ${formattedLine}`;
      }
      
      return formattedLine;
    }).join('\n');
  };

  // Enhanced log navigation
  const scrollToLine = (lineNumber) => {
    if (!logLines.length) return;
    const totalLines = logLines.length;
    const percentage = Math.min(100, Math.max(0, (lineNumber / totalLines) * 100));
    logBox.setScrollPerc(percentage);
    screen.render();
  };

  const jumpToLogLevel = (level) => {
    const levelLine = logLines.find(line => line.level === level);
    if (levelLine) {
      scrollToLine(levelLine.number);
      setStatus(`{green-fg}Jumped to first ${level} log{/}`);
    } else {
      setStatus(`{yellow-fg}No ${level} logs found{/}`);
    }
  };

  const toggleBookmark = () => {
    // Simplified bookmark system - ask user for line number
    if (logLines.length === 0) {
      setStatus('{yellow-fg}No logs loaded to bookmark{/}');
      return;
    }
    
    // For now, bookmark the middle of visible area or a fixed line
    const lineNumber = Math.max(1, Math.floor(logLines.length * 0.5));
    
    const bookmarkIndex = logBookmarks.indexOf(lineNumber);
    if (bookmarkIndex === -1) {
      logBookmarks.push(lineNumber);
      logBookmarks.sort((a, b) => a - b); // Keep sorted
      setStatus(`{green-fg}Bookmarked line ${lineNumber}{/} (estimated)`);
    } else {
    logBookmarks.splice(bookmarkIndex, 1);
    setStatus(`{yellow-fg}Removed bookmark at line ${lineNumber}{/}`);
  }
  
  // Refresh display to show bookmark indicators
  if (logCurrentBuild && logLines.length > 0) {
    const rawContent = logLines.map(l => l.raw).join('\n');
    const { formattedContent } = processLogContent(rawContent, logCurrentBuild);
    logBox.setContent(formattedContent);
    screen.render();
  }
};

  // Enhanced fuzzy search function
  const fuzzyMatch = (pattern, text) => {
    if (!pattern) return { score: 1, matches: [] };
    
    pattern = pattern.toLowerCase();
    text = text.toLowerCase();
    
    // Simple substring match for now, can be enhanced with proper fuzzy algorithm
    const index = text.indexOf(pattern);
    if (index === -1) return { score: 0, matches: [] };
    
    const score = pattern.length / text.length; // Basic scoring
    const matches = [{ start: index, end: index + pattern.length }];
    return { score, matches };
  };

  const highlightMatches = (text, matches, highlightTag = 'yellow-bg') => {
    if (!matches || matches.length === 0) return text;
    
    let result = '';
    let lastIndex = 0;
    
    for (const match of matches) {
      result += text.slice(lastIndex, match.start);
      result += `{${highlightTag}}${text.slice(match.start, match.end)}{/}`;
      lastIndex = match.end;
    }
    result += text.slice(lastIndex);
    return result;
  };

  const ansiToBlessed = (text) => {
    if (!text || (text.indexOf('\x1b') === -1 && !/\[[0-9;]*m/.test(text))) return text;

    const stack = [];

    const openTag = (tag) => `{${tag}}`;
    const closeTag = (tag) => `{/${tag}}`;

    const applyCode = (code) => {
      switch (code) {
        case 0:
          return stack.reverse().map(closeTag).join('') + (stack.length = 0, '');
        case 1:
          stack.push('bold');
          return openTag('bold');
        case 2:
          stack.push('dim');
          return openTag('dim');
        case 3:
          stack.push('italic');
          return openTag('italic');
        case 4:
          stack.push('underline');
          return openTag('underline');
        case 7:
          stack.push('inverse');
          return openTag('inverse');
        case 9:
          stack.push('strike');
          return openTag('strike');
        case 21:
        case 22:
          return popUntil(['bold','dim']);
        case 23:
          return popUntil(['italic']);
        case 24:
          return popUntil(['underline']);
        case 27:
          return popUntil(['inverse']);
        case 29:
          return popUntil(['strike']);
        default:
          if (code >= 30 && code <= 37 || code >= 90 && code <= 97) {
            return setColor('fg', code);
          }
          if (code >= 40 && code <= 47 || code >= 100 && code <= 107) {
            return setColor('bg', code);
          }
          if (code === 39) return setColor('fg', null);
          if (code === 49) return setColor('bg', null);
          return '';
      }
    };

    const fgMap = {
      30: 'black-fg', 31: 'red-fg', 32: 'green-fg', 33: 'yellow-fg',
      34: 'blue-fg', 35: 'magenta-fg', 36: 'cyan-fg', 37: 'white-fg',
      90: 'gray-fg', 91: 'red-fg', 92: 'green-fg', 93: 'yellow-fg',
      94: 'blue-fg', 95: 'magenta-fg', 96: 'cyan-fg', 97: 'white-fg'
    };

    const bgMap = {
      40: 'black-bg', 41: 'red-bg', 42: 'green-bg', 43: 'yellow-bg',
      44: 'blue-bg', 45: 'magenta-bg', 46: 'cyan-bg', 47: 'white-bg',
      100: 'gray-bg', 101: 'red-bg', 102: 'green-bg', 103: 'yellow-bg',
      104: 'blue-bg', 105: 'magenta-bg', 106: 'cyan-bg', 107: 'white-bg'
    };

    const setColor = (type, code) => {
      const map = type === 'fg' ? fgMap : bgMap;
      const tag = code === null ? null : map[code];
      let output = '';
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].endsWith('-fg') && type === 'fg' || stack[i].endsWith('-bg') && type === 'bg') {
          output += closeTag(stack[i]);
          stack.splice(i, 1);
          break;
        }
      }
      if (tag) {
        stack.push(tag);
        output += openTag(tag);
      }
      return output;
    };

    const popUntil = (tags) => {
      let output = '';
      for (let i = stack.length - 1; i >= 0; i--) {
        if (tags.includes(stack[i])) {
          output += closeTag(stack[i]);
          stack.splice(i, 1);
          break;
        }
      }
      return output;
    };

    const processSequence = (seq) => {
      if (seq === '') return applyCode(0);
      const fragments = seq.split(/[m;]/).filter(Boolean);
      if (fragments.length === 0) return applyCode(0);
      return fragments.map(f => {
        const num = Number(f);
        return Number.isFinite(num) ? applyCode(num) : '';
      }).join('');
    };

    let converted = text.replace(/\x1b\[([0-9;]*)m/g, (_match, seq) => processSequence(seq));
    converted = converted.replace(/\[([0-9;]*)m/g, (_match, seq) => processSequence(seq));
    if (stack.length > 0) {
      const closing = stack.slice().reverse().map(closeTag).join('');
      stack.length = 0;
      return converted + closing;
    }
    return converted;
  };

  const focusedPane = () => (singleJobMode || !jobsBox.focused) ? (buildsBox.focused ? 'BUILDS' : 'LOGS') : 'JOBS';
  const stripBlessedTags = (value) => value.replace(/\{[^}]+\}/g, '');
  const padBlessed = (value, width) => {
    const plain = stripBlessedTags(value);
    if (plain.length < width) {
      return value + ' '.repeat(width - plain.length);
    }
    
    let result = '';
    let plainCount = 0;
    let i = 0;
    
    while (i < value.length && plainCount < width) {
      if (value[i] === '{') {
        const end = value.indexOf('}', i);
        if (end === -1) break;
        result += value.slice(i, end + 1);
        i = end + 1;
      } else {
        result += value[i];
        plainCount++;
        i++;
      }
    }
    
    // Append any trailing closing tags to keep formatting balanced
    while (i < value.length) {
      if (value[i] === '{') {
        const end = value.indexOf('}', i);
        if (end === -1) break;
        const tag = value.slice(i, end + 1);
        if (/^\{\/.*\}$/.test(tag)) {
          result += tag;
        }
        i = end + 1;
      } else {
        break;
      }
    }
    
    return result;
  };
  const shortcutHints = () => {
    const segments = [];

    // Current panel indicator FIRST
    const pane = focusedPane();
    segments.push(`{bold}{white-bg}{black-fg} ${pane} {/}`);

    // SEARCH section - always show, with active state if typing
    let searchSection = '';
    if (inputMode === 'job-search') {
      const matchInfo = filteredJobs.length !== jobs.length ? ` (${filteredJobs.length}/${jobs.length})` : '';
      searchSection = `{yellow-bg}{black-fg} s SEARCH ${searchQuery}${matchInfo} {/}`;
    } else if (inputMode === 'build-filter' || inputMode === 'build-search') {
      const matchInfo = filteredBuilds.length !== builds.length ? ` (${filteredBuilds.length}/${builds.length})` : '';
      searchSection = `{yellow-bg}{black-fg} s SEARCH ${buildTextFilter || buildSearchQuery}${matchInfo} {/}`;
    } else if (inputMode === 'log-search') {
      const matchInfo = logSearchMatches.length > 0 ? ` (${logSearchMatches.length})` : '';
      searchSection = `{yellow-bg}{black-fg} s SEARCH ${logSearchQuery}${matchInfo} {/}`;
    } else {
      searchSection = `{gray-fg}s{/} SEARCH`;
    }
    segments.push(searchSection);

    // Other booleans - always show
    const shortcuts = [];
    shortcuts.push(follow ? `{green-bg}{black-fg} f FOLLOW ON {/}` : `{gray-fg}f{/} FOLLOW`);
    const resFilter = resultFilterStates[resultFilterIdx];
    if (resFilter !== 'ALL') shortcuts.push(`{gray-fg}F{/} FILTER {yellow-fg}${resFilter}{/}`);
    if (foldersOnly) shortcuts.push(`{gray-fg}o{/} {cyan-fg}FOLDERS{/}`);
    shortcuts.push(`{gray-fg}?{/} HELP`);

    segments.push(shortcuts.join(' '));

    return segments;
  };
  const updatePaneIndicators = () => {
    if (!singleJobMode) {
      jobsBox.setLabel(jobsBox.focused ? '{bold}{cyan-bg}{black-fg} Jobs * {/}' : '{bold}{cyan-fg} Jobs {/}');
    }
    const jobTitle = singleJobMode ? ` ${currentJob || 'Job'} - ` : '';
    buildsBox.setLabel(buildsBox.focused ? `{bold}{yellow-bg}{black-fg}${jobTitle}Builds * (#  State  Dur  Age) {/}` : `{bold}{yellow-fg}${jobTitle}Builds (#  State  Dur  Age) {/}`);
    logBox.setLabel(logBox.focused ? '{bold}{magenta-bg}{white-fg} Logs * {/}' : '{bold}{magenta-fg} Logs {/}');
    metadataBox.setLabel(metadataBox.focused ? '{bold}{cyan-bg}{white-fg} Build Info * {/}' : '{bold}{cyan-fg} Build Info {/}');
  };
  const setStatus = (msg='', { suppressShortcuts = false } = {}) => {
    updatePaneIndicators();
    const segments = [];

    if (!suppressShortcuts) {
      // Search/filters FIRST
      const hints = shortcutHints();
      segments.push(...hints);
    }

    // Status message second (if any)
    if (msg) segments.push(msg);

    statusBar.setContent(segments.filter(Boolean).join(' | '));
    screen.render();
  };

  const refreshJobs = async () => {
    if (analysisBox) { setStatus('{cyan-fg}AI analysis open (jobs may refresh){/}'); }
    try {
      if (singleJobMode) {
        // Single job mode - just set up the job directly
        jobs = [{ name: jobsFilter[0], fullName: jobsFilter[0] }];
        filteredJobs = jobs.slice();
        currentJob = jobsFilter[0];
        setStatus(`{green-fg}Job loaded{/}: {bold}${currentJob}{/}`);
        return;
      }
      
      setStatus('Loading jobs...', { suppressShortcuts: true });
      if (!singleJobMode) {
        jobsBox.setItems(['{gray-fg}Loading jobs...{/}']);
        jobsBox.select(0);
      }
      screen.render();
      jobs = [];
      filteredJobs = [];
      
      // Optimization: If specific jobs are requested, fetch only those jobs
      if (jobsFilter && jobsFilter.length > 0) {
        setStatus(`{yellow-fg}Loading specific jobs: ${jobsFilter.join(', ')}...{/}`, { suppressShortcuts: true });
        jobs = await client.getSpecificJobs(jobsFilter);
        filteredJobs = jobs.slice();
        
        if (!singleJobMode) {
          jobsBox.setItems(filteredJobs.map(j => {
            if (j.error) {
              return `{red-fg}${j.fullName || j.name} - ERROR{/}`;
            }
            return `{white-fg}${j.fullName || j.name}{/}`;
          }));
          jobsBox.select(0); // Ensure first job is selected and scroll to it
        }
        
        if (preselectJob) {
          const idx = filteredJobs.findIndex(j => j.name === preselectJob);
          if (idx >= 0) {
            if (!singleJobMode) jobsBox.select(idx);
            currentJob = preselectJob;
          } else {
            if (!singleJobMode) jobsBox.select(0);
            currentJob = filteredJobs[0]?.name || null;
          }
        } else {
          if (!singleJobMode) jobsBox.select(0);
          currentJob = filteredJobs[0]?.name || null;
        }
        
        // Count successful vs failed jobs
        const successfulJobs = jobs.filter(j => !j.error).length;
        const failedJobs = jobs.filter(j => j.error).length;
        
        let statusMsg = `{green-fg}Jobs loaded{/}: ${successfulJobs} successful`;
        if (failedJobs > 0) {
          statusMsg += `, {red-fg}${failedJobs} failed{/}`;
        }
        statusMsg += ` {gray-fg}(${jobs.length} total){/}`;
        setStatus(statusMsg);
        screen.render();
        return;
      }

      // Default behavior: search all jobs
      let lastRender = 0;
      if (!singleJobMode) {
        jobsBox.setItems(['{gray-fg}Loading jobs...{/}']);
      }
      
      await client.searchJobsIncremental('', { limit: jobSearchLimit, onBatch: (list, stats) => {
        jobs = list;
        filteredJobs = jobs.slice();
        
        const now = Date.now();
        const denom = stats.processed + stats.queued;
        const pct = denom === 0 ? 0 : Math.round((stats.processed / denom) * 100);
        if (now - lastRender > 200 && !singleJobMode) { // throttle to ~5fps
          jobsBox.setItems(filteredJobs.map(j => `{white-fg}${j.fullName || j.name}{/}`));
        setStatus(`Loading jobs... ${stats.total} (${pct}%)`, { suppressShortcuts: true });
          lastRender = now;
        }
      }});
      
      if (!singleJobMode) {
        jobsBox.setItems(filteredJobs.map(j => `{white-fg}${j.fullName || j.name}{/}`));
      }
      
      if (preselectJob) {
        const idx = filteredJobs.findIndex(j => j.name === preselectJob);
        if (idx >= 0) {
          if (!singleJobMode) jobsBox.select(idx);
          currentJob = preselectJob;
        } else {
          if (!singleJobMode) jobsBox.select(0);
          currentJob = filteredJobs[0]?.name || null;
        }
      } else {
        if (!singleJobMode) jobsBox.select(0);
        currentJob = filteredJobs[0]?.name || null;
      }
      
      const totalMsg = `${filteredJobs.length}`;
      setStatus(`{green-fg}Jobs loaded{/}. Total: {bold}${totalMsg}{/}`);
    } catch (e) {
      setStatus('Error loading jobs: ' + e.message);
    }
    screen.render();
  };

  const applyBuildFilters = () => {
    let base = builds.slice();
    if (sortAsc) base.sort((a,b)=>a.number - b.number); else base.sort((a,b)=>b.number - a.number);
    
    let buildsWithScores = base.map(b => {
      const state = b.building ? 'RUNNING' : (b.result || 'UNKNOWN');
      const searchText = `#${b.number} ${state}`;
      const query = buildTextFilter || buildSearchQuery;
      
      let score = 1;
      let matches = [];
      
      if (query) {
        const match = fuzzyMatch(query, searchText);
        score = match.score;
        matches = match.matches;
      }
      
      return { build: b, score, matches, state, searchText };
    });
    
    // Apply filters
    buildsWithScores = buildsWithScores.filter(item => {
      const { build, score, state } = item;
      
      // Result filter
      const resultFilter = resultFilterStates[resultFilterIdx];
      if (resultFilter !== 'ALL') {
        if (resultFilter === 'FAILED' && state !== 'FAILURE') return false;
        if (resultFilter === 'SUCCESS' && state !== 'SUCCESS') return false;
        if (resultFilter === 'RUNNING' && state !== 'RUNNING') return false;
      }
      
      // Search filter
      if ((buildTextFilter || buildSearchQuery) && score === 0) return false;
      
      return true;
    });
    
    // Sort by score if searching, otherwise keep time order
    if (buildTextFilter || buildSearchQuery) {
      buildsWithScores.sort((a, b) => b.score - a.score);
    }
    
    filteredBuilds = buildsWithScores.map(item => item.build);
    
    const colorize = (b, index) => {
      const state = b.building ? 'RUNNING' : (b.result || '');
      const now = Date.now();
      const ageMs = now - (b.timestamp || now);
      const durMs = b.duration || 0;
      const fmtDur = () => {
        const d = b.building ? (Date.now() - (b.timestamp || Date.now())) : durMs;
        if (d < 1000) return `${Math.round(d)}ms`;
        if (d < 60000) return `${Math.round(d / 1000)}s`;
        if (d < 3600000) {
          const minutes = Math.floor(d / 60000);
          let seconds = Math.round((d % 60000) / 1000);
          let mins = minutes;
          if (seconds === 60) { mins += 1; seconds = 0; }
          return seconds > 0 ? `${mins}m ${seconds}s` : `${mins}m`;
        }
        let hours = Math.floor(d / 3600000);
        let minutes = Math.round((d % 3600000) / 60000);
        if (minutes === 60) { hours += 1; minutes = 0; }
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
      };
      const fmtAge = () => {
        if (!b.timestamp) return '-';
        if (ageMs < 60000) return Math.max(1, Math.round(ageMs / 1000)) + 's ago';
        if (ageMs < 3600000) return Math.round(ageMs / 60000) + 'm ago';
        if (ageMs < 86400000) return Math.round(ageMs / 3600000) + 'h ago';
        return Math.round(ageMs / 86400000) + 'd ago';
      };
      
      let tagStart = ''; let tagEnd = '{/}';
      if (b.building) tagStart = '{yellow-fg}';
      else if (state === 'SUCCESS') tagStart = '{green-fg}';
      else if (state === 'FAILURE') tagStart = '{red-fg}';
      else if (state === 'UNSTABLE') tagStart = '{magenta-fg}';
      else if (state === 'ABORTED') tagStart = '{cyan-fg}';
      else tagStart = '{white-fg}';
      
      const pad = (str, len) => padBlessed(str, len);
      let num = '#' + b.number;
      const dur = fmtDur();
      const age = fmtAge();
      
      // Apply search highlighting if matches exist
      const buildItem = buildsWithScores[index];
      if (buildItem && buildItem.matches.length > 0 && (buildTextFilter || buildSearchQuery)) {
        const highlightedText = highlightMatches(buildItem.searchText, buildItem.matches, 'yellow-bg');
        // Extract highlighted parts and apply to display
        const parts = highlightedText.split(' ');
        if (parts.length >= 2) {
          num = parts[0];
        }
      }
      
      // Columns: number (8) state (10) dur (6) age (8)
      return `${tagStart}${pad(num,8)} ${pad(state||'',10)} ${pad(dur,6)} ${pad(age,8)}${tagEnd}`;
    };
    
    buildsBox.setItems(filteredBuilds.map(colorize));
    buildsBox.select(0);
    screen.render();
  };

  const refreshBuilds = async () => {
    if (analysisBox) { setStatus('{cyan-fg}AI analysis open{/}'); }
    if (!currentJob) return;
    try {
      setStatus(`{yellow-fg}Loading builds for ${currentJob}...{/}`, { suppressShortcuts: true });
      buildsBox.setItems(['{gray-fg}Loading builds...{/}']);
      buildsBox.select(0);
      screen.render();
      
      builds = await client.listBuilds(currentJob, buildsLimit);
      
      if (builds.length === 0) {
        buildsBox.setItems(['{gray-fg}No builds found{/}']);
        setStatus(`{yellow-fg}No builds found for ${currentJob}{/}`);
      } else {
        applyBuildFilters();
        setStatus(`{green-fg}Builds loaded for ${currentJob}{/}. Total: {bold}${builds.length}{/}`);
      }
    } catch (e) {
      buildsBox.setItems([`{red-fg}Error: ${e.message}{/}`]);
      setStatus(`{red-fg}Build load error: ${e.message}{/}`);
    }
    screen.render();
  };

  const updateMetadataBox = (num) => {
    const currentBuild = builds.find(b => b.number === num);
    
    if (!currentBuild) {
      metadataBox.setContent(`{gray-fg}Build #${num} - No metadata available{/}`);
      return;
    }
    
    const status = currentBuild.building ? 'RUNNING' : (currentBuild.result || 'UNKNOWN');
    const fmtMetaDuration = (ms) => {
      if (!ms || ms < 0) return '0s';
      if (ms < 60000) return `${Math.round(ms / 1000)}s`;
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.round((ms % 60000) / 1000);
      if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        const remMinutes = minutes % 60;
        if (remMinutes === 0) return `${hours}h`;
        return seconds > 0 ? `${hours}h ${remMinutes}m ${seconds}s` : `${hours}h ${remMinutes}m`;
      }
      return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    };

    const duration = currentBuild.building ? 
      `~${fmtMetaDuration(Date.now() - (currentBuild.timestamp || Date.now()))}` : 
      fmtMetaDuration(currentBuild.duration || 0);
    
    const statusColor = currentBuild.building ? 'yellow' : 
      (currentBuild.result === 'SUCCESS' ? 'green' : 
       currentBuild.result === 'FAILURE' ? 'red' : 
       currentBuild.result === 'UNSTABLE' ? 'yellow' : 'cyan');
    
    const startTime = currentBuild.timestamp ? new Date(currentBuild.timestamp).toLocaleString() : 'Unknown';
    const description = stripHtml(currentBuild.description) || 'No description';
    
    // Try to extract user from build data or actions
    let startedBy = 'Unknown';
    if (currentBuild.actions) {
      const causeAction = currentBuild.actions.find(a => a._class?.includes('CauseAction') || a.causes);
      if (causeAction?.causes) {
        const userCause = causeAction.causes.find(c => c.userId || c.userName);
        if (userCause) {
          startedBy = userCause.userName || userCause.userId || 'Unknown';
        } else if (causeAction.causes[0]?.shortDescription) {
          // Fallback to short description (e.g., "Started by user admin")
          const match = causeAction.causes[0].shortDescription.match(/Started by (?:user )?(.+)/i);
          if (match) startedBy = match[1];
        }
      }
    }
    
    // Calculate log stats
    const logStats = logLines.length > 0 ? {
      total: logLines.length,
      errors: logLines.filter(l => l.level === 'ERROR' || l.level === 'FATAL').length,
      warnings: logLines.filter(l => l.level === 'WARN' || l.level === 'WARNING').length
    } : null;
    
    let statsLine = '';
    if (logStats) {
      const statParts = [];
      statParts.push(`{bold}{yellow-fg}Lines:{/} {white-fg}${logStats.total}{/}`);
      if (logStats.errors > 0) statParts.push(`{bold}{yellow-fg}Errors:{/} {red-fg}${logStats.errors}{/}`);
      if (logStats.warnings > 0) statParts.push(`{bold}{yellow-fg}Warnings:{/} {yellow-fg}${logStats.warnings}{/}`);
      statsLine = `\n${statParts.join('  ')}`;
    }
    
    metadataBox.setContent(
      `{bold}{yellow-fg}Build:{/} {white-fg}#${num}{/}  {bold}{yellow-fg}Status:{/} {${statusColor}-fg}${status}{/}  {bold}{yellow-fg}Duration:{/} {white-fg}${duration}{/}\n` +
      `{bold}{yellow-fg}Started:{/} {white-fg}${startTime}{/}  {bold}{yellow-fg}By:{/} {white-fg}${startedBy}{/}\n` +
      `{bold}{yellow-fg}Description:{/} {white-fg}${description}{/}${statsLine}`
    );
  };

  const loadLogs = async (num) => {
    if (analysisBox) { setStatus('{cyan-fg}AI analysis open (logs still load){/}'); }
    if (!currentJob || !num) return;

    if (pipelineBox) { closePipelineModal({ silent: true }); }
    if (actionBox) { closeActionModal({ silent: true }); }
    logCurrentBuild = num;
    
    // Update metadata box (will be called again after logs load to include stats)
    updateMetadataBox(num);
    
    // Reset log label to simple title
    logBox.setLabel(' Logs ');
    
    // Enhanced loading state with progress
    logBox.setContent(`{yellow-fg}📥 Fetching logs for build #${num}...{/}\n\n{gray-fg}Please wait while we retrieve the console output...\n\n{cyan-fg}✨ Enhanced log viewer features:{/}\n{gray-fg}• Line numbers and bookmarks\n• Syntax highlighting\n• Jump to log levels\n• Search with navigation{/}`); 
    logBox.setScrollPerc(0); // Ensure loading message is visible at top
    screen.render();
    
    try {
      const text = await client.getConsoleText(currentJob, num);
      if (!text || !text.trim()) {
        // If build is running, auto-enable follow once
        const b = builds.find(bd => bd.number === num);
        if (b && b.building) {
          follow = true;
          logBox.setContent(`{blue-fg}🔄 Build #${num} is running...{/}\n\n{gray-fg}Auto-follow enabled. Logs will stream as they become available.\n\nPress 'f' to toggle follow mode.{/}`);
          logBox.setScrollPerc(0);
          screen.render();
          setStatus('{blue-fg}Auto-follow enabled (running build, no output yet){/}');
          startFollow(num);
          return;
        }
        // Empty state for completed builds with no output
        logBox.setContent(`{gray-fg}📝 No console output available{/}\n\n{gray-fg}Build #${num} completed but produced no console output.\n\nThis can happen when:\n• Build was very quick\n• Job has console output disabled\n• Build failed before generating output\n\nTip: Try refreshing or check if the build actually ran.{/}`);
        logBox.setScrollPerc(0); // Show empty state at top
        screen.render();
      } else {
        // Store original raw text for restoring after search
        logRawText = text;
        
        // Process and format the logs with enhanced features
        const processed = processLogContent(text, num);
        logLines = processed.lines;
        
        if (!processed.formattedContent || processed.formattedContent.trim() === '') {
          const cleanedText = cleanLogContent(text);
          logBox.setContent(cleanedText || '{gray-fg}Build logs exist but could not be formatted properly.{/}');
        } else {
          logBox.setContent(processed.formattedContent);
        }
        
        logBox.setScrollPerc(0);
        screen.render();
        
        // Update metadata box again with log stats
        updateMetadataBox(num);
        setStatus();
      }
    } catch (e) {
      logBox.setContent(`{red-fg}❌ Error loading logs{/}\n\n{bold}${e.message}{/}\n\n{gray-fg}Possible causes:\n• Network connectivity issues\n• Insufficient permissions\n• Build #${num} may not exist\n• Jenkins server error\n\nTip: Check your Jenkins connection and permissions.{/}`);
      logBox.setScrollPerc(0); // Show error at top
      screen.render();
    }
  };

  const startAutoRefresh = () => {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (!autoRefresh) return;
    autoRefreshTimer = setInterval(async () => {
      if (currentJob) {
        await refreshBuilds();
        const selIdx = buildsBox.selected;
        const b = filteredBuilds[selIdx];
        if (follow && b) startFollow(b.number);
      }
    }, autoRefreshInterval);
  };

  const showArtifacts = async () => {
    if (artifactBox) { artifactBox.destroy(); artifactBox=null; artifactMode=false; screen.render(); return; }
    const selIdx = buildsBox.selected;
    const b = filteredBuilds[selIdx];
    if (!b) { setStatus('No build selected for artifacts'); return; }
    artifactMode = true;
    setStatus('Loading artifacts...', { suppressShortcuts: true });
    try {
      const res = await client.getArtifacts(currentJob, b.number);
      artifacts = res.artifacts;
    } catch (e) {
      artifacts = [];
      setStatus('Artifact load error: '+ e.message);
    }
    artifactBox = blessed.list({ parent: screen, label: ` Artifacts #${b.number} `, width: '40%', height: '50%', top: 'center', left: 'center', border: 'line', keys: true, mouse: true, tags: true, style: { selected: { bg: 'blue', fg:'white' } } });
    if (artifacts.length === 0) artifactBox.setItems(['{gray-fg}No artifacts{/}']); else artifactBox.setItems(artifacts.map(a=>a.relativePath));
    artifactBox.on('select', async (_it, idx) => {
      if (!artifacts[idx]) return;
      const art = artifacts[idx];
      setStatus('Downloading artifact ' + art.fileName + ' ...');
      try {
        const buf = await client.downloadArtifact(currentJob, b.number, art.relativePath);
        const fs = await import('fs');
        const path = await import('path');
        const outPath = path.resolve(process.cwd(), art.fileName);
        fs.writeFileSync(outPath, buf);
        setStatus('Saved ' + art.fileName);
      } catch (e) {
        setStatus('Download error: ' + e.message);
      }
    });
    artifactBox.key(['escape','a'], () => { if (artifactBox) { artifactBox.destroy(); artifactBox=null; artifactMode=false; screen.render(); } });
    screen.render();
  };

  // Log search functionality
  const searchInLogs = (content, query) => {
    if (!query) return { highlightedContent: content, matches: [], filteredContent: content };
    
    const lines = content.split('\n');
    const matches = [];
    let matchIndex = 0;
    
    const filteredLines = [];
    
    lines.forEach((line, lineIndex) => {
      const lowerLine = line.toLowerCase();
      const lowerQuery = query.toLowerCase();
      
      // Check if this line matches
      if (lowerLine.indexOf(lowerQuery) === -1) {
        return; // Skip non-matching lines
      }
      
      // Find all match positions in the original line
      const matchPositions = [];
      let searchIndex = 0;
      while (true) {
        const index = lowerLine.indexOf(lowerQuery, searchIndex);
        if (index === -1) break;
        matchPositions.push(index);
        matches.push({ line: lineIndex, char: index, matchIndex: matchIndex++ });
        searchIndex = index + query.length;
      }
      
      // Build highlighted line by inserting tags at correct positions
      let highlightedLine = '';
      let lastIndex = 0;
      for (const pos of matchPositions) {
        highlightedLine += line.slice(lastIndex, pos);
        highlightedLine += `{black-bg}{yellow-fg}${line.slice(pos, pos + query.length)}{/}`;
        lastIndex = pos + query.length;
      }
      highlightedLine += line.slice(lastIndex);
      
      filteredLines.push(highlightedLine);
    });
    
    return { 
      highlightedContent: lines.join('\n'), 
      filteredContent: filteredLines.join('\n'),
      matches 
    };
  };

  const updateLogSearchDisplay = () => {
    // Search in the raw log lines, not the formatted content
    if (!logLines || logLines.length === 0) {
      if (logSearchMode) {
        // Show search input at top even with no logs
        logBox.setContent(`{cyan-bg}{black-fg} Search: {/}{white-bg}{black-fg}${logSearchQuery}█{/}\n\n{yellow-fg}No logs to search{/}`);
        screen.render();
      }
      setStatus(`{yellow-fg}No logs to search{/}`);
      return;
    }

    // Get clean text from raw lines for searching
    // Note: logLines are already in display order (reversed or not), so use them directly
    const rawText = logLines.map(l => l.raw).join('\n');
    
    // If no query, restore original logs
    if (!logSearchQuery || logSearchQuery.trim() === '') {
      logSearchMatches = [];
      if (logRawText && logCurrentBuild) {
        const processed = processLogContent(logRawText, logCurrentBuild);
        logLines = processed.lines;
        logBox.setContent(processed.formattedContent);
        logBox.setScrollPerc(0);
      }
      setStatus();
      screen.render();
      return;
    }

    const { filteredContent, matches } = searchInLogs(rawText, logSearchQuery);

    logSearchMatches = matches;

    if (matches.length > 0) {
      // Format the filtered content - show in white with only matches highlighted
      const lines = filteredContent.split('\n');
      const formattedLines = lines.map((line, index) => {
        const lineNum = String(index + 1).padStart(4, ' ');
        // Line is already highlighted from searchInLogs, just add line number and white color
        return `{gray-fg}${lineNum}{/}  {white-fg}${line}{/}`;
      });
      
      logBox.setContent(formattedLines.join('\n'));
      logBox.setScrollPerc(0); // Reset scroll to top
      setStatus();
    } else if (logSearchQuery) {
      // Show "no matches" message
      logBox.setContent('{gray-fg}No lines match your search query.{/}');
      logBox.setScrollPerc(0); // Reset scroll to top
      setStatus();
    }
    screen.render();
  };

  const startFollow = async (num) => {
    if (analysisBox) { setStatus('{cyan-fg}AI analysis open (following logs){/}'); }
    if (!currentJob || !num) return;
    if (abortController) abortController.abort();
    abortController = new AbortController();
    
    // Find the build object to get metadata for follow mode
    const currentBuild = builds.find(b => b.number === num);
    
    // Update metadata box for follow mode
    if (currentBuild) {
      const status = 'RUNNING'; // Always running during follow
      const duration = `~${Math.round((Date.now() - (currentBuild.timestamp || Date.now()))/1000)}s`;
      const startTime = currentBuild.timestamp ? new Date(currentBuild.timestamp).toLocaleString() : 'Unknown';
      const description = stripHtml(currentBuild.description) || 'No description';
      
      metadataBox.setContent(
        `{bold}{white-fg}Build:{/} {bold}#${num}{/}  {bold}{white-fg}Status:{/} {yellow-fg}${status}{/}  {bold}{white-fg}Duration:{/} {cyan-fg}${duration}{/}\n` +
        `{bold}{white-fg}Started:{/} {gray-fg}${startTime}{/}  {bold}{white-fg}Description:{/} ${description}`
      );
    } else {
      metadataBox.setContent(`{gray-fg}Build #${num} - Following logs{/}`);
    }
    
    // Reset log label to simple title
    logBox.setLabel(' Logs ');
    
    // Enhanced follow loading state
    logBox.setContent(`{cyan-fg}🔄 Following build #${num}...{/}\n\n{gray-fg}Streaming console output in real-time.\nPress 'f' to stop following.\nPress '/' to search in logs{/}`);
    screen.render();
    
    try {
      let hasReceivedData = false;
      await client.streamConsole(currentJob, num, (chunk) => {
        if (!hasReceivedData) {
          logBox.setContent(''); // Clear loading message on first chunk
          hasReceivedData = true;
        }
        const cleanedChunk = cleanLogContent(chunk);
        // In follow mode, prepend new content since logs are reversed
        logBox.setContent(formatLogsChunk(cleanedChunk) + logBox.getContent());
        logBox.setScrollPerc(0); // Stay at top for reversed logs
        screen.render();
      }, 2000, { signal: abortController.signal });
      
      setStatus(`{green-fg}Build #${num} complete{/}. f toggle follow, r refresh`);
      
      // Show completion message if no data was received
      if (!hasReceivedData) {
        logBox.setContent(`{green-fg}✅ Build #${num} completed{/}\n\n{gray-fg}No console output was generated during the build.{/}`);
        screen.render();
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus('{gray-fg}Follow stopped{/}');
        // Don't change log content if user manually stopped following
      } else {
        setStatus(`{red-fg}Follow error: ${e.message}{/}`);
        logBox.setContent(`{red-fg}❌ Follow error{/}\n\n{bold}${e.message}{/}\n\n{gray-fg}Connection to Jenkins may have been interrupted.{/}`);
        screen.render();
      }
    }
  };

  jobsBox.on('blur', deactivateClassicTyping);
  buildsBox.on('blur', deactivateClassicTyping);

  jobsBox.on('select', async (_item, idx) => {
    deactivateClassicTyping();
    const selectedJob = filteredJobs[idx];
    if (!selectedJob) return;
    
    currentJob = selectedJob.name;
    if (pipelineBox) { closePipelineModal({ silent: true }); }
    if (actionBox) { closeActionModal({ silent: true }); }
    
    // Check if this job has an error
    if (selectedJob.error) {
      setStatus(`{red-fg}Job error: ${selectedJob.error}{/}`);
      buildsBox.setItems([`{red-fg}Cannot load builds: ${selectedJob.error}{/}`]);
      logBox.setContent(`{red-fg}❌ Job Error{/}\n\n{bold}${selectedJob.error}{/}\n\n{gray-fg}This job could not be loaded from Jenkins.\n\nPossible solutions:\n• Check job name spelling\n• Verify Jenkins permissions\n• Ensure job exists and is accessible\n• Check Jenkins server connectivity{/}`);
      logBox.setScrollPerc(0);
      metadataBox.setContent(`{red-fg}Job unavailable: ${selectedJob.error}{/}`);
      screen.render();
      return;
    }
    
    // Show immediate loading feedback for valid jobs
    setStatus(`{yellow-fg}Loading ${currentJob}...{/}`, { suppressShortcuts: true });
    buildsBox.setItems(['{gray-fg}Loading...{/}']);
    logBox.setContent(`{yellow-fg}📋 Loading job: ${currentJob}{/}\n\n{gray-fg}Fetching recent builds and build information...{/}`);
    logBox.setScrollPerc(0);
    screen.render();
    
    await refreshBuilds();
    if (builds && builds.length > 0) {
      const num = builds[0].number;
      if (follow) startFollow(num); else loadLogs(num);
    } else {
      // No builds found - show helpful message in logs
      logBox.setContent(`{gray-fg}📋 Job: ${currentJob}{/}\n\n{yellow-fg}No builds found{/}\n\n{gray-fg}This job exists but has no build history yet.\n\nPossible reasons:\n• Job was just created\n• All builds have been deleted\n• Job is disabled\n\nYou can trigger a new build from the Jenkins web interface.{/}`);
      logBox.setScrollPerc(0);
      screen.render();
    }
  });

  buildsBox.on('select', async (_item, idx) => {
    deactivateClassicTyping();
    const b = filteredBuilds[idx];
    if (!b) return;
    
    // Show immediate loading feedback for build selection
    setStatus(`{yellow-fg}Loading build #${b.number}...{/}`, { suppressShortcuts: true });
    if (follow) {
      startFollow(b.number); 
    } else {
      loadLogs(b.number);
    }
  });

  const applyJobFilter = () => {
    const query = searchQuery;
    let jobsWithScores = [];
    
    if (!query) {
      jobsWithScores = jobs.map(j => ({ job: j, score: 1, matches: [] }));
    } else {
      jobsWithScores = jobs.map(j => {
        const jobName = j.fullName || j.name;
        const match = fuzzyMatch(query, jobName);
        return { job: j, score: match.score, matches: match.matches };
      }).filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score); // Sort by match quality
    }
    
    if (foldersOnly) {
      jobsWithScores = jobsWithScores.filter(item => (item.job.fullName || item.job.name).includes('/'));
    }
    
    filteredJobs = jobsWithScores.map(item => item.job);
    
    // Display with highlighting
    const displayItems = jobsWithScores.map(item => {
      const jobName = item.job.fullName || item.job.name;
      if (query && item.matches.length > 0) {
        return `{white-fg}${highlightMatches(jobName, item.matches, 'yellow-bg')}{/}`;
      }
      return `{white-fg}${jobName}{/}`;
    });
    
    if (!singleJobMode) {
      jobsBox.setItems(displayItems);
      jobsBox.select(0);
    }
    currentJob = filteredJobs[0]?.name || null;
    if (pipelineBox) { closePipelineModal({ silent: true }); }
    if (actionBox) { closeActionModal({ silent: true }); }
    screen.render();
  };

  const startJobSearch = () => {
    if (singleJobMode || (helpBox || artifactBox || pipelineBox || actionBox)) return;
    searchMode = true;
    buildFilterMode = false;
    buildSearchMode = false;
    logSearchMode = false;
    searchQuery = '';
    inputMode = 'job-search';
    setStatus();
  };

  const startBuildFilter = () => {
    searchMode = false;
    buildFilterMode = true;
    buildSearchMode = false;
    logSearchMode = false;
    buildTextFilter = '';
    inputMode = 'build-filter';
    setStatus();
  };

  const startBuildSearch = () => {
    searchMode = false;
    buildFilterMode = false;
    buildSearchMode = true;
    logSearchMode = false;
    buildSearchQuery = '';
    inputMode = 'build-search';
    setStatus();
  };

  const startLogSearch = () => {
    searchMode = false;
    buildFilterMode = false;
    buildSearchMode = false;
    logSearchMode = true;
    logSearchQuery = '';
    logSearchMatches = [];
    logSearchIndex = -1;
    inputMode = 'log-search';
    setStatus();
    // Don't call updateLogSearchDisplay() here - just update status bar
  };

  const isTyping = () => inputMode !== 'none' && inputMode !== 'classic';

  const trackClassicTyping = (ch) => {
    if (searchMode || buildFilterMode || buildSearchMode || logSearchMode) return;
    if (!ch || ch.length !== 1) return;
    if (!/^[ -~]$/.test(ch)) return;
    activateClassicTyping();
  };

  jobsBox.on('keypress', (ch) => {
    trackClassicTyping(ch);
  });

  buildsBox.on('keypress', (ch) => {
    trackClassicTyping(ch);
  });

  screen.on('keypress', (ch, key) => {
    const printable = ch && /^[ -~]$/.test(ch);
    const classicContext = isClassicTypingContext() && !searchMode && !buildFilterMode && !buildSearchMode && !logSearchMode;
    if (classicContext && printable) {
      activateClassicTyping();
    } else if (!classicContext && classicTypingMode) {
      deactivateClassicTyping();
    }

    if (searchMode) {
      if (key?.name === 'backspace') {
        searchQuery = searchQuery.slice(0, -1);
        setStatus();
        applyJobFilter();
        return;
      }
      if (key?.full === 'enter') {
        searchMode = false;
        setStatus();
        inputMode = 'none';
        return;
      }
      if (printable && /^[\w._:-]$/.test(ch)) {
        searchQuery += ch;
        setStatus();
        applyJobFilter();
      }
    } else if (buildFilterMode) {
      if (key?.name === 'backspace') {
        buildTextFilter = buildTextFilter.slice(0, -1);
        setStatus();
        applyBuildFilters();
        return;
      }
      if (key?.full === 'enter') {
        buildFilterMode = false;
        setStatus();
        inputMode = 'none';
        return;
      }
      if (key?.name === 'escape') {
        buildFilterMode = false;
        buildTextFilter = '';
        applyBuildFilters();
        setStatus();
        inputMode = 'none';
        return;
      }
      if (printable && /^[\w._:-]$/.test(ch)) {
        buildTextFilter += ch;
        setStatus();
        applyBuildFilters();
      }
    } else if (buildSearchMode) {
      if (key?.name === 'backspace') {
        buildSearchQuery = buildSearchQuery.slice(0, -1);
        setStatus();
        applyBuildFilters();
        return;
      }
      if (key?.full === 'enter') {
        buildSearchMode = false;
        setStatus();
        inputMode = 'none';
        return;
      }
      if (printable && /^[\w._:-\s]$/.test(ch)) {
        buildSearchQuery += ch;
        setStatus();
        applyBuildFilters();
      }
    } else if (logSearchMode) {
      if (key?.name === 'backspace') {
        logSearchQuery = logSearchQuery.slice(0, -1);
        setStatus();
        updateLogSearchDisplay();
        return;
      }
      if (key?.full === 'enter') {
        logSearchMode = false;
        updateLogSearchDisplay();
        logSearchIndex = 0;
        setStatus();
        inputMode = 'none';
        return;
      }
      if (printable && /^[\w._:-\s]$/.test(ch)) {
        logSearchQuery += ch;
        setStatus();
        updateLogSearchDisplay();
      }
    }
    // Else: let panes handle native navigation/search.
  });

  screen.key('q', () => {
    if (isTyping()) return;
    if (abortController) abortController.abort();
    process.exit(0);
  });
  screen.key('C-c', () => {
    if (abortController) abortController.abort();
    process.exit(0);
  });
  screen.key('r', async () => { if (isTyping()) return; await refreshJobs(); await refreshBuilds(); });
  screen.key('f', () => { if (isTyping()) return; follow = !follow; setStatus((follow? 'Follow ON' : 'Follow OFF')); });
  
  // Open job/build in browser or toggle wrap (logs focused)
  screen.key('w', async () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox) return;
    if (logBox.focused) {
      logWrapMode = !logWrapMode;
      setStatus(`{yellow-fg}Word wrap toggle noted (${logWrapMode ? 'ON' : 'OFF'}) - refresh logs to apply{/}`);
      screen.render();
      return;
    }
    try {
      const base = client.baseUrl.replace(/\/$/, '');
      let url;
      if (currentJob) {
        const selIdx = buildsBox.selected;
        const selectedBuild = filteredBuilds[selIdx];
        if (selectedBuild && buildsBox.focused) {
          url = `${base}/job/${encodeURIComponent(currentJob)}/${selectedBuild.number}/`;
          setStatus(`Opening build #${selectedBuild.number} in browser...`);
        } else {
          url = `${base}/job/${encodeURIComponent(currentJob)}/`;
          setStatus(`Opening job ${currentJob} in browser...`);
        }
        const { exec } = await import('child_process');
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${opener} "${url}"`);
        setTimeout(() => setStatus('Ready'), 2000);
      } else {
        setStatus('No job selected');
      }
    } catch (e) {
      setStatus('Error opening browser: ' + e.message);
    }
  });
  screen.key(['S', 'S-s'], () => { if (isTyping()) return; sortAsc = !sortAsc; applyBuildFilters(); setStatus(`Sort: ${sortAsc?'ASC':'DESC'}`); });
  screen.key('t', () => { if (isTyping()) return; autoRefresh = !autoRefresh; if (autoRefresh) startAutoRefresh(); else if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer=null; } setStatus(`AutoRefresh: ${autoRefresh ? (autoRefreshInterval/1000)+'s' : 'OFF'}`); });
  screen.key('a', async () => { if (isTyping()) return; await showArtifacts(); });
  // Change job limit
  screen.key(['L', 'S-l'], () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox) return;
    let promptBox = blessed.box({ parent: screen, top: 'center', left: 'center', width: '40%', height: 5, border: 'line', label: ' Job Limit ', tags: true, content: 'Enter job limit (0 = unlimited):' });
    const input = blessed.textbox({ parent: promptBox, top: 2, left: 1, width: '90%', height: 1, inputOnFocus: true, keys: true, mouse: true, border: 'line' });
    input.on('submit', async (val) => {
      const n = parseInt(String(val), 10);
      promptBox.destroy();
      if (Number.isFinite(n) && n >= 0) { jobSearchLimit = n; setStatus('Job limit set to ' + (n===0? 'UNLIMITED' : n)); await refreshJobs(); } else { setStatus('Invalid job limit'); }
    });
    input.on('cancel', () => { promptBox.destroy(); screen.render(); });
    input.focus();
    screen.render();
  });

  // Removed legacy duplicate '/' binding; unified later context-aware binding

  // Result filter cycle
  screen.key(['F', 'S-f'], () => {
    if (isTyping()) return;
    resultFilterIdx = (resultFilterIdx + 1) % resultFilterStates.length;
    applyBuildFilters();
    setStatus(`Result filter: ${resultFilterStates[resultFilterIdx]} (${filteredBuilds.length}/${builds.length})`);
  });

  // Folders only toggle
  screen.key('o', () => {
    if (isTyping()) return;
    foldersOnly = !foldersOnly;
    applyJobFilter();
    setStatus(`Folders filter: ${foldersOnly ? 'ON' : 'OFF'}`);
  });

  // Build search modes
  screen.key('b', () => {
    if (helpBox || artifactBox || pipelineBox || actionBox) return;
    if (inputMode === 'classic') deactivateClassicTyping();
    if (isTyping()) return;
    if (!buildsBox.focused) { setStatus('{gray-fg}Focus the Builds panel to search builds{/}', { suppressShortcuts: true }); return; }
    startBuildFilter();
  });

  // Enhanced build search (uppercase B for fuzzy search)
  screen.key(['B', 'S-b'], () => {
    if (helpBox || artifactBox || pipelineBox || actionBox) return;
    if (inputMode === 'classic') deactivateClassicTyping();
    if (isTyping()) return;
    if (!buildsBox.focused) { setStatus('{gray-fg}Focus the Builds panel to search builds{/}', { suppressShortcuts: true }); return; }
    startBuildSearch();
  });

  // Log search
  screen.key('/', () => {
    if (inputMode === 'classic') deactivateClassicTyping();
    if (isTyping()) return;
    if (logBox.focused) {
      startLogSearch();
    } else {
      setStatus('{gray-fg}Log search is available from the Logs panel{/}', { suppressShortcuts: true });
    }
  });

  // Contextual search (explicit via 's')
  screen.key('s', () => {
    if (helpBox || artifactBox || pipelineBox || actionBox) return;
    if (inputMode === 'classic') deactivateClassicTyping();
    if (isTyping()) return;
    if (!singleJobMode && jobsBox.focused) {
      startJobSearch();
    } else if (buildsBox.focused) {
      startBuildFilter();
    } else if (logBox.focused) {
      startLogSearch();
    } else {
      setStatus('{gray-fg}Search is available in Jobs, Builds, or Logs panels{/}', { suppressShortcuts: true });
    }
  });

  // Navigate search results in logs
  screen.key('n', () => {
    if (logSearchMatches.length > 0 && logSearchQuery) {
      logSearchIndex = (logSearchIndex + 1) % logSearchMatches.length;
      setStatus(`{green-fg}Match ${logSearchIndex + 1}/${logSearchMatches.length}{/}`);
      // TODO: Scroll to match position
    }
  });

  screen.key(['N', 'S-n'], () => {
    if (logSearchMatches.length > 0 && logSearchQuery) {
      logSearchIndex = logSearchIndex <= 0 ? logSearchMatches.length - 1 : logSearchIndex - 1;
      setStatus(`{green-fg}Match ${logSearchIndex + 1}/${logSearchMatches.length}{/}`);
      // TODO: Scroll to match position
    }
  });

  // Enhanced log navigation keys
  screen.key('m', () => {
    if (isTyping()) return;
    if (logBox.focused && logLines.length > 0) {
      toggleBookmark();
    }
  });

  // Jump to log levels
  screen.key('e', () => {
    if (isTyping()) return;
    if (logBox.focused) {
      jumpToLogLevel('ERROR');
    }
  });

  screen.key(['W', 'S-w'], () => {
    if (isTyping()) return;
    if (logBox.focused) {
      jumpToLogLevel('WARN');
    }
  });

  screen.key('i', () => {
    if (isTyping()) return;
    if (logBox.focused) {
      jumpToLogLevel('INFO');
    }
  });

  // Toggle line numbers
  screen.key('l', () => {
    if (isTyping()) return;
    if (logBox.focused && logCurrentBuild) {
      showLineNumbers = !showLineNumbers;
      const processed = processLogContent(logBox.getContent(), logCurrentBuild);
      logBox.setContent(processed.formattedContent);
      setStatus(`{green-fg}Line numbers ${showLineNumbers ? 'ON' : 'OFF'}{/}`);
      screen.render();
    }
  });

  // Toggle log sort order
  screen.key(['R', 'S-r'], () => {
    if (isTyping()) return;
    if (logBox.focused && logCurrentBuild && logLines.length > 0) {
      logReversed = !logReversed;
      // Re-process logs with new sort order
      const rawText = logLines.map(l => l.raw).join('\n');
      const processed = processLogContent(rawText, logCurrentBuild);
      logLines = processed.lines;
      logBox.setContent(processed.formattedContent);
      logBox.setScrollPerc(0); // Go to top after reordering
      setStatus(`{green-fg}Log order: ${logReversed ? 'Newest first' : 'Oldest first'}{/}`);
      screen.render();
    }
  });

  // Toggle fullscreen logs (works from any column)
  screen.key('z', () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox) return;
    
    logFullscreen = !logFullscreen;
    
    if (logFullscreen) {
      // Hide other panels and expand log box to fullscreen
      if (!singleJobMode) (jobsBox as any).hide();
      (buildsBox as any).hide();
      (metadataBox as any).hide();
      (logBox as any).top = 0;
      (logBox as any).left = 0;
      (logBox as any).width = '100%';
      (logBox as any).height = '100%-3';
      logBox.setLabel('{bold}{magenta-bg}{white-fg} Logs (Fullscreen - press z to exit) {/}');
      logBox.focus();
    } else {
      // Restore normal layout
      if (!singleJobMode) (jobsBox as any).show();
      (buildsBox as any).show();
      (metadataBox as any).show();
      (logBox as any).top = 7;
      (logBox as any).left = singleJobMode ? '30%' : '40%';
      (logBox as any).width = singleJobMode ? '70%' : '60%';
      (logBox as any).height = '100%-10';
      logBox.setLabel(logBox.focused ? '{bold}{magenta-bg}{white-fg} Logs * {/}' : '{bold}{magenta-fg} Logs {/}');
    }
    
    screen.render();
    setStatus(`{green-fg}Fullscreen: ${logFullscreen ? 'ON' : 'OFF'}{/}`);
  });


  // Jump to top/bottom
  screen.key('g', () => {
    if (isTyping()) return;
    if (logBox.focused) {
      logBox.setScrollPerc(0);
      setStatus(`{green-fg}Jumped to ${logReversed ? 'newest' : 'oldest'}{/}`);
      screen.render();
    }
  });

  screen.key(['G', 'S-g'], () => {
    if (isTyping()) return;
    if (logBox.focused) {
      logBox.setScrollPerc(100);
      setStatus(`{green-fg}Jumped to ${logReversed ? 'oldest' : 'newest'}{/}`);
      screen.render();
    }
  });

  // Navigate bookmarks
  screen.key(['M', 'S-m'], () => {
    if (isTyping()) return;
    if (logBox.focused && logBookmarks.length > 0) {
      // Just jump to the first bookmark for now
      const nextBookmark = logBookmarks[0];
      scrollToLine(nextBookmark);
      setStatus(`{green-fg}Jumped to bookmark at line ${nextBookmark}{/} (${logBookmarks.length} total)`);
    } else if (logBookmarks.length === 0) {
      setStatus('{yellow-fg}No bookmarks set - press m to bookmark current line{/}');
    }
  });

  const closeAnalysisModal = () => {
    // Cancel streaming process and timers
    if (aiChildProcess) {
      try { aiChildProcess.kill('SIGINT'); } catch {}
      aiChildProcess = null;
    }
    if (analysisUpdateTimer) { clearTimeout(analysisUpdateTimer); analysisUpdateTimer = null; }
    analysisRawMarkdown = '';
    analysisLastRender = 0;
    if (analysisBox) {
      analysisBox.destroy();
      analysisBox = null;
    }
    setStatus('{gray-fg}AI analysis closed{/}');
    screen.render();
  };

const closePipelineModal = (options: { silent?: boolean } = {}) => {
  if (pipelineBox) {
    (pipelineBox as any).destroy();
    pipelineBox = null;
  }
  pipelineLoading = false;
  if (!options.silent) {
    setStatus('{gray-fg}Pipeline view closed{/}');
  }
  screen.render();
};

const closeActionModal = (options: { silent?: boolean } = {}) => {
  if (actionBox) {
    (actionBox as any).destroy();
    actionBox = null;
  }
  if (!options.silent) {
    setStatus('{gray-fg}Actions menu closed{/}');
  }
  screen.render();
};

const safeText = (value: unknown): string => {
    const text = value == null ? '' : String(value);
    const helpers = (blessed as any)?.helpers;
    if (helpers && typeof helpers.escape === 'function') {
      return helpers.escape(text);
    }
    return text.replace(/[{}]/g, (ch) => (ch === '{' ? '{open}' : '{close}'));
  };

  const formatDurationShort = (ms?: number | null): string => {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0s';
    if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remMinutes = minutes % 60;
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        if (remHours === 0 && remMinutes === 0) return `${days}d`;
        if (remMinutes === 0) return `${days}d ${remHours}h`;
        return `${days}d ${remHours}h ${remMinutes}m`;
      }
      if (remMinutes === 0) return `${hours}h`;
      return seconds > 0 ? `${hours}h ${remMinutes}m ${seconds}s` : `${hours}h ${remMinutes}m`;
    }
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  const stageStatusBadge = (rawStatus: unknown): string => {
    const normalized = (rawStatus || 'UNKNOWN').toString().toUpperCase();
    const status = normalized === 'FAILED' ? 'FAILURE' : normalized;
    const palette: Record<string, { icon: string; color: string }> = {
      SUCCESS: { icon: '✔', color: 'green-fg' },
      FAILURE: { icon: '✖', color: 'red-fg' },
      ABORTED: { icon: '■', color: 'magenta-fg' },
      SKIPPED: { icon: '⏭', color: 'yellow-fg' },
      PAUSED: { icon: '⏸', color: 'yellow-fg' },
      RUNNING: { icon: '⟳', color: 'cyan-fg' },
      IN_PROGRESS: { icon: '⟳', color: 'cyan-fg' },
      QUEUED: { icon: '…', color: 'gray-fg' },
      UNSTABLE: { icon: '▲', color: 'yellow-fg' },
      NOT_EXECUTED: { icon: '…', color: 'gray-fg' },
      UNKNOWN: { icon: '?', color: 'gray-fg' }
    };
    const scheme = palette[status] || { icon: '∙', color: 'gray-fg' };
    return `{${scheme.color}}${scheme.icon} ${status}{/}`;
  };

  const collectStageChildren = (stage: any): any[] => {
    const children: any[] = [];
    if (Array.isArray(stage?.branches)) {
      for (const branch of stage.branches) {
        const branchStages = Array.isArray(branch?.stageFlowNodes) && branch.stageFlowNodes.length > 0
          ? branch.stageFlowNodes
          : branch?.stages;
        children.push({
          ...branch,
          name: branch?.name || branch?.displayName || branch?.title || 'Branch',
          status: branch?.status || branch?.result || branch?.state || stage.status,
          __type: 'branch',
          __detail: branchStages && branchStages.length ? `${branchStages.length} step${branchStages.length > 1 ? 's' : ''}` : '',
          stages: branch?.stages,
          stageFlowNodes: branch?.stageFlowNodes
        });
      }
    }
    if (Array.isArray(stage?.stages) && stage.stages.length) {
      children.push(...stage.stages);
    }
    if (Array.isArray(stage?.stageFlowNodes) && stage.stageFlowNodes.length) {
      const noteworthyNodes = stage.stageFlowNodes.filter((node: any) => {
        const nodeStatus = (node?.status || node?.state || '').toString().toUpperCase();
        if (!nodeStatus) return false;
        return !['SUCCESS', 'FINISHED', 'NOT_BUILT', 'SKIPPED'].includes(nodeStatus);
      });
      for (const node of noteworthyNodes) {
        children.push({
          ...node,
          name: node?.displayName || node?.name || `Step ${node?.id || ''}`,
          status: node?.status || node?.state || 'UNKNOWN',
          __type: 'step',
          __detail: node?.error?.message || node?.displayDescription || node?.stageState || ''
        });
      }
    }
    return children;
  };

  const renderStageLines = (stage: any, prefix: string, isLast: boolean): string[] => {
    const lines: string[] = [];
    const connector = `${prefix}${isLast ? '└─' : '├─'}`;
    const statusBadge = stageStatusBadge(stage?.status || stage?.state || stage?.result);
    const name = safeText(stage?.name || stage?.displayName || stage?.title || stage?.id || 'Stage');
    const typeSuffix = stage?.__type === 'branch'
      ? ' {gray-fg}[branch]{/}'
      : stage?.__type === 'step'
        ? ' {gray-fg}[step]{/}'
        : '';
    let line = `${connector} ${statusBadge} {bold}${name}{/}${typeSuffix}`;
    const durationMs = stage?.totalDurationMillis ?? stage?.durationMillis ?? stage?.duration;
    if (typeof durationMs === 'number' && durationMs > 0) {
      line += ` {gray-fg}(${formatDurationShort(durationMs)}){/}`;
    }
    if (stage?.pauseDurationMillis && stage.pauseDurationMillis > 0) {
      line += ` {yellow-fg}[paused ${formatDurationShort(stage.pauseDurationMillis)}]{/}`;
    }
    const detail = stage?.__detail || stage?.error?.message || stage?.displayDescription || stage?.parameterDescription;
    if (detail) {
      line += ` {white-fg}— ${safeText(detail)}{/}`;
    }
    lines.push(line);

    const children = collectStageChildren(stage);
    if (children.length > 0) {
      const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;
      children.forEach((child, idx) => {
        lines.push(...renderStageLines(child, childPrefix, idx === children.length - 1));
      });
    }
    return lines;
  };

  const buildPipelineDiagram = (pipeline: any, jobName: string, buildNumber: number): string => {
    if (!pipeline) return '{gray-fg}No pipeline data available{/}';
    const lines: string[] = [];
    const topStatus = stageStatusBadge(pipeline?.status || pipeline?.state || pipeline?.result);
    const title = pipeline?.name ? safeText(pipeline.name) : `Job ${safeText(jobName)}`;
    const duration = typeof pipeline?.durationMillis === 'number' ? ` {gray-fg}(${formatDurationShort(pipeline.durationMillis)}){/}` : '';
    lines.push(`{bold}${topStatus} {white-fg}${title} #${buildNumber}{/}${duration}`);
    if (pipeline?.startTimeMillis) {
      lines.push(`{gray-fg}Started: ${safeText(new Date(pipeline.startTimeMillis).toLocaleString())}{/}`);
    }
    if (pipeline?.endTimeMillis) {
      lines.push(`{gray-fg}Ended: ${safeText(new Date(pipeline.endTimeMillis).toLocaleString())}{/}`);
    }
    lines.push('');
    if (Array.isArray(pipeline?.stages) && pipeline.stages.length > 0) {
      pipeline.stages.forEach((stage: any, idx: number) => {
        lines.push(...renderStageLines(stage, '', idx === pipeline.stages.length - 1));
      });
    } else {
      lines.push('{gray-fg}No stage data available{/}');
    }
    return lines.join('\n');
  };

  const togglePipelineView = async () => {
    if (pipelineLoading) return;
    if (pipelineBox) {
      closePipelineModal();
      return;
    }
    if (actionBox) { closeActionModal({ silent: true }); }
    if (!currentJob) {
      setStatus('{yellow-fg}Select a job to view its pipeline{/}');
      return;
    }
    if (!logCurrentBuild) {
      setStatus('{yellow-fg}Select a build to visualize its pipeline{/}');
      return;
    }

    pipelineLoading = true;
    pipelineBox = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      border: 'line',
      label: ` Pipeline ${currentJob} #${logCurrentBuild} `,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      tags: true,
      vi: true,
      scrollbar: {
        ch: asciiScrollbar ? '|' : '█',
        style: { bg: 'gray', fg: 'cyan' },
        track: {
          ch: asciiScrollbar ? ' ' : '░',
          style: { bg: 'black', fg: 'gray' }
        }
      },
      content: '{cyan-fg}Loading pipeline stages...{/}'
    });
    (pipelineBox as any).key(['escape', 'p', 'x'], () => closePipelineModal());
    pipelineBox.focus();
    screen.render();
    setStatus('{cyan-fg}Fetching pipeline stages...{/}', { suppressShortcuts: true });

    try {
      const pipeline = await client.getPipelineStages(currentJob, logCurrentBuild);
      const diagram = buildPipelineDiagram(pipeline, currentJob, logCurrentBuild);
      pipelineBox.setContent(diagram);
      pipelineBox.setLabel(` Pipeline ${currentJob} #${logCurrentBuild} `);
      setStatus('{green-fg}Pipeline view ready{/}');
    } catch (error: any) {
      const message = safeText(error?.message || String(error));
      pipelineBox?.setContent(`{red-fg}Failed to load pipeline{/}\n\n${message}`);
      setStatus(`{red-fg}Pipeline error: ${message}{/}`);
    } finally {
      pipelineLoading = false;
      screen.render();
    }
  };

  const stopCurrentBuild = async () => {
    if (buildActionBusy) { setStatus('{yellow-fg}Another build action in progress{/}'); return; }
    if (!currentJob || !logCurrentBuild) { setStatus('{yellow-fg}Select a running build to stop{/}'); return; }
    const currentBuild = builds.find(b => b.number === logCurrentBuild);
    if (!currentBuild) { setStatus('{red-fg}Build not found in list{/}'); return; }
    if (!currentBuild.building) {
      setStatus('{yellow-fg}Build is not running; nothing to stop{/}');
      return;
    }
    buildActionBusy = true;
    try {
      setStatus(`{cyan-fg}Stopping build #${logCurrentBuild}...{/}`, { suppressShortcuts: true });
      await client.stopBuild(currentJob, logCurrentBuild);
      setStatus(`{green-fg}Stop requested for #${logCurrentBuild}{/}`);
      await refreshBuilds();
    } catch (error: any) {
      setStatus(`{red-fg}Stop failed: ${error.message}{/}`);
    } finally {
      buildActionBusy = false;
    }
  };

  const rerunCurrentJob = async () => {
    if (buildActionBusy) { setStatus('{yellow-fg}Another build action in progress{/}'); return; }
    if (!currentJob) { setStatus('{yellow-fg}Select a job to rerun{/}'); return; }
    buildActionBusy = true;
    try {
      setStatus(`{cyan-fg}Triggering new build for ${currentJob}...{/}`, { suppressShortcuts: true });
      await client.triggerBuild(currentJob);
      setStatus(`{green-fg}Build queued for ${currentJob}{/}`);
      await refreshBuilds();
    } catch (error: any) {
      setStatus(`{red-fg}Rerun failed: ${error.message}{/}`);
    } finally {
      buildActionBusy = false;
    }
  };

  const openActionsMenu = () => {
    if (actionBox) {
      closeActionModal({ silent: true });
      return;
    }
    if (!currentJob) {
      setStatus('{yellow-fg}Select a job to manage actions{/}');
      return;
    }
    const currentBuild = logCurrentBuild ? builds.find(b => b.number === logCurrentBuild) : null;
    const actions: Array<{ id: 'stop' | 'rerun'; label: string; disabled?: boolean }> = [];
    if (currentBuild && currentBuild.building) {
      actions.push({ id: 'stop', label: `Stop running build #${currentBuild.number}` });
    }
    actions.push({ id: 'rerun', label: `Queue new build for ${currentJob}` });
    const items = actions.length
      ? actions.map(a => a.disabled ? `{gray-fg}${a.label}{/}` : `{white-fg}${a.label}{/}`)
      : ['{gray-fg}No actions available{/}'];

    if (pipelineBox) { closePipelineModal({ silent: true }); }
    if (helpBox) {
      (helpBox as any).destroy();
      helpBox = null;
    }
    actionBox = blessed.list({
      parent: screen,
      width: '60%',
      height: actions.length > 0 ? Math.min(actions.length + 4, 10) : 6,
      top: 'center',
      left: 'center',
      border: 'line',
      label: ` Actions for ${currentJob}${currentBuild ? ` #${currentBuild.number}` : ''} `,
      keys: true,
      mouse: true,
      tags: true,
      vi: true,
      scrollable: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        item: { fg: 'white' },
        border: { fg: 'green' },
        label: { fg: 'green', bold: true }
      },
      items
    });

    (actionBox as any)._actions = actions;
    (actionBox as any).key(['escape', 'q'], () => { closeActionModal(); });
    actionBox.on('select', async (_item, idx) => {
      const selected = actions[idx];
      if (!selected) { closeActionModal({ silent: true }); return; }
      closeActionModal({ silent: true });
      if (selected.id === 'stop') {
        await stopCurrentBuild();
      } else if (selected.id === 'rerun') {
        await rerunCurrentJob();
      }
    });
    actionBox.on('destroy', () => { actionBox = null; });
    actionBox.focus();
    screen.render();
    setStatus('{cyan-fg}Select an action (Enter or ESC){/}', { suppressShortcuts: true });
  };

  const performAIAnalysis = async (model?: string) => {
    // Prevent multiple modals
    if (analysisBox) { setStatus('{yellow-fg}AI analysis already running{/}'); return; }

    try {
      const { spawn } = await import('child_process');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      // Verify opencode exists (non-blocking attempt using spawn)
      const whichProc = spawn('which', ['opencode']);
      let whichOutput = '';
      let whichError = '';
      whichProc.stdout.on('data', d => whichOutput += d.toString());
      whichProc.stderr.on('data', d => whichError += d.toString());
      const whichResult: Promise<boolean> = new Promise(res => {
        whichProc.on('close', code => res(code === 0 && whichOutput.trim().length > 0));
      });
      const hasOpencode = await whichResult;
      if (!hasOpencode) {
        setStatus('{red-fg}opencode not found. Install: npm install -g opencode{/}');
        return;
      }

      // STEP 1: Model selection if none provided
      if (!model) {
        setStatus('{cyan-fg}Loading models (stream)...{/}', { suppressShortcuts: true });
        screen.render();
        const modelsProc = spawn('opencode', ['models']);
        let modelsBuf = '';
        modelsProc.stdout.on('data', d => { modelsBuf += d.toString(); });
        modelsProc.stderr.on('data', d => { /* ignore noisy warnings */ });
        modelsProc.on('close', () => {
          const lines = modelsBuf.split('\n').map(l => l.trim()).filter(l => l && !/^Available/i.test(l));
          if (lines.length === 0) {
            setStatus('{red-fg}No AI models found (opencode models){/}');
            return;
          }
          const modelSelectBox = blessed.list({
            parent: screen,
            width: '80%', height: '60%', top: 'center', left: 'center', border: 'line',
            label: ' Select AI Model (Enter to confirm, ESC to cancel) ',
            keys: true, vi: true, mouse: true, scrollable: true,
            items: lines,
            style: { border: { fg: 'cyan' }, label: { fg: 'cyan', bold: true }, selected: { bg: 'blue', fg: 'white' } }
          });
          (modelSelectBox as any).key(['enter'], () => {
            const idx = (modelSelectBox as any).selected;
            const chosen = lines[idx];
            (modelSelectBox as any).destroy();
            screen.render();
            performAIAnalysis(chosen);
          });
          (modelSelectBox as any).key(['escape','q'], () => {
            (modelSelectBox as any).destroy();
            screen.render();
            setStatus('{gray-fg}AI analysis cancelled{/}');
          });
          modelSelectBox.focus();
          screen.render();
        });
        return;
      }

      // STEP 2: Prepare context (logs + metadata)
      const buildNumber = logCurrentBuild;
      const buildObj = buildNumber ? builds.find(b => b.number === buildNumber) : null;
      const contextLines: string[] = [];
      contextLines.push(`# Build Failure Analysis`);
      contextLines.push(`Analyze this Jenkins build failure and provide a structured incident report.`);
      contextLines.push(``);
      contextLines.push(`## Output Format:`);
      contextLines.push(`Use the following structure with markdown formatting (do NOT include emojis or icons):`);
      contextLines.push(``);
      contextLines.push(`### Root Cause`);
      contextLines.push(`One clear sentence identifying the failing component and immediate cause.`);
      contextLines.push(``);
      contextLines.push(`### Evidence`);
      contextLines.push(`- Key error messages or log excerpts (use \`code blocks\` for errors)`);
      contextLines.push(`- Build number and timestamp`);
      contextLines.push(`- Failed stage/step name`);
      contextLines.push(``);
      contextLines.push(`### Impact`);
      contextLines.push(`- What is broken or blocked`);
      contextLines.push(`- Severity level (CRITICAL/HIGH/MEDIUM/LOW)`);
      contextLines.push(``);
      contextLines.push(`### Recommended Fix`);
      contextLines.push(`Numbered steps for resolution, prioritized by likelihood of success.`);
      contextLines.push(``);
      contextLines.push(`## Guidelines:`);
      contextLines.push(`- Use bullet points and numbered lists for clarity`);
      contextLines.push(`- Use \`code formatting\` for errors, commands, file paths, and technical terms`);
      contextLines.push(`- Use **bold** for severity indicators (FAILURE, BLOCKED, CRITICAL)`);
      contextLines.push(`- Keep total output under 400 words`);
      contextLines.push(`- Be specific and actionable - include line numbers, error codes, exact commands when available`);
      contextLines.push(`- Do not include emojis, icons, or decorative characters`);
      contextLines.push(`- Do not restate these instructions`);
      contextLines.push(``);
      contextLines.push(`## Build Context:`);
      if (currentJob) contextLines.push(`Job: ${currentJob}`);
      if (buildObj) contextLines.push(`Build: #${buildObj.number} Result: ${buildObj.building ? 'RUNNING' : (buildObj.result || 'UNKNOWN')}`);
      if (buildObj && buildObj.timestamp) contextLines.push(`Started: ${new Date(buildObj.timestamp).toISOString()}`);
      if (buildObj && buildObj.duration) contextLines.push(`Duration(ms): ${buildObj.duration}`);
      contextLines.push('---');
      const rawLogs = logRawText || logLines.map(l => l.raw).join('\n');
      const trimmedLogs = rawLogs.split('\n').slice(0, 8000).join('\n'); // cap size
      contextLines.push(trimmedLogs);
      const promptFile = path.join(os.tmpdir(), `jenkins-ai-${Date.now()}.log`);
      fs.writeFileSync(promptFile, contextLines.join('\n'));

      // Build analysis modal
      analysisBox = blessed.box({
        parent: screen,
        top: 'center', left: 'center', width: '90%', height: '80%',
        border: 'line',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        tags: true,
        label: ` AI Analysis (${model}) - Streaming... (ESC to close) `,
        scrollbar: {
          ch: asciiScrollbar ? '|' : '█',
          style: { bg: 'gray', fg: 'cyan' },
          track: {
            ch: asciiScrollbar ? ' ' : '░',
            style: { bg: 'black', fg: 'gray' }
          }
        },
        content: '{cyan-fg}Starting AI analysis...{/}\n\n{gray-fg}Streaming response will appear here. Please wait...{/}'
      });
      analysisBox.focus();
      screen.render();
      setStatus('{cyan-fg}AI analysis started (streaming){/}', { suppressShortcuts: true });

      const scrollModal = (delta: number) => {
        if (!analysisBox) return;
        analysisBox.scroll(delta);
        screen.render();
      };
      const modalPageSize = () => {
        const h = analysisBox?.height;
        if (typeof h === 'number' && Number.isFinite(h)) {
          return Math.max(1, h - 2);
        }
        return Math.max(1, Math.floor(screen.height * 0.7));
      };
      (analysisBox as any).key(['up', 'k'], () => scrollModal(-1));
      (analysisBox as any).key(['down', 'j'], () => scrollModal(1));
      (analysisBox as any).key(['pageup'], () => scrollModal(-modalPageSize()));
      (analysisBox as any).key(['pagedown'], () => scrollModal(modalPageSize()));

       // Spawn opencode analysis using positional prompt file
       const args = ['run', '--model', model, '--format', 'json'];
       aiChildProcess = spawn('opencode', args, { env: { ...process.env } });
       analysisRawMarkdown = '';
       analysisLastRender = 0;

       const sanitizeChunk = (raw: string) => {
         let s = raw.replace(/\r+/g, '\n'); // convert carriage returns to newlines
         s = s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); // strip ANSI escape codes
         return s;
       };

       const escapeForBlessed = (value: string) => {
         const helpers = (blessed as any)?.helpers;
         if (helpers && typeof helpers.escape === 'function') {
           return helpers.escape(value);
         }
         return value.replace(/[{}]/g, ch => (ch === '{' ? '{open}' : '{close}'));
       };

       const renderNow = () => {
         if (!analysisBox) return;
         let display = analysisRawMarkdown.replace(/```+/g, ''); // strip fenced markers but keep content
         display = escapeForBlessed(display); // protect against blessed tag injection

        // Apply simple color formatting for readability
        display = display.replace(/^(\|\s*Stage\s*\|\s*State\s*\|\s*Detail\s*\|)$/gm, (line) => `{cyan-fg}{bold}${line}{/bold}{/}`);
        display = display.replace(/^(\|[-\s|]+\|)$/gm, (line) => `{cyan-fg}${line}{/}`);
        display = display.replace(
          /^\|\s*([^|\n]+)\|\s*([^|\n]+)\|\s*([^|\n]+?)\s*\|$/gm,
          (_line, stage: string, state: string, detail: string) => {
            const stageLabel = stage.trim();
            const stateLabel = state.trim();
            const detailLabel = detail.trim();
            let stateColor = 'white-fg';
            if (/fail|error|abort|mismatch|blocked/i.test(stateLabel)) stateColor = 'red-fg';
            else if (/skip|defer|pending/i.test(stateLabel)) stateColor = 'yellow-fg';
            else if (/pass|success|healthy|recovered|ok/i.test(stateLabel)) stateColor = 'green-fg';
            const detailColor = /fail|error|abort|mismatch/i.test(detailLabel) ? 'red-fg' : 'white-fg';
            return `| {white-fg}{bold}${stageLabel}{/bold}{/} | {${stateColor}}${stateLabel}{/} | {${detailColor}}${detailLabel}{/} |`;
          }
        );
        display = display.replace(
          /^-\s*(💥 Root Cause|📜 Evidence|📡 Impact|🛠 Fix|✅ Healthy Signals|🔭 Watch Next):(.*)$/gm,
          (_line, label: string, rest: string) => {
            const details = rest.trim();
            const formattedDetails = details ? ` {white-fg}${details}{/}` : '';
            return `{yellow-fg}{bold}- ${label}:{/bold}{/}${formattedDetails}`;
          }
        );
        display = display
          .replace(/\b(FATAL|FAILURE|FAILED|ERROR)\b/gi, '{red-fg}{bold}$1{/bold}{/}')
          .replace(/\b(SKIPPED|SKIP|BLOCKED)\b/gi, '{yellow-fg}$1{/}')
          .replace(/\b(PASS(?:ED)?|SUCCESS|HEALTHY)\b/gi, '{green-fg}$1{/}');

         display = display
           .replace(/`([^`]+)`/g, '{bold}$1{/}') // highlight inline code
           .replace(/\*\*([^*]+)\*\*/g, '{bold}$1{/}'); // basic bold support (e.g. **stderr**)
         analysisBox.setContent(display.trim() ? display : '{gray-fg}(No output yet){/}');
         screen.render();
       };

       const scheduleRender = () => {
         const now = Date.now();
         if (now - analysisLastRender > 150) {
           analysisLastRender = now;
           renderNow();
         } else {
           if (analysisUpdateTimer) clearTimeout(analysisUpdateTimer);
           analysisUpdateTimer = setTimeout(() => { analysisLastRender = Date.now(); renderNow(); }, 180);
         }
       };

       const appendAnalysisText = (text: string) => {
         if (!text) { return; }
         analysisRawMarkdown += text;
         scheduleRender();
       };

       const stdin = aiChildProcess.stdin;
       if (stdin) {
         stdin.on('error', () => { /* ignore broken pipe if process exits early */ });
         const promptStream = fs.createReadStream(promptFile);
         promptStream.on('error', (err) => {
           appendAnalysisText(`\n**stderr**: Failed to load prompt: ${err.message}\n`);
           try { stdin.end(); } catch { /* ignore */ }
         });
         promptStream.pipe(stdin);
       }

       const seenTextChunkIds = new Set<string>();

       const markTextEventProcessed = (event: any, extraIds: (string | undefined)[] = []): boolean => {
         if (!event || typeof event !== 'object') { return false; }
         const extra = extraIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
         const identifiers = [
           event.part?.id,
           event.part?.messageID,
           event.text?.id,
           event.text?.messageID,
           event.messageID,
           ...extra
         ] as string[];
         if (identifiers.length === 0) { return false; }
         const alreadySeen = identifiers.some(id => seenTextChunkIds.has(id));
         if (!alreadySeen) {
           identifiers.forEach(id => seenTextChunkIds.add(id));
         }
         return alreadySeen;
       };

       const gatherText = (value: any, depth = 0, seen = new WeakSet<object>()): string => {
         if (depth > 6 || value == null) { return ''; }
         if (typeof value === 'string') { return value; }
         if (typeof value === 'number') { return value.toString(); }
         if (typeof value === 'boolean') { return value ? 'true' : ''; }
         if (Array.isArray(value)) {
           return value.map(v => gatherText(v, depth + 1, seen)).filter(Boolean).join('');
         }
         if (typeof value === 'object') {
           if (seen.has(value)) { return ''; }
           seen.add(value);

           const priorityKeys = ['text', 'message', 'content', 'delta', 'output', 'output_text', 'arguments', 'data', 'body', 'response'];
           let out = '';
           for (const key of priorityKeys) {
             if (key in value) {
               out += gatherText((value as any)[key], depth + 1, seen);
             }
           }
           if (!out) {
             for (const key of Object.keys(value as object)) {
               if (priorityKeys.includes(key)) { continue; }
               out += gatherText((value as any)[key], depth + 1, seen);
             }
           }
           return out;
         }
         return '';
       };

       const handleJsonLine = (line: string): boolean => {
         try {
           const event = JSON.parse(line);
           if (!event || typeof event !== 'object') { return false; }

           const type = (event.type || event.event || '').toString();
           let handled = false;
           let skipFallback = false;
           let text = '';

           switch (type) {
             case 'text': {
               if (markTextEventProcessed(event)) {
                 skipFallback = true;
                 break;
               }
               text = gatherText(event.text ?? event.part?.text ?? event.part);
               break;
             }
             case 'response_delta': {
               text = gatherText(event.delta?.delta?.content ?? event.delta?.content ?? event.delta?.text);
               break;
             }
             case 'tool_call_delta':
             case 'tool_output': {
               text = gatherText(event.delta?.delta?.output ?? event.delta?.output ?? event.output);
               break;
             }
             case 'message': {
               text = gatherText(event.message?.content ?? event.message);
               break;
             }
             case 'response': {
               const responseIds = [
                 event.response?.message?.id,
                 event.response?.message?.messageID,
                 event.response?.id
               ];
               if (markTextEventProcessed(event, responseIds)) {
                 skipFallback = true;
                 handled = true;
                 break;
               }
               text = gatherText(
                 event.response?.message?.content ??
                 event.response?.output_text ??
                 event.response?.content
               );
               break;
             }
             default:
               break;
           }

           if (text) {
             appendAnalysisText(text);
             handled = true;
           }

           if (!handled && type === 'status' && typeof event.message === 'string') {
             appendAnalysisText(`\n[status] ${event.message}\n`);
             handled = true;
             skipFallback = true;
           }

           if (!handled && /^step_/.test(type)) {
             handled = true; // ignore step bookkeeping events
             skipFallback = true;
           }

           if (!handled && type === 'error') {
             const msg = event.message || event.error || line;
             appendAnalysisText(`\n**stderr**: ${msg}\n`);
             handled = true;
             skipFallback = true;
           }

           return handled;
         } catch {
           return false;
         }
       };

       let stdoutBuffer = '';
       const flushStdoutBuffer = () => {
         const remainingRaw = stdoutBuffer;
         stdoutBuffer = '';
         const trimmed = remainingRaw.trim();
         if (!trimmed) { return; }
         handleJsonLine(trimmed);
       };

       aiChildProcess.stdout.on('data', chunk => {
         stdoutBuffer += sanitizeChunk(chunk.toString());
         let newlineIndex: number;
         while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
           const line = stdoutBuffer.slice(0, newlineIndex);
           stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
           const trimmed = line.trim();
           if (!trimmed) { continue; }
           handleJsonLine(trimmed);
         }
       });
       aiChildProcess.stderr.on('data', chunk => {
         appendAnalysisText(`\n**stderr**: ${sanitizeChunk(chunk.toString())}\n`);
       });
       aiChildProcess.on('close', code => {
         flushStdoutBuffer();
         if (analysisUpdateTimer) { clearTimeout(analysisUpdateTimer); analysisUpdateTimer = null; }
         fs.unlink(promptFile, () => { /* ignore cleanup errors */ });
         if (analysisBox) {
           const finalLabel = ` AI Analysis (${model}) - ${code === 0 ? 'Complete' : 'Exited ('+code+')'} (ESC to close) `;
           analysisBox.setLabel(finalLabel);
           renderNow();
         }
         aiChildProcess = null;
         setStatus(code === 0 ? '{green-fg}AI analysis complete{/}' : `{red-fg}AI analysis exited code ${code}{/}`);
      });

      (analysisBox as any).key(['escape','q','x'], () => { closeAnalysisModal(); });
      (analysisBox as any).key(['D'], () => {
        try {
          const out = require('path').join(require('os').tmpdir(), 'jenkins-ai-debug-' + Date.now() + '.txt');
          require('fs').writeFileSync(out, analysisRawMarkdown);
          setStatus(`{yellow-fg}Dumped AI raw to ${out}{/}`);
        } catch (e:any) {
          setStatus(`{red-fg}Dump failed: ${e.message}{/}`);
        }
      });

    } catch (error: any) {
      setStatus(`{red-fg}AI analysis error: ${error.message}{/}`);
      if (analysisBox) {
        analysisBox.setContent(`{red-fg}Error starting analysis{/}\n\n${error.message}`);
        screen.render();
      }
    }
  };

  // Key binding to trigger AI streaming analysis (auto model selection)
  screen.key('x', () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox) return;
    if (analysisBox) { setStatus('{yellow-fg}AI analysis already running{/}'); return; }
    performAIAnalysis();
  });

  screen.key(['C-a'], () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox || analysisBox) return;
    openActionsMenu();
  });

  // Pipeline diagram view
  screen.key('p', async () => {
    if (isTyping() || helpBox || artifactBox || pipelineBox || actionBox || analysisBox) return;
    await togglePipelineView();
  });

  // Pane navigation shortcuts (adjusted for single-job mode)
  screen.key(['left'], () => {
    if (isTyping()) return;
    if (artifactBox || helpBox || pipelineBox || actionBox) return; // don't steal focus
    if (singleJobMode) {
      if (logBox.focused) { buildsBox.focus(); showPaneFeedback('builds'); }
    } else {
      if (logBox.focused) { buildsBox.focus(); showPaneFeedback('builds'); }
      else if (buildsBox.focused) { jobsBox.focus(); showPaneFeedback('jobs'); }
    }
    setStatus();
    screen.render();
  });
  screen.key(['right'], () => {
    if (isTyping()) return;
    if (artifactBox || helpBox || pipelineBox || actionBox) return;
    if (singleJobMode) {
      if (buildsBox.focused) { logBox.focus(); showPaneFeedback('logs'); }
    } else {
      if (jobsBox.focused) { buildsBox.focus(); showPaneFeedback('builds'); }
      else if (buildsBox.focused) { logBox.focus(); showPaneFeedback('logs'); }
    }
    setStatus();
    screen.render();
  });
  screen.key('1', () => { if (isTyping()) return; if (!artifactBox && !helpBox && !pipelineBox && !actionBox && !singleJobMode) { jobsBox.focus(); showPaneFeedback('jobs'); setStatus(); screen.render(); } });
  screen.key('2', () => { if (isTyping()) return; if (!artifactBox && !helpBox && !pipelineBox && !actionBox) { buildsBox.focus(); showPaneFeedback('builds'); setStatus(); screen.render(); } });
  screen.key('3', () => { if (isTyping()) return; if (!artifactBox && !helpBox && !pipelineBox && !actionBox) { logBox.focus(); showPaneFeedback('logs'); setStatus(); screen.render(); } });

  screen.key('c', () => {
    if (isTyping()) return;
    buildTextFilter=''; buildSearchQuery=''; logSearchQuery=''; resultFilterIdx=0; 
    applyBuildFilters(); setStatus('All filters cleared');
    inputMode = 'none';
  });

  // Help popup
  screen.key('?', () => {
    if (isTyping()) return;
    if (helpBox) { helpBox.destroy(); helpBox = null; screen.render(); return; }
    helpBox = blessed.box({ parent: screen, width: '90%', height: '80%', top: 'center', left: 'center', border: 'line', label: ' Help ', scrollable: true, keys: true, mouse: true, tags: true, content: `{bold}Navigation & Actions{/bold}:
{bold}q{/bold} quit   {bold}r{/bold} refresh   {bold}f{/bold} follow toggle   {bold}w{/bold} open in browser (or wrap in logs)   {bold}a{/bold} artifacts   {bold}p{/bold} pipeline view (ASCII)
{bold}Ctrl+A{/bold} build actions menu
{bold}←/→{/bold} pane focus   {bold}1{/bold}/{bold}2{/bold}/{bold}3{/bold} jump to Jobs/Builds/Logs
{bold}S{/bold} toggle sort asc/desc   {bold}t{/bold} toggle auto-refresh   {bold}o{/bold} folders-only
{bold}x{/bold} AI streaming analysis (requires opencode; ESC to close)

{bold}Search & Filtering{/bold}:
{bold}s{/bold} search (context-aware: jobs/builds/logs)
{bold}b{/bold} build text filter   {bold}B{/bold} build fuzzy search
{bold}F{/bold} cycle result filter (ALL/RUNNING/FAILED/SUCCESS)
{bold}c{/bold} clear all filters   {bold}L{/bold} set job limit

{bold}Log Search & Navigation{/bold}:
{bold}n{/bold} next match   {bold}N{/bold} previous match   {bold}s{/bold} search in logs
{bold}g{/bold} jump to top   {bold}G{/bold} jump to bottom
{bold}e{/bold} jump to errors   {bold}W{/bold} jump to warnings   {bold}i{/bold} jump to info

{bold}Log Bookmarks & Display{/bold}:
{bold}m{/bold} toggle bookmark   {bold}M{/bold} next bookmark
{bold}l{/bold} toggle line numbers   {bold}R{/bold} reverse log order (newest/oldest first)
{bold}z{/bold} toggle fullscreen logs

{bold}Enhanced Features{/bold}:
• Logs show newest first by default (toggle with R)
• Fullscreen mode (z) for focused log viewing
• AI-powered log analysis (x) with opencode
• Build actions (Ctrl+A) to stop or rerun
• Pipeline tree (p) shows stage status diagram
• Line numbers with bookmarks (📌)
• Syntax highlighting with emojis
• Log level statistics and navigation
• Visual scrollbar
• Timestamp extraction
• Performance optimized rendering

{bold}Legend{/bold}: {yellow-fg}RUNNING{/} {green-fg}SUCCESS{/} {red-fg}FAILURE{/} {magenta-fg}UNSTABLE{/} {cyan-fg}ABORTED{/}` });
    helpBox.key(['q','escape','?'], () => { if (helpBox) { helpBox.destroy(); helpBox = null; screen.render(); } });
    screen.render();
  });
  screen.key('escape', () => {
    // If AI analysis is active, restore original logs immediately.
    if (analysisBox) { closeAnalysisModal(); return; }
    if (actionBox) { closeActionModal(); return; }
    if (isClassicTypingActive()) {
      deactivateClassicTyping();
    }
    if (searchMode) {
      searchMode = false; searchQuery=''; applyJobFilter(); setStatus(); inputMode = 'none';
    } else if (buildFilterMode) {
      buildFilterMode = false; buildTextFilter=''; applyBuildFilters(); setStatus(); inputMode = 'none';
    } else if (buildSearchMode) {
      buildSearchMode = false; buildSearchQuery=''; applyBuildFilters(); setStatus(); inputMode = 'none';
    } else if (logSearchMode || logSearchQuery) {
      // Clear search and restore original logs
      logSearchMode = false;
      logSearchQuery='';
      logSearchMatches=[];
      logSearchIndex=-1;
      inputMode = 'none';

      // Restore original log content without search
      if (logRawText && logCurrentBuild) {
        const processed = processLogContent(logRawText, logCurrentBuild);
        logLines = processed.lines;
        logBox.setContent(processed.formattedContent);
        logBox.setScrollPerc(0);
        screen.render();
      }

      setStatus();
    } else {
      inputMode = 'none';
      setStatus();
    }
  });
  
  // Initialize with helpful empty states
  if (!singleJobMode) {
    jobsBox.setItems(['{gray-fg}Initializing...{/}']);
  }
  buildsBox.setItems(['{gray-fg}Select a job to view builds{/}']);
  logBox.setContent(`{gray-fg}${singleJobMode ? 'Select a build to view its logs' : 'Select a job and build to view logs'}{/}`);

  await refreshJobs();
  await refreshBuilds();
  if (builds && builds.length > 0 && builds[0]) {
    loadLogs(builds[0].number);
  }
  setStatus('{green-fg}Ready{/}');

  // Set initial focus - builds panel for single-job mode, jobs panel otherwise
  if (singleJobMode) {
    buildsBox.focus();
  } else {
    jobsBox.focus();
  }
  screen.render();

  // Restore original console functions after initialization
  console.error = originalConsoleError;
  process.stderr.write = originalProcessStderr;
}
