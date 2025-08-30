const { Telegraf } = require("telegraf");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const os = require("os"); // Added for network monitoring

// Bot token from environment
const BOT_TOKEN = process.env.BOT_TOKEN || "your_bot_token_here";
const REPO_URL = "https://github.com/adamfarreledu-cloud/java.git";
const REPO_DIR = "./java";

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// User session storage
const userSessions = new Map();

// Simple progress tracking
const progressTimers = new Map(); // userId -> intervalId
const PROGRESS_INTERVAL = 60000; // Send progress every 60 seconds (reduced frequency)
const errorCounts = new Map(); // Track error counts per user

// PATCH: Enhanced rate limiting for Telegram API calls
const messageQueue = new Map(); // userId -> array of pending messages
const rateLimitDelay = 5000; // PATCH: Changed to 5 seconds as requested
const processingQueue = new Set(); // Track which users are being processed

// PATCH: Message deduplication tracking
const sentMessages = new Map(); // userId -> Set of message hashes
const MESSAGE_DEDUPE_WINDOW = 30000; // 30 seconds window for deduplication

// PATCH: Speed monitoring variables
const speedMonitors = new Map(); // userId -> speed monitoring data
const SPEED_UPDATE_INTERVAL = 120000; // 2 minutes as requested
const speedTimers = new Map(); // userId -> speed timer interval

// PATCH: Error retry tracking for system error -122
const retryAttempts = new Map(); // userId -> retry count
const MAX_RETRY_ATTEMPTS = 5;

// Bot states
const STATES = {
  IDLE: "idle",
  AWAITING_CONSENT: "awaiting_consent",
  AWAITING_API_ID: "awaiting_api_id",
  AWAITING_API_HASH: "awaiting_api_hash",
  AWAITING_PHONE: "awaiting_phone",
  AWAITING_OTP: "awaiting_otp",
  AWAITING_CHANNEL: "awaiting_channel",
  AWAITING_OPTION: "awaiting_option",
  AWAITING_DESTINATION: "awaiting_destination",
  PROCESSING: "processing",
};

// Progress tracking for web dashboard
let globalProgress = {
  status: "idle",
  task: "Waiting for user commands",
  completed: 0,
  total: 100,
  activeUsers: 0,
  lastUpdate: new Date().toISOString(),
};

// PATCH: Network speed monitoring functions
function getNetworkStats() {
  return new Promise((resolve, reject) => {
    exec("cat /proc/net/dev", (error, stdout, stderr) => {
      if (error) {
        // Fallback for systems without /proc/net/dev
        resolve({ download: 0, upload: 0, timestamp: Date.now() });
        return;
      }
      
      const lines = stdout.split('\n');
      let totalRx = 0, totalTx = 0;
      
      for (const line of lines) {
        if (line.includes(':') && !line.includes('lo:')) { // Skip loopback
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            totalRx += parseInt(parts[1]) || 0; // Received bytes
            totalTx += parseInt(parts[9]) || 0; // Transmitted bytes
          }
        }
      }
      
      resolve({
        download: totalRx,
        upload: totalTx,
        timestamp: Date.now()
      });
    });
  });
}

async function calculateSpeed(userId) {
  const currentStats = await getNetworkStats();
  const previousStats = speedMonitors.get(userId)?.previousStats;
  
  if (!previousStats) {
    speedMonitors.set(userId, { 
      previousStats: currentStats,
      isActive: true 
    });
    return { download: 0, upload: 0, total: 0 };
  }
  
  const timeDiff = (currentStats.timestamp - previousStats.timestamp) / 1000; // seconds
  const downloadSpeed = (currentStats.download - previousStats.download) / timeDiff; // bytes/sec
  const uploadSpeed = (currentStats.upload - previousStats.upload) / timeDiff; // bytes/sec
  
  // Update previous stats
  speedMonitors.get(userId).previousStats = currentStats;
  
  return {
    download: Math.max(0, downloadSpeed / 1024 / 1024), // MB/s
    upload: Math.max(0, uploadSpeed / 1024 / 1024), // MB/s
    total: Math.max(0, (downloadSpeed + uploadSpeed) / 1024 / 1024) // MB/s
  };
}

