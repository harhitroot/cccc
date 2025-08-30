const mimeDB = require("mime-db");
const fs = require("fs");
const path = require("path");

// Define media types
const MEDIA_TYPES = {
  IMAGE: "image",
  VIDEO: "video",
  AUDIO: "audio",
  WEBPAGE: "webpage",
  POLL: "poll",
  GEO: "geo",
  VENUE: "venue",
  CONTACT: "contact",
  STICKER: "sticker",
  DOCUMENT: "document",
  OTHERS: "others",
};

// Define console colors for logging
const consoleColors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
};

// Get the media type of a message
const getMediaType = (message) => {
  if (!message) return "unknown";

  try {
    if (message.media) {
      if (message.media.webpage) {
        return MEDIA_TYPES.WEBPAGE;
      }

      if (message.media.poll) {
        return MEDIA_TYPES.POLL;
      }

      if (message.media.geo) {
        return MEDIA_TYPES.GEO;
      }

      if (message.media.contact) {
        return MEDIA_TYPES.CONTACT;
      }

      if (message.media.venue) {
        return MEDIA_TYPES.VENUE;
      }
      if (message.media.game) return "game";
      if (message.media.invoice) return "invoice";
      if (message.media.geoLive) return "live_location";
      if (message.media.unsupported) return "unsupported";
    }

    if (message.sticker) return MEDIA_TYPES.STICKER;
    if (message.dice) return "dice";
    if (message.groupedId) return "album";

    if (message.media.photo) return MEDIA_TYPES.IMAGE;
    if (message.media.video) return MEDIA_TYPES.VIDEO;
    if (message.media.audio) return MEDIA_TYPES.AUDIO;
    if (message.media.voice) return MEDIA_TYPES.AUDIO;
    if (message.media.document) {
      const doc = message.media.document;
      if (doc.mimeType) {
        if (doc.mimeType.startsWith("video/")) return MEDIA_TYPES.VIDEO;
        if (doc.mimeType.startsWith("audio/")) return MEDIA_TYPES.AUDIO;
        if (doc.mimeType === "application/pdf") return "pdf";
        if (doc.mimeType.includes("zip") || doc.mimeType.includes("archive")) return "zip";
        if (doc.mimeType.startsWith("image/")) return MEDIA_TYPES.IMAGE;
        if (doc.mimeType.includes("text/")) return MEDIA_TYPES.DOCUMENT;
        if (doc.mimeType.includes("application/")) return MEDIA_TYPES.DOCUMENT;
      }

      // Check file extension as fallback
      if (doc.fileName) {
        const ext = doc.fileName.toLowerCase().split('.').pop();
        const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts', 'mts'];
        const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tiff'];

        if (videoExts.includes(ext)) return MEDIA_TYPES.VIDEO;
        if (audioExts.includes(ext)) return MEDIA_TYPES.AUDIO;
        if (imageExts.includes(ext)) return MEDIA_TYPES.IMAGE;
        if (ext === 'pdf') return "pdf";
        if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return "zip";
      }

      return MEDIA_TYPES.DOCUMENT;
    }
  } catch (error) {
    console.error("Error detecting media type:", error);
    return "unknown";
  }
};

// Check if a file already exists (improved for collision handling)
const checkFileExist = (message, outputFolder) => {
  if (!message || !message.media) return false;

  let fileName = `${message.id}_file`;
  const { media } = message;

  if (media.document) {
    const docAttributes = media.document.attributes;
    if (docAttributes) {
      const fileNameObj = docAttributes.find(
        (e) => e.className === "DocumentAttributeFilename"
      );
      if (fileNameObj) {
        fileName = fileNameObj.fileName;
      } else {
        const ext = mimeDB[media.document.mimeType]?.extensions[0];
        if (ext) fileName += `.${ext}`;
      }
    }
  }

  if (media.video) fileName += ".mp4";
  if (media.audio) fileName += ".mp3";
  if (media.photo) fileName += ".jpg";

  const folderType = filterString(getMediaType(message));

  // Check for unique filename with message ID (consistent with getMediaPath)
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const uniqueFileName = `${baseName}_${message.id}${ext}`;
  const filePath = path.join(outputFolder, folderType, uniqueFileName);

  return fs.existsSync(filePath);
};

