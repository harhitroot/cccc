const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { circularStringify } = require("../utils/helper");

const getMessages = async (client, channelId, limit = 10, offsetId = 0, reverse = false) => {
  if (!client || !channelId) {
    throw new Error("Client and channelId are required");
  }

  try {
    const result = await client.getMessages(channelId, {
      limit,
      offsetId,
      reverse: reverse
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to get messages: ${error.message}`);
  }
};

const getMessageDetail = async (client, channelId, messageIds) => {
  if (!client || !channelId || !messageIds) {
    throw new Error("Client, channelId, and messageIds are required");
  }

  try {
    const result = await client.getMessages(channelId, { ids: messageIds });
    return result;
  } catch (error) {
    throw new Error(`Failed to get message details: ${error.message}`);
  }
};

/**
 * ULTRA-OPTIMIZED Download for consistent 30 Mbps with single-file boost
 * @param {Object} client Telegram client
 * @param {Object} message Telegram message
 * @param {string} mediaPath Local file save path
 * @param {number} fileIndex Current file number (1-based)
 * @param {number} totalFiles Total files in this batch
 * @param {Object} options Ultra-speed optimization options
 */
const downloadMessageMedia = async (client, message, mediaPath, fileIndex = 1, totalFiles = 1, options = {}) => {
  const {
    workers = 16, // Dynamic based on single file or batch
    chunkSize = 8 * 1024 * 1024, // Dynamic based on single file or batch
    workerIndex = 0,
    optimizeForSpeed = true,
    stabilizeSpeed = true
  } = options;

  // Detect single file optimization
  const isSingleFile = totalFiles === 1 && !stabilizeSpeed;

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    if (!client || !message || !mediaPath) {
      logger.error("Client, message, and mediaPath are required");
      return false;
    }

    logger.info(`Processing message ${message.id} with media type: ${message.media ? Object.keys(message.media)[0] : 'none'}`);

    if (message.media) {
      // Handle special media types that don't require downloading
      if (message.media.webpage) {
        const webpage = message.media.webpage;

        const webpageDir = path.join(path.dirname(mediaPath));
        if (!fs.existsSync(webpageDir)) {
          fs.mkdirSync(webpageDir, { recursive: true });
        }

        let urlPath = null;
        if (webpage.url) {
          urlPath = path.join(webpageDir, `${message.id}_webpage.txt`);
          const webpageData = {
            url: webpage.url,
            title: webpage.title || '',
            description: webpage.description || '',
            siteName: webpage.siteName || '',
            type: webpage.type || ''
          };
          fs.writeFileSync(urlPath, JSON.stringify(webpageData, null, 2));
          logger.info(`📄 Saved webpage data: ${path.basename(urlPath)}`);
        }

        if (webpage.photo) {
          mediaPath = path.join(webpageDir, `${message.id}_webpage_image.jpeg`);
        } else {
          return urlPath || true;
        }
      }

      if (message.media.poll) {
        const pollDir = path.dirname(mediaPath);
        if (!fs.existsSync(pollDir)) {
          fs.mkdirSync(pollDir, { recursive: true });
        }
        const pollPath = path.join(pollDir, `${message.id}_poll.json`);
        fs.writeFileSync(
          pollPath,
          circularStringify(message.media.poll, null, 2)
        );
        logger.info(`📊 Saved poll data: ${path.basename(pollPath)}`);
        return pollPath;
      }

      if (message.media.geo) {
        const geoDir = path.dirname(mediaPath);
        if (!fs.existsSync(geoDir)) {
          fs.mkdirSync(geoDir, { recursive: true });
        }
        const geoPath = path.join(geoDir, `${message.id}_location.json`);
        fs.writeFileSync(
          geoPath,
          JSON.stringify({
            latitude: message.media.geo.lat,
            longitude: message.media.geo.long,
            accuracy: message.media.geo.accuracyRadius || null
          }, null, 2)
        );
        logger.info(`📍 Saved location data: ${path.basename(geoPath)}`);
        return geoPath;
      }

      if (message.media.contact) {
        const contactDir = path.dirname(mediaPath);
        if (!fs.existsSync(contactDir)) {
          fs.mkdirSync(contactDir, { recursive: true });
        }
        const contactPath = path.join(contactDir, `${message.id}_contact.json`);
        fs.writeFileSync(
          contactPath,
          JSON.stringify(message.media.contact, null, 2)
        );
        logger.info(`👤 Saved contact data: ${path.basename(contactPath)}`);
        return contactPath;
      }

      if (message.media.venue) {
        const venueDir = path.dirname(mediaPath);
        if (!fs.existsSync(venueDir)) {
          fs.mkdirSync(venueDir, { recursive: true });
        }
        const venuePath = path.join(venueDir, `${message.id}_venue.json`);
        fs.writeFileSync(
          venuePath,
          JSON.stringify(message.media.venue, null, 2)
        );
        logger.info(`🏢 Saved venue data: ${path.basename(venuePath)}`);
        return venuePath;
      }

      const fileName = path.basename(mediaPath);
      const startTime = Date.now();

      // Ensure directory exists
      const dir = path.dirname(mediaPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Dynamic settings: SINGLE-FILE BOOST vs BALANCED batch performance
      const downloadSettings = isSingleFile ? {
        // SINGLE-FILE BOOST: Maximum performance settings
        outputFile: mediaPath,
        workers: Math.min(workers, 48), // Maximum workers for single file
        chunkSize: Math.min(chunkSize, 32 * 1024 * 1024), // Larger chunks for single file
        requestSize: 2 * 1024 * 1024, // 2MB request size for maximum throughput
        partSizeKb: 1024, // Larger parts for single file speed
        dcId: undefined, // Auto-select optimal data center
        fileSize: message.media?.document?.size || message.media?.photo?.sizes?.[0]?.size,
        maxConcurrentDownloads: Math.min(workers, 48), // Maximum concurrency
        downloadTimeout: 300000, // 5 minutes timeout for large files
        retryDelay: 500, // Faster retry for single files
        progressCallback: (downloaded, total) => {
          if (total > 0) {
            const percent = ((downloaded / total) * 100).toFixed(2);
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const speedBps = elapsedSeconds > 0 ? (downloaded * 8) / elapsedSeconds : 0;
            const speedMbps = (speedBps / 1000 / 1000).toFixed(1);
            process.stdout.write(
              `\r[SINGLE-FILE BOOST] ${fileName}: ${percent}% (${speedMbps} Mbps)`
            );
          }
          if (downloaded === total) {
            process.stdout.write(
              `\n🚀 SINGLE-FILE BOOST Complete: ${fileName}\n`
            );
          }
        }
      } : {
        // BALANCED batch settings for stable 30 Mbps performance
        outputFile: mediaPath,
        workers: Math.min(workers, 24), // Increased workers for batch stability
        chunkSize: Math.min(chunkSize, 16 * 1024 * 1024), // Larger chunks for batch
        requestSize: 1 * 1024 * 1024, // 1MB request size for stability
        partSizeKb: 512, // 512KB parts for consistent performance
        dcId: undefined, // Auto-select optimal data center
        fileSize: message.media?.document?.size || message.media?.photo?.sizes?.[0]?.size,
        maxConcurrentDownloads: Math.min(workers, 24),
        downloadTimeout: 180000, // 3 minutes timeout
        retryDelay: 1000, // 1 second retry delay for stability
        progressCallback: (downloaded, total) => {
          if (total > 0) {
            const percent = ((downloaded / total) * 100).toFixed(2);
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const speedBps = elapsedSeconds > 0 ? (downloaded * 8) / elapsedSeconds : 0;
            const speedMbps = (speedBps / 1000 / 1000).toFixed(1);
            process.stdout.write(
              `\r[${fileIndex}/${totalFiles}] ${fileName}: ${percent}% (${speedMbps} Mbps)`
            );
          }
          if (downloaded === total) {
            process.stdout.write(
              `\n✅ Completed: ${fileName} (${fileIndex}/${totalFiles})\n`
            );
          }
        }
      };

      await client.downloadMedia(message, downloadSettings);


      return true;

    } else if (message.sticker) {
      // Handle stickers with ultra-optimized settings
      const stickerPath = path.join(path.dirname(mediaPath), `${message.id}_sticker.webp`);

      await client.downloadMedia(message, {
        outputFile: stickerPath,
        workers: Math.min(workers, 10),
        chunkSize: Math.min(chunkSize, 4 * 1024 * 1024),
        progressCallback: (downloaded, total) => {
          if (total > 0) {
            const percent = ((downloaded / total) * 100).toFixed(2);
            process.stdout.write(`\r[${fileIndex}/${totalFiles}] Sticker: ${percent}%`);
          }
          if (downloaded === total) {
            process.stdout.write(`\n✅ Downloaded: Sticker [${fileIndex}/${totalFiles}]\n`);
          }
        },
      });
      return true;
    } else {
      logger.error("No media found in the message");
      return false;
    }

  } catch (err) {
    logger.error(`Error downloading media for message ${message.id}: ${err.message}`);
    return false;
  }
};

/**
 * Upload a message with media to a target channel with preserved caption/text
 * Optimized for 30 Mbps upload speed with single-file boost capability
 * @param {Object} client Telegram client
 * @param {string} targetChannelId Target channel ID
 * @param {Object} message Original message object
 * @param {string} mediaPath Local media file path (optional)
 * @param {boolean} isSingleFile Whether this is a single file upload (enables boost mode)
 */
const uploadMessageToChannel = async (client, targetChannelId, message, mediaPath = null, isSingleFile = false) => {
  try {
    if (!client || !targetChannelId || !message) {
      throw new Error("Client, targetChannelId, and message are required");
    }

    // Preserve original caption/text exactly as it appears
    const originalCaption = message.message || "";
    const originalEntities = message.entities || [];

    // Dynamic upload settings: SINGLE-FILE BOOST vs BALANCED batch performance
    let uploadOptions = {
      message: originalCaption,
      entities: originalEntities,
      parseMode: null, // Use entities instead of parseMode for exact preservation
      silent: true,
      uploadStartTime: Date.now(),
      // Dynamic settings based on single file vs batch
      workers: isSingleFile ? Math.min(48, 48) : Math.min(24, 16), // Max workers for single file
      chunkSize: isSingleFile ? 16 * 1024 * 1024 : 8 * 1024 * 1024, // Larger chunks for single file
      partSizeKb: isSingleFile ? 2048 : 1024, // Larger parts for single file
      bigFileThreshold: isSingleFile ? 128 * 1024 : 256 * 1024, // Lower threshold for single file
      requestSize: isSingleFile ? 4 * 1024 * 1024 : 2 * 1024 * 1024, // Larger requests for single file
      maxConcurrentUploads: isSingleFile ? Math.min(48, 48) : Math.min(24, 16), // Max concurrency for single file
      uploadTimeout: isSingleFile ? 600000 : 240000, // 10 minutes timeout for single large files
      progressCallback: (uploaded, total) => {
          if (total > 0) {
            const percent = ((uploaded / total) * 100).toFixed(1);
            const elapsedSeconds = (Date.now() - uploadOptions.uploadStartTime) / 1000;
            const speedBps = (uploaded * 8) / elapsedSeconds;
            const speedMbps = (speedBps / 1000 / 1000).toFixed(1);
            const mode = isSingleFile ? "[SINGLE-FILE BOOST]" : "🔄 SEQUENTIAL";

            // Show sequential queue status
            if (percent === "100.0") {
              process.stdout.write(`\r${mode} Uploading: ${percent}% (${speedMbps} Mbps) - COMPLETING...`);
            } else {
              process.stdout.write(`\r${mode} Uploading: ${percent}% (${speedMbps} Mbps)`);
            }
          }
          if (uploaded === total) {
            const elapsedSeconds = (Date.now() - uploadOptions.uploadStartTime) / 1000;
            const avgSpeedMbps = ((total * 8) / elapsedSeconds / 1000 / 1000).toFixed(1);
            const mode = isSingleFile ? "🚀 SINGLE-FILE BOOST" : "✅ SEQUENTIAL";
            process.stdout.write(`\n${mode} Upload complete - Avg: ${avgSpeedMbps} Mbps\n`);
          }
        }
    };

    // Handle different types of content
    if (message.media) {
      if (mediaPath && fs.existsSync(mediaPath)) {
        uploadOptions.file = mediaPath;

        // Preserve media-specific attributes
        if (message.media.photo) {
          uploadOptions.supportsStreaming = true;
          logger.info(`📸 Uploading photo: ${path.basename(mediaPath)}`);
        } else if (message.media.document) {
          const doc = message.media.document;
          uploadOptions.attributes = doc.attributes || [];
          uploadOptions.mimeType = doc.mimeType;
          uploadOptions.supportsStreaming = true;

          const videoExtensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp'];
          const audioExtensions = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus'];
          const fileExt = path.extname(mediaPath).toLowerCase();

          if (videoExtensions.includes(fileExt)) {
            uploadOptions.supportsStreaming = true;
            uploadOptions.videoNote = doc.videoNote || false;

            if (doc.attributes) {
              const videoAttr = doc.attributes.find(attr => attr.className === 'DocumentAttributeVideo');
              if (videoAttr) {
                uploadOptions.duration = videoAttr.duration;
                uploadOptions.width = videoAttr.w;
                uploadOptions.height = videoAttr.h;
                uploadOptions.roundMessage = videoAttr.roundMessage;
              }
            }
            logger.info(`🎥 Uploading video: ${path.basename(mediaPath)}`);
          } else if (audioExtensions.includes(fileExt)) {
            if (doc.attributes) {
              const audioAttr = doc.attributes.find(attr => attr.className === 'DocumentAttributeAudio');
              if (audioAttr) {
                uploadOptions.duration = audioAttr.duration;
                uploadOptions.performer = audioAttr.performer;
                uploadOptions.title = audioAttr.title;
                uploadOptions.voice = audioAttr.voice;
              }
            }
            logger.info(`🎵 Uploading audio: ${path.basename(mediaPath)}`);
          } else {
            logger.info(`📄 Uploading document: ${path.basename(mediaPath)}`);
          }
        } else if (message.media.video) {
          uploadOptions.supportsStreaming = true;
          uploadOptions.videoNote = message.media.videoNote || false;
          if (message.media.video.duration) {
            uploadOptions.duration = message.media.video.duration;
          }
          if (message.media.video.w && message.media.video.h) {
            uploadOptions.width = message.media.video.w;
            uploadOptions.height = message.media.video.h;
          }
          logger.info(`🎥 Uploading video message: ${path.basename(mediaPath)}`);
        }

      } else {
        logger.warn(`⚠️ No local file available for message ${message.id}, upload may fail on restricted channels`);
        return false;
      }

      // Handle special media types
      if (message.media.poll) {
        const pollData = message.media.poll;
        uploadOptions.message = `📊 Poll: ${pollData.question}\n\nOptions:\n${pollData.answers.map((ans, i) => `${i + 1}. ${ans.text}`).join('\n')}\n\n${originalCaption}`;
        delete uploadOptions.file;
      } else if (message.media.geo) {
        const geo = message.media.geo;
        uploadOptions.message = `📍 Location: ${geo.lat}, ${geo.long}\n\n${originalCaption}`;
        delete uploadOptions.file;
      } else if (message.media.contact) {
        const contact = message.media.contact;
        uploadOptions.message = `👤 Contact: ${contact.firstName} ${contact.lastName || ''}\nPhone: ${contact.phoneNumber}\n\n${originalCaption}`;
        delete uploadOptions.file;
      } else if (message.media.venue) {
        const venue = message.media.venue;
        uploadOptions.message = `🏢 Venue: ${venue.title}\nAddress: ${venue.address}\n\n${originalCaption}`;
        delete uploadOptions.file;
      } else if (message.media.webpage) {
        const webpage = message.media.webpage;
        uploadOptions.message = `🔗 ${webpage.title || 'Webpage'}\n${webpage.url}\n${webpage.description || ''}\n\n${originalCaption}`;
        delete uploadOptions.file;
      }

    } else if (message.sticker) {
      uploadOptions.file = message.sticker;
      uploadOptions.sticker = true;
    } else {
      if (!originalCaption.trim()) {
        logger.warn(`Message ${message.id} has no content to upload`);
        return false;
      }
    }

    // Send the message with ultra-optimized settings
    let result;
    if (uploadOptions.file && fs.existsSync(uploadOptions.file)) {
      result = await client.sendFile(targetChannelId, {
        file: uploadOptions.file,
        caption: uploadOptions.message,
        entities: uploadOptions.entities,
        supportsStreaming: uploadOptions.supportsStreaming,
        duration: uploadOptions.duration,
        width: uploadOptions.width,
        height: uploadOptions.height,
        mimeType: uploadOptions.mimeType,
        attributes: uploadOptions.attributes,
        videoNote: uploadOptions.videoNote,
        performer: uploadOptions.performer,
        title: uploadOptions.title,
        voice: uploadOptions.voice,
        workers: uploadOptions.workers,
        chunkSize: uploadOptions.chunkSize,
        progressCallback: uploadOptions.progressCallback,
        silent: true,
        // Additional ultra-speed optimizations
        bigFileThreshold: uploadOptions.bigFileThreshold,
        requestSize: uploadOptions.requestSize,
        connectionPoolSize: uploadOptions.connectionPoolSize,
        streamingUpload: uploadOptions.streamingUpload
      });
    } else {
      result = await client.sendMessage(targetChannelId, uploadOptions);
    }

    return result;

  } catch (error) {
    throw new Error(`Failed to upload message: ${error.message}`);
  }
};

/**
 * Forward a message to target channel
 * @param {Object} client Telegram client
 * @param {string} targetChannelId Target channel ID
 * @param {string} sourceChannelId Source channel ID
 * @param {number} messageId Message ID to forward
 */
const forwardMessageToChannel = async (client, targetChannelId, sourceChannelId, messageId) => {
  try {
    const result = await client.forwardMessages(targetChannelId, {
      messages: [messageId],
      fromPeer: sourceChannelId,
      silent: true
    });
    return result;
  } catch (error) {
    throw new Error(`Failed to forward message: ${error.message}`);
  }
};

module.exports = {
  getMessages,
  getMessageDetail,
  downloadMessageMedia,
  uploadMessageToChannel,
  forwardMessageToChannel,
};