function startSpeedMonitoring(ctx, userId) {
  // Initialize speed monitoring
  speedMonitors.set(userId, { isActive: true });
  
  // Send initial message
  sendRateLimitedMessage(ctx, "⏳ Download started...");
  
  const speedTimer = setInterval(async () => {
    try {
      const monitor = speedMonitors.get(userId);
      if (!monitor || !monitor.isActive) {
        clearInterval(speedTimer);
        speedTimers.delete(userId);
        return;
      }
      
      const speeds = await calculateSpeed(userId);
      
      const speedMessage = `📊 Current Internet Speed:
- Download: ${speeds.download.toFixed(1)} MB/s
- Upload: ${speeds.upload.toFixed(1)} MB/s
- Total: ${speeds.total.toFixed(1)} MB/s
(Updates every 2 min)`;

      sendRateLimitedMessage(ctx, speedMessage);
    } catch (error) {
      console.log("Error calculating speed:", error.message);
    }
  }, SPEED_UPDATE_INTERVAL);
  
  speedTimers.set(userId, speedTimer);
}

function stopSpeedMonitoring(userId) {
  const monitor = speedMonitors.get(userId);
  if (monitor) {
    monitor.isActive = false;
  }
  
  if (speedTimers.has(userId)) {
    clearInterval(speedTimers.get(userId));
    speedTimers.delete(userId);
  }
}

// PATCH: Message deduplication function
function getMessageHash(message) {
  // Create a simple hash of the message for deduplication
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
}

function isDuplicateMessage(userId, message) {
  const hash = getMessageHash(message);
  
  if (!sentMessages.has(userId)) {
    sentMessages.set(userId, new Set());
  }
  
  const userHashes = sentMessages.get(userId);
  
  if (userHashes.has(hash)) {
    return true; // Duplicate found
  }
  
  userHashes.add(hash);
  
  // Clean old hashes after window expires
  setTimeout(() => {
    userHashes.delete(hash);
  }, MESSAGE_DEDUPE_WINDOW);
  
  return false;
}

// PATCH: Enhanced write operation with retry for error -122
async function retryWrite(operation, userId, ctx, maxRetries = MAX_RETRY_ATTEMPTS) {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      await operation();
      // Reset retry count on success
      retryAttempts.delete(userId);
      return true;
    } catch (error) {
      attempts++;
      
      if (error.errno === -122 || error.code === 'Unknown system error -122') {
        console.log(`⚠️ System error -122 detected (attempt ${attempts}/${maxRetries})`);
        
        if (attempts < maxRetries) {
          const waitTime = Math.min(2000 + (attempts * 1000), 5000); // 2-5 seconds
          await sendRateLimitedMessage(ctx, 
            `⚠️ Warning: Write operation failed with system error -122.\nRetrying in ${waitTime/1000} seconds...`
          );
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        } else {
          await sendRateLimitedMessage(ctx, 
            `❌ Error: Persistent write failure (system error -122).\nAction: Skipped this write. Bot is still running.`
          );
          retryAttempts.set(userId, 0);
          return false;
        }
      } else {
        // Re-throw non-122 errors
        throw error;
      }
    }
  }
  
  return false;
}

// Clone repository on startup
async function cloneRepository() {
  return new Promise((resolve, reject) => {
    // Remove existing directory if it exists
    if (fs.existsSync(REPO_DIR)) {
      exec(`rm -rf ${REPO_DIR}`, (error) => {
        if (error) {
          console.error("Error removing existing directory:", error);
          // Don't fail on cleanup error, try to continue
          console.warn("Continuing despite cleanup error...");
        }
        performClone();
      });
    } else {
      performClone();
    }

    function performClone() {
      // Add timeout and better error handling for cloud environments
      const cloneCommand = `timeout 60 git clone --depth 1 ${REPO_URL}`;
      exec(cloneCommand, { timeout: 65000 }, (error, stdout, stderr) => {
        if (error) {
          console.error("Error cloning repository:", error);
          console.error("STDERR:", stderr);
          // Try fallback without timeout for Render compatibility
          exec(
            `git clone --depth 1 ${REPO_URL}`,
            (fallbackError, fallbackStdout) => {
              if (fallbackError) {
                console.error(
                  "Fallback clone also failed:",
                  fallbackError,
                );
                reject(fallbackError);
                return;
              }
              console.log(
                "Repository cloned successfully (fallback)",
              );
              console.log(fallbackStdout);
              installDependencies();
            },
          );
          return;
        }
        console.log("Repository cloned successfully");
        console.log(stdout);
        installDependencies();
      });
      
      function installDependencies() {
        console.log("Installing CLI script dependencies...");
        exec(`cd ${REPO_DIR} && npm install`, { timeout: 120000 }, (error, stdout, stderr) => {
          if (error) {
            console.error("Error installing dependencies:", error);
            console.error("STDERR:", stderr);
            console.warn("⚠️ Dependencies installation failed, but continuing...");
          } else {
            console.log("✅ CLI script dependencies installed successfully");
            console.log(stdout);
          }
          resolve();
        });
      }
    }
  });
}