// Get the path to save the media file (improved collision handling)
const getMediaPath = (message, outputFolder) => {
  if (!message || !message.media) return "unknown";

  let fileName = `${message.id}_file`;
  const { media } = message;

  if (media.document) {
    const docAttributes = media.document.attributes;
    if (docAttributes) {
      const fileNameObj = docAttributes.find(
        (e) => e.className === "DocumentAttributeFilename"
      );
      if (fileNameObj) {
        fileName = fileNameObj.fileName;
      } else {
        const ext = mimeDB[media.document.mimeType]?.extensions[0];
        if (ext) fileName += `.${ext}`;
      }
    }
  }

  if (media.video) fileName += ".mp4";
  if (media.audio) fileName += ".mp3";
  if (media.photo) fileName += ".jpg";

  const folderType = filterString(getMediaType(message));

  // Always use message ID in filename to avoid collisions entirely
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const uniqueFileName = `${baseName}_${message.id}${ext}`;

  const finalPath = path.join(outputFolder, folderType, uniqueFileName);

  // Ensure directory exists
  if (!fs.existsSync(path.dirname(finalPath))) {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  }

  return finalPath;
};

// Get the type of dialog
const getDialogType = (dialog) => {
  if (dialog.isChannel) return "Channel";
  if (dialog.isGroup) return "Group";
  if (dialog.isUser) return "User";
  return "Unknown";
};

// Logging utility
const logMessage = {
  info: (message, icon=true) => {
    console.log(`📢: ${consoleColors.magenta}${message}${consoleColors.reset}`);
  },
  error: (message) => {
    console.log(`❌ ${consoleColors.red}${message}${consoleColors.reset}`);
  },
  success: (message) => {
    console.log(`✅ ${consoleColors.cyan}${message}${consoleColors.reset}`);
  },
  debug: (message) => {
    console.log(`⚠️ ${message}`);
  },
};

// Wait for a specified number of seconds
const wait = (seconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
};

// Filter a string to remove non-alphanumeric characters
const filterString = (string) => {
  return string.replace(/[^a-zA-Z0-9]/g, "");
};

// Stringify an object with circular references
const circularStringify = (obj, indent = 2) => {
  const cache = new Set();
  const retVal = JSON.stringify(
    obj,
    (key, value) =>
      typeof value === "object" && value !== null
        ? cache.has(value)
          ? undefined
          : cache.add(value) && value
        : value,
    indent
  );
  cache.clear();
  return retVal;
};

// Append data to a JSON array file
const appendToJSONArrayFile = (filePath, dataToAppend) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, circularStringify(dataToAppend, null, 2));
    } else {
      const data = fs.readFileSync(filePath);
      const json = JSON.parse(data);
      json.push(dataToAppend);
      fs.writeFileSync(filePath, circularStringify(json, null, 2));
    }
  } catch (e) {
    logMessage.error(`Error appending to JSON Array file ${filePath}`);
    console.error(e);
  }
};

// Cleanup a file after use
const cleanupFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logMessage.success(`Cleaned up file: ${filePath}`);
    }
  } catch (error) {
    logMessage.error(`Error cleaning up file ${filePath}: ${error.message}`);
  }
};

// Get a temporary media path for downloading files
const getTempMediaPath = (message) => {
  const folderType = filterString(getMediaType(message));
  const fileName = `${message.id}_temp_file`;
  const tempDir = path.join(__dirname, 'temp', folderType);

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  return path.join(tempDir, fileName);
};

module.exports = {
  getMediaType,
  getDialogType,
  logMessage,
  circularStringify,
  getMediaPath,
  checkFileExist,
  appendToJSONArrayFile,
  wait,
  filterString,
  cleanupFile,
  getTempMediaPath,
};