# Telegram Media Bot Wrapper (Enhanced)

A Telegram bot that integrates with an existing Node.js Telegram media script, providing CLI functionality through a bot chat interface with enhanced spam prevention, speed monitoring, and error handling.

## New Features (Patched)

### 🛡️ Message Spam Prevention
- **Duplicate Detection**: Automatically filters out repeated/duplicate CLI messages
- **Smart Filtering**: Reduces verbose debug output while preserving important notifications
- **30-second deduplication window** to prevent message spam

### ⏱️ Rate Limiting
- **5-second delays** between Telegram messages to prevent rate-limit bans
- Enhanced queue processing with retry mechanisms
- Intelligent backoff for 429 (Too Many Requests) errors

### 📊 Real-time Speed Monitoring
- **Automatic speed detection** when downloads/uploads start
- **Real internet speed measurement** using network interface statistics
- **Speed updates every 2 minutes** with format:
  ```
  📊 Current Internet Speed:
  - Download: 12.4 MB/s
  - Upload: 3.8 MB/s
  - Total: 16.2 MB/s
  (Updates every 2 min)
  ```
- **Automatic monitoring stop** when tasks complete

### 🔧 Enhanced Error Handling
- **System Error -122 Recovery**: Automatic retry mechanism for write failures
- **Retry Logic**: 2-5 second delays with up to 5 retry attempts
- **Non-crash behavior**: Bot continues running even after persistent errors
- **User notifications** for error status and recovery attempts

## Original Features (Preserved)

- **Zero Code Modification**: Uses the original repository exactly as-is via git clone
- **Complete CLI Workflow**: Replicates phone number → OTP → channel selection → download/upload options
- **Full Feature Preservation**: Supports parallel downloading, captions, restricted messages, all media types
- **Real-time Communication**: Pipes user messages to CLI script's stdin and forwards stdout back to user
- **Security First**: Warnings and explicit consent before login process
- **State Management**: Handles ongoing conversations and script interactions

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   