// Get or create user session
function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      state: STATES.IDLE,
      process: null,
      phone: null,
      channel: null,
      option: null,
      destination: null,
      apiId: null,
      apiHash: null,
      progressMessageId: null,
    });
  }
  return userSessions.get(userId);
}

// Update global progress (called when bot processes tasks)
function updateProgress(status, task, completed = 0, total = 100) {
  globalProgress = {
    status,
    task,
    completed,
    total,
    activeUsers: userSessions.size,
    lastUpdate: new Date().toISOString(),
  };
  console.log(
    `📊 Progress Update: ${status} - ${task} (${completed}/${total})`,
  );
}

// Start simple progress timer
function startProgressTimer(ctx, userId) {
  // Clear any existing timer
  if (progressTimers.has(userId)) {
    clearInterval(progressTimers.get(userId));
  }

  // Initialize error counter for this user
  if (!errorCounts.has(userId)) {
    errorCounts.set(userId, { total: 0, fileExpired: 0, timeout: 0 });
  }

  // Send progress message every 60 seconds with summary
  const timerId = setInterval(() => {
    try {
      const errors = errorCounts.get(userId) || {
        total: 0,
        fileExpired: 0,
        timeout: 0,
      };

      let statusMessage =
        "⏳ Processing... Downloads continuing in background.";

      if (errors.total > 0) {
        statusMessage += `\n📊 Status: ${errors.total} auto-retries (${errors.fileExpired} file refs, ${errors.timeout} timeouts)`;
      }

      sendRateLimitedMessage(ctx, statusMessage);
    } catch (error) {
      console.log("Error sending progress message:", error.message);
    }
  }, PROGRESS_INTERVAL);

  progressTimers.set(userId, timerId);
}

// Stop progress timer
function stopProgressTimer(userId) {
  if (progressTimers.has(userId)) {
    clearInterval(progressTimers.get(userId));
    progressTimers.delete(userId);
  }
}

// PATCH: Enhanced rate-limited message sending with 5-second delay and deduplication
async function sendRateLimitedMessage(ctx, message, retries = 3) {
  const userId = ctx.from.id;
  
  // PATCH: Check for duplicate messages
  if (isDuplicateMessage(userId, message)) {
    console.log("Duplicate message detected, skipping:", message.substring(0, 50) + "...");
    return Promise.resolve(true);
  }

  // Add message to queue
  if (!messageQueue.has(userId)) {
    messageQueue.set(userId, []);
  }

  return new Promise((resolve, reject) => {
    messageQueue
      .get(userId)
      .push({ message, retries, resolve, reject, ctx });
    processMessageQueue(userId);
  });
}

// PATCH: Enhanced message queue processing with 5-second delays
async function processMessageQueue(userId) {
  if (processingQueue.has(userId)) return; // Already processing

  processingQueue.add(userId);
  const queue = messageQueue.get(userId) || [];

  while (queue.length > 0) {
    const { message, retries, resolve, reject, ctx } = queue.shift();

    try {
      // PATCH: Wrap in retry logic for error -122
      const writeOperation = async () => {
        await ctx.reply(message);
      };
      
      const success = await retryWrite(writeOperation, userId, ctx);
      
      if (success) {
        resolve(true);
      } else {
        resolve(false); // Failed after retries
      }

      // PATCH: Rate limit with 5-second delay as requested
      if (queue.length > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, rateLimitDelay), // Now 5 seconds
        );
      }

    } catch (error) {
      if (error.message.includes("429") && retries > 0) {
        // Handle rate limit with exponential backoff
        const waitTime = error.response?.parameters?.retry_after || 15;
        console.log(
          `⏳ Rate limited (429), waiting ${waitTime} seconds before retry...`,
        );
        // Increase wait time to prevent further rate limiting
        const actualWaitTime = Math.max(waitTime * 1000, 15000); // At least 15 seconds
        await new Promise((resolve) =>
          setTimeout(resolve, actualWaitTime),
        );

        // Re-queue with reduced retries
        queue.unshift({
          message,
          retries: retries - 1,
          resolve,
          reject,
          ctx,
        });
        continue;
      } else if (retries > 0 && !error.message.includes("403")) {
        // Retry other errors (except blocked/forbidden)
        console.log(
          `⚠️ Message send failed, retrying... (${retries} attempts left)`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        queue.unshift({
          message,
          retries: retries - 1,
          resolve,
          reject,
          ctx,
        });
        continue;
      } else {
        // Log error but don't crash
        console.error(
          `❌ Failed to send message after all retries: ${error.message}`,
        );
        resolve(false); // Resolve as failed instead of rejecting
      }
    }
  }

  processingQueue.delete(userId);
}

