/**
 * Logger Utility with Level-based Filtering
 * 
 * Environment variable: LOG_LEVEL
 * Possible values: error, warn, info, debug, trace
 * Default: info (production) / debug (development)
 */

// ANSI color codes
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
  };
  
  // Log levels with priority
  const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    trace: 4,
  };
  
  // Level configurations
  const LEVEL_CONFIG = {
    error: { color: COLORS.red, label: 'ERROR' },
    warn: { color: COLORS.yellow, label: 'WARN ' },
    info: { color: COLORS.blue, label: 'INFO ' },
    debug: { color: COLORS.magenta, label: 'DEBUG' },
    trace: { color: COLORS.cyan, label: 'TRACE' },
  };
  
  class Logger {
    constructor() {
      // Determine current log level from environment
      const envLevel = process.env.LOG_LEVEL?.toLowerCase();
      const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
      
      this.currentLevel = LOG_LEVELS[envLevel] !== undefined ? envLevel : defaultLevel;
      this.currentLevelValue = LOG_LEVELS[this.currentLevel];
      this.useColors = process.env.NO_COLOR !== '1' && process.stdout.isTTY;
    }
  
    /**
     * Get caller location (file and line number)
     */
    getCallerInfo() {
      const originalPrepareStackTrace = Error.prepareStackTrace;
      try {
        const err = new Error();
        Error.prepareStackTrace = (_, stack) => stack;
        const stack = err.stack;
        
        // Skip first 3 frames: Error, getCallerInfo, log method, actual caller
        const caller = stack[3];
        
        if (caller) {
          const fileName = caller.getFileName();
          const lineNumber = caller.getLineNumber();
          const columnNumber = caller.getColumnNumber();
          
          // Extract just the filename from the full path
          const fileNameShort = fileName ? fileName.split('/').pop() : 'unknown';
          return `${fileNameShort}:${lineNumber}:${columnNumber}`;
        }
      } catch (e) {
        // Fallback if stack trace fails
        return 'unknown';
      } finally {
        Error.prepareStackTrace = originalPrepareStackTrace;
      }
      return 'unknown';
    }
  
    /**
     * Format timestamp
     */
    getTimestamp() {
      const now = new Date();
      const pad = (num) => String(num).padStart(2, '0');
      
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
             `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    }
  
    /**
     * Pretty print objects
     */
    formatValue(value) {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value, null, 2);
        } catch (e) {
          return '[Object with circular reference]';
        }
      }
      
      return String(value);
    }
  
    /**
     * Check if current level should log
     */
    shouldLog(level) {
      return LOG_LEVELS[level] <= this.currentLevelValue;
    }
  
    /**
     * Core logging function
     */
    log(level, ...args) {
      if (!this.shouldLog(level)) {
        return;
      }
  
      // Process lazy evaluation functions
      const processedArgs = args.map(arg => {
        if (typeof arg === 'function') {
          try {
            return arg();
          } catch (e) {
            return `[Error evaluating lazy function: ${e.message}]`;
          }
        }
        return arg;
      });
  
      const config = LEVEL_CONFIG[level];
      const timestamp = this.getTimestamp();
      const caller = this.getCallerInfo();
      
      // Format message parts
      const timestampStr = this.useColors ? `${COLORS.gray}${timestamp}${COLORS.reset}` : timestamp;
      const levelStr = this.useColors ? `${config.color}[${config.label}]${COLORS.reset}` : `[${config.label}]`;
      const callerStr = this.useColors ? `${COLORS.gray}(${caller})${COLORS.reset}` : `(${caller})`;
      
      // Format message content
      const messageContent = processedArgs.map(arg => this.formatValue(arg)).join(' ');
      
      // Construct final message
      const finalMessage = `${timestampStr} ${levelStr} ${callerStr} ${messageContent}`;
      
      // Output to appropriate stream
      if (level === 'error' || level === 'warn') {
        console.error(finalMessage);
      } else {
        console.log(finalMessage);
      }
    }
  
    /**
     * Error level logging
     */
    error(...args) {
      this.log('error', ...args);
    }
  
    /**
     * Warning level logging
     */
    warn(...args) {
      this.log('warn', ...args);
    }
  
    /**
     * Info level logging
     */
    info(...args) {
      this.log('info', ...args);
    }
  
    /**
     * Debug level logging
     */
    debug(...args) {
      this.log('debug', ...args);
    }
  
    /**
     * Trace level logging
     */
    trace(...args) {
      this.log('trace', ...args);
    }
  
    /**
     * Get current log level
     */
    getLevel() {
      return this.currentLevel;
    }
  
    /**
     * Set log level programmatically
     */
    setLevel(level) {
      if (LOG_LEVELS[level] !== undefined) {
        this.currentLevel = level;
        this.currentLevelValue = LOG_LEVELS[level];
      } else {
        throw new Error(`Invalid log level: ${level}. Valid levels: ${Object.keys(LOG_LEVELS).join(', ')}`);
      }
    }
  }
  
  // Create singleton instance
  const logger = new Logger();
  
  // Export singleton and class
  export default logger;
  export { Logger, LOG_LEVELS };