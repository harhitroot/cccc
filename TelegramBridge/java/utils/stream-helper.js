
const fs = require('fs');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Write data to file using streams to reduce memory usage
 */
const writeFileStream = async (filePath, data) => {
  return new Promise((resolve, reject) => {
    const writeStream = createWriteStream(filePath, { flags: 'w' });
    
    writeStream.on('error', (err) => {
      console.error('Stream write error:', err);
      reject(err);
    });
    
    writeStream.on('finish', () => {
      resolve();
    });
    
    // Write data in chunks to avoid memory issues
    const jsonString = JSON.stringify(data, null, 2);
    const chunkSize = 1024 * 64; // 64KB chunks
    
    for (let i = 0; i < jsonString.length; i += chunkSize) {
      const chunk = jsonString.slice(i, i + chunkSize);
      writeStream.write(chunk);
    }
    
    writeStream.end();
  });
};

module.exports = {
  writeFileStream
};