// Kill user process if exists
function killUserProcess(userId) {
  const session = getUserSession(userId);

  if (session.process && !session.process.killed) {
    session.process.kill("SIGTERM");
    session.process = null;
  }

  // Clear progress timer for this user
  stopProgressTimer(userId);
  
  // PATCH: Stop speed monitoring when process ends
  stopSpeedMonitoring(userId);
}

// Start command
bot.command("start", (ctx) => {
  const session = getUserSession(ctx.from.id);
  killUserProcess(ctx.from.id);
  session.state = STATES.AWAITING_CONSENT;

  // UPDATE PROGRESS: User started bot session
  updateProgress("active", "User starting authentication process", 0, 100);

  ctx.reply(
    "🚨 *SECURITY WARNING* 🚨\n\n" +
      "This bot will:\n" +
      "• Log into your Telegram account using YOUR API credentials\n" +
      "• Access your messages and media\n" +
      "• Download/upload files using your account\n\n" +
      "⚠️ Only proceed if you trust this bot completely.\n\n" +
      "📋 You will need:\n" +
      "• Your Telegram API ID\n" +
      "• Your Telegram API Hash\n" +
      "(Get these from https://my.telegram.org/auth)\n\n" +
      'Type "I CONSENT" to continue or /cancel to abort.',
    { parse_mode: "Markdown" },
  );
});

// Cancel command
bot.command("cancel", (ctx) => {
  const session = getUserSession(ctx.from.id);
  killUserProcess(ctx.from.id);
  session.state = STATES.IDLE;

  ctx.reply("❌ Operation cancelled. Use /start to begin again.");
});

// Status command
bot.command("status", (ctx) => {
  const session = getUserSession(ctx.from.id);
  ctx.reply(`Current state: ${session.state}`);
});

