
const ChannelDownloader = require("./scripts/download-channel");
const channelDownloader = new ChannelDownloader();

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log the error
});

// Handle specific write stream errors
process.on('ENOSPC', () => {
  console.error('❌ No space left on device. Cleaning up...');
  // Trigger cleanup
  if (channelDownloader.cleanupMemory) {
    channelDownloader.cleanupMemory();
  }
});

// Enhanced configuration to support all message types
const channelId = ""; // Leave empty to select interactively
const downloadableFiles = {
  webpage: true,
  poll: true,
  geo: true,
  contact: true,
  venue: true,
  sticker: true,
  image: true,
  video: true,
  audio: true,
  voice: true,
  document: true,
  pdf: true,
  zip: true,
  rar: true,
  txt: true,
  docx: true,
  xlsx: true,
  pptx: true,
  mp3: true,
  mp4: true,
  avi: true,
  mkv: true,
  gif: true,
  webm: true,
  all: true // Download all file types
};

(async () => {
  try {
    console.log("🚀 Enhanced Telegram Channel Downloader");
    console.log("📋 Features:");
    console.log("   ✅ Downloads ALL message types (text, media, stickers, documents)");
    console.log("   ✅ Maintains original captions");
    console.log("   ✅ Optional upload to another channel");
    console.log("   ✅ Parallel processing (5 messages at once - 30 Mbps for both download & upload)");
    console.log("   ✅ Rate limiting and flood protection");
    console.log("   ✅ Auto cleanup after upload");
    console.log("   ✅ Progress tracking");
    console.log("");
    
    await channelDownloader.handle({ channelId, downloadableFiles });
  } catch (err) {
    console.error("❌ Fatal error:", err);
  }
})();
