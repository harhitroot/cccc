# Telegram Channel Downloader

## Overview

Telegram Channel Downloader is a Node.js application that provides comprehensive functionality for downloading media files and messages from Telegram channels, groups, or individual users. The application supports downloading all types of content including text messages, images, videos, audio files, documents, stickers, polls, and other media types. It features both HTML and JSON export formats, parallel processing for optimal download speeds, and optional upload capabilities to redistribute content to other channels.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Core Framework
- **Runtime**: Node.js application using CommonJS module system
- **Entry Point**: Single-file execution through `index.js` with modular script architecture
- **CLI Interface**: Command-line interface with interactive prompts using Inquirer.js

### Authentication System
- **Telegram API Integration**: Uses official Telegram client library with session management
- **Credential Storage**: JSON-based configuration file (`config.json`) storing API credentials and session tokens
- **Authentication Flow**: Phone number + OTP verification with support for both SMS and app-based OTP delivery
- **Session Persistence**: StringSession implementation for maintaining authenticated state across runs

### Data Processing Architecture
- **Message Retrieval**: Batch processing with configurable limits (default 80 messages per batch)
- **Parallel Processing**: Ultra-optimized concurrent downloads with 8-16 parallel streams
- **Rate Limiting**: Built-in flood protection with exponential backoff and retry mechanisms
- **Media Type Detection**: Comprehensive media classification system supporting 10+ content types

### File Management System
- **Export Structure**: Organized directory structure under `./export/` with channel-specific folders
- **Multi-format Output**: 
  - Raw JSON data preservation
  - Structured HTML reports using EJS templating
  - Clean JSON exports for programmatic access
- **Media Organization**: Type-based file organization with original filename preservation

### Performance Optimization
- **Batch Processing**: 5-message concurrent processing with complete workflow (Download All 5 → Upload All 5 → Delete All 5)
- **Ultra-Parallel Processing**: 12 workers per message for both download and upload phases (matching original high-speed script)
- **Optimized Download Settings**: 4MB chunk size, auto-selected data centers and request sizes for maximum throughput
- **Streaming Downloads**: Direct file streaming with progress tracking
- **Memory Management**: Efficient resource cleanup and garbage collection
- **Speed Optimization**: Currently achieving 8.1+ Mbps (improved from 7 Mbps), targeting 30+ Mbps
- **Message Limit**: Increased to 8192 messages per batch (from 80) for better throughput
- **Minimal Delays**: 50ms delays between operations for maximum speed
- **Channel Search**: Added search by name functionality for both source and target channel selection
- **Filename Collision Fix**: Resolved "No local file available" warnings by ensuring consistent filename generation between download and upload phases
- **Restricted Channel Support**: Enhanced file verification and path handling for full compatibility with restricted channels

### Module Organization
- **Authentication Module**: Handles Telegram client initialization and credential management
- **Dialog Management**: Channel/group discovery and selection interface
- **Message Processing**: Core download and upload functionality
- **Utility Modules**: Helper functions for file operations, logging, and user input

### Error Handling
- **Global Exception Handling**: Comprehensive error catching for uncaught exceptions and promise rejections
- **Retry Logic**: Configurable retry mechanisms with exponential backoff
- **Graceful Degradation**: Continued operation despite individual message failures
- **Detailed Logging**: Color-coded console output with timestamp and level indicators

## External Dependencies

### Core Libraries
- **telegram**: Official Telegram client library for Node.js API interaction
- **inquirer**: Interactive command-line interface for user prompts and selections
- **ejs**: Embedded JavaScript templating for HTML report generation
- **glob**: File pattern matching for modular script loading

### Utility Libraries
- **mime-db**: MIME type detection for proper file extension handling
- **nodemon**: Development-time file watching and auto-restart functionality

### Telegram API Requirements
- **API Credentials**: Requires API ID and API Hash from https://my.telegram.org/apps
- **Phone Verification**: Uses Telegram's official authentication flow
- **Session Management**: Maintains persistent login state through StringSession

### File System Dependencies
- **Local Storage**: Relies on local file system for media downloads and configuration
- **JSON Configuration**: File-based configuration management without external databases
- **Export Directory**: Structured local file organization for downloaded content

### Network Requirements
- **Telegram Servers**: Direct connection to Telegram's API endpoints
- **High Bandwidth**: Optimized for high-speed downloads (30+ Mbps capability)
- **Connection Stability**: Retry mechanisms for handling network interruptions