// Update config file with user credentials
function updateConfigFile(apiId, apiHash) {
  const configPath = path.join(REPO_DIR, "config.json");
  const config = {
    apiId: parseInt(apiId),
    apiHash: apiHash,
    sessionId: "",
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Spawn CLI process
function spawnCliProcess(userId, ctx) {
  const session = getUserSession(userId);

  // Update config file with user's API credentials
  updateConfigFile(session.apiId, session.apiHash);

  // Change to repository directory and run the script
  const process = spawn("node", ["index.js"], {
    cwd: REPO_DIR,
    stdio: ["pipe", "pipe", "pipe"],
  });

  session.process = process;

  // Handle stdout
  process.stdout.on("data", (data) => {
    let output = data.toString();

    // Clean ANSI escape codes and control characters
    output = output
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // Remove ANSI escape sequences
      .replace(/\x1b\[[0-9]*[ABCD]/g, "") // Remove cursor movement
      .replace(/\x1b\[[0-9]*[JK]/g, "") // Remove clear sequences
      .replace(/\x1b\[[0-9]*[G]/g, "") // Remove cursor positioning
      .replace(/\r/g, "") // Remove carriage returns
      .replace(/\n+/g, "\n") // Normalize newlines
      .trim();

    if (output) {
      const userId = ctx.from.id;

      // MINIMAL MODE: Only filter the most basic spam, pass through almost everything
      if (
        // Only filter inquirer.js live typing feedback - everything else goes through
        output.match(/^\?\s.*:\s+\d{1,6}$/) && output.split(":")[1]?.trim().length < 8
      ) {
        // Skip only very short live typing feedback
      } else if (output.includes("FILE_REFERENCE_EXPIRED")) {
        // Handle file reference expired errors silently - script auto-retries
        console.log(
          `📋 File reference expired for a message, script will retry automatically`,
        );
        // Track error count for summary
        const userId = ctx.from.id;
        if (!errorCounts.has(userId)) {
          errorCounts.set(userId, {
            total: 0,
            fileExpired: 0,
            timeout: 0,
          });
        }
        const errorCount = errorCounts.get(userId);
        errorCount.total++;
        errorCount.fileExpired++;
      } else if (output.includes("TIMEOUT")) {
        // Handle timeout errors
        console.log(`⏰ Timeout error detected, script will retry`);
        const userId = ctx.from.id;
        if (!errorCounts.has(userId)) {
          errorCounts.set(userId, {
            total: 0,
            fileExpired: 0,
            timeout: 0,
            connection: 0,
          });
        }
        const errorCount = errorCounts.get(userId);
        errorCount.total++;
        errorCount.timeout++;
      } else if (output.includes("Not connected") || 
                 output.includes("Connection closed") || 
                 output.includes("reconnecting") ||
                 output.includes("ConnectionTCPFull.recv") ||
                 output.includes("MTProtoSender") ||
                 output.includes("hanging states") ||
                 output.includes("sender already has")) {
        // ENHANCED: Completely suppress all connection-related errors - script handles them
        console.log(`🔗 Connection error detected (suppressed for user)`);
        // Don't send these errors to user at all
      } else if (
        output.includes("Enter phone number") ||
        output.includes("Enter the OTP") ||
        output.includes("Select a channel") ||
        output.includes("Choose an option") ||
        output.includes("Enter destination")
      ) {
        // Important prompts - always send
        sendRateLimitedMessage(ctx, output);
      } else if (output.length > 10) {
        // PATCH: Apply deduplication to other messages
        sendRateLimitedMessage(ctx, output);
      }
    }
  });

  // Handle stderr
  process.stderr.on("data", (data) => {
    const error = data.toString().trim();
    if (error) {
      console.error("CLI Error:", error);
      
      // PATCH: Suppress connection errors that CLI handles automatically
      if (error.includes("Not connected") || 
          error.includes("Connection closed") || 
          error.includes("ConnectionTCPFull.recv") ||
          error.includes("MTProtoSender._recvLoop") ||
          error.includes("_borrowExportedSender") ||
          error.includes("_connectSender")) {
        // These are normal connection errors that the CLI script handles automatically
        // Don't spam the user with these - just log them for debugging
        console.log("🔗 Connection error suppressed (CLI will auto-retry)");
        return;
      }
      
      // PATCH: Check for system error -122 in stderr
      if (error.includes("Unknown system error -122")) {
        console.log("Detected system error -122 in stderr");
        sendRateLimitedMessage(ctx, 
          `⚠️ Warning: System error -122 detected.\nThe bot will attempt to continue...`
        );
      } else {
        sendRateLimitedMessage(ctx, `❌ Error: ${error}`);
      }
    }
  });

  // Handle process exit
  process.on("close", (code) => {
    console.log(`CLI process exited with code ${code}`);
    session.process = null;
    session.state = STATES.IDLE;
    
    // PATCH: Stop speed monitoring when process ends
    stopSpeedMonitoring(userId);
    
    // Clear timers
    stopProgressTimer(userId);

    if (code === 0) {
      sendRateLimitedMessage(ctx, "✅ Process completed successfully!");
    } else {
      sendRateLimitedMessage(ctx, `❌ Process exited with code ${code}`);
    }
  });

  // PATCH: Enhanced error handling for process errors
  process.on("error", (error) => {
    console.error("Process error:", error);
    session.process = null;
    session.state = STATES.IDLE;
    
    // PATCH: Handle system error -122 specifically
    if (error.errno === -122 || error.code === 'Unknown system error -122') {
      sendRateLimitedMessage(ctx, 
        `⚠️ Warning: Process encountered system error -122.\nThis is usually temporary. Try restarting with /start.`
      );
    } else {
      sendRateLimitedMessage(ctx, `❌ Process error: ${error.message}`);
    }
    
    stopSpeedMonitoring(userId);
    stopProgressTimer(userId);
  });

  return process;
}

// Handle text messages
bot.on("text", async (ctx) => {
  const session = getUserSession(ctx.from.id);
  const message = ctx.message.text.trim();

  try {
    switch (session.state) {
      case STATES.AWAITING_CONSENT:
        if (message.toUpperCase() === "I CONSENT") {
          session.state = STATES.AWAITING_API_ID;
          await sendRateLimitedMessage(
            ctx,
            "📱 Please enter your Telegram API ID:",
          );
        } else {
          await sendRateLimitedMessage(
            ctx,
            '⚠️ You must type "I CONSENT" exactly to continue, or use /cancel to abort.',
          );
        }
        break;

      case STATES.AWAITING_API_ID:
        if (/^\d+$/.test(message)) {
          session.apiId = message;
          session.state = STATES.AWAITING_API_HASH;
          await sendRateLimitedMessage(
            ctx,
            "🔑 Please enter your Telegram API Hash:",
          );
        } else {
          await sendRateLimitedMessage(
            ctx,
            "❌ API ID must be a number. Please try again:",
          );
        }
        break;

      case STATES.AWAITING_API_HASH:
        session.apiHash = message;
        session.state = STATES.PROCESSING;

        await sendRateLimitedMessage(
          ctx,
          "🚀 Starting CLI process... Please wait...",
        );

        // Start progress tracking
        startProgressTimer(ctx, ctx.from.id);

        // UPDATE PROGRESS: CLI process starting
        updateProgress(
          "processing",
          "Starting CLI script with user credentials",
          25,
          100,
        );

        spawnCliProcess(ctx.from.id, ctx);
        break;

      case STATES.PROCESSING:
        // Forward message to CLI process
        if (session.process && session.process.stdin.writable) {
          // PATCH: Wrap stdin write in retry logic for error -122
          const writeOperation = async () => {
            session.process.stdin.write(message + "\n");
          };
          
          try {
            await retryWrite(writeOperation, ctx.from.id, ctx);
          } catch (error) {
            console.error("Failed to write to process stdin:", error);
            await sendRateLimitedMessage(ctx, 
              `❌ Error: Could not send command to process. ${error.message}`
            );
          }
        } else {
          await sendRateLimitedMessage(
            ctx,
            "❌ Process not running. Use /start to begin.",
          );
        }
        break;

      default:
        await sendRateLimitedMessage(
          ctx,
          "👋 Welcome! Use /start to begin or /status to check current state.",
        );
    }
  } catch (error) {
    console.error("Error handling message:", error);
    await sendRateLimitedMessage(
      ctx,
      `❌ An error occurred: ${error.message}`,
    );
  }
});

// PATCH: Enhanced error handling with graceful shutdown
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  
  // Handle system error -122 specifically
  if (error.errno === -122 || error.code === 'Unknown system error -122') {
    console.log('🔄 System error -122 detected in uncaught exception handler');
    console.log('Bot will continue running...');
    return; // Don't exit the process
  }
  
  // For other critical errors, attempt graceful shutdown
  console.log('Attempting graceful shutdown...');
  
  // Stop all timers and monitoring
  for (const [userId, timerId] of progressTimers) {
    clearInterval(timerId);
  }
  for (const [userId, timerId] of speedTimers) {
    clearInterval(timerId);
  }
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Handle system error -122 in rejections
  if (reason && (reason.errno === -122 || reason.code === 'Unknown system error -122')) {
    console.log('🔄 System error -122 detected in unhandled rejection');
    console.log('Bot will continue running...');
    return;
  }
});

// Express server for web dashboard (existing functionality preserved)
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static("public"));
app.set("view engine", "ejs");

app.get("/", (req, res) => {
  res.render("dashboard", {
    progress: globalProgress,
    activeSessions: userSessions.size,
    uptime: process.uptime(),
  });
});

app.get("/api/progress", (req, res) => {
  res.json(globalProgress);
});

// ENHANCEMENT: Additional endpoints for uptime monitoring services
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    bot: "running"
  });
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

app.get("/status", (req, res) => {
  res.status(200).json({
    service: "telegram-bot",
    status: "healthy",
    uptime_seconds: Math.floor(process.uptime()),
    active_sessions: userSessions.size,
    last_activity: globalProgress.lastUpdate,
    memory_usage: process.memoryUsage(),
    version: "2.0.0-enhanced"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web dashboard running on port ${PORT}`);
});

// Initialize bot
async function initBot() {
  try {
    await cloneRepository();
    console.log("✅ Repository cloned successfully");

    await bot.launch();
    console.log("🤖 Bot started successfully");

    // UPDATE PROGRESS: Bot initialized
    updateProgress("ready", "Bot initialized and waiting for users", 100, 100);
  } catch (error) {
    console.error("❌ Failed to initialize bot:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.once("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully...");
  
  // Stop all monitoring and timers
  for (const [userId, timerId] of progressTimers) {
    clearInterval(timerId);
  }
  for (const [userId, timerId] of speedTimers) {
    clearInterval(timerId);
  }
  
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully...");
  
  // Stop all monitoring and timers
  for (const [userId, timerId] of progressTimers) {
    clearInterval(timerId);
  }
  for (const [userId, timerId] of speedTimers) {
    clearInterval(timerId);
  }
  
  bot.stop("SIGTERM");
});

// Start the bot
initBot();
