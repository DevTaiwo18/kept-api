const mongoose = require('mongoose');

async function connectDB(uri) {
  mongoose.set('strictQuery', true);

  const isProduction = process.env.NODE_ENV === 'production';

  await mongoose.connect(uri, {
    dbName: isProduction ? 'kept_prod' : 'kept_dev',
    family: 4,
    // Connection pool settings for better performance
    maxPoolSize: 50,              // Maximum connections in pool
    minPoolSize: 5,               // Minimum connections to maintain
    maxIdleTimeMS: 30000,         // Close idle connections after 30s
    serverSelectionTimeoutMS: 30000, // Allow more time for server selection
    socketTimeoutMS: 45000,       // Socket timeout for operations
    connectTimeoutMS: 30000,      // Connection timeout
  });

  console.log(`✅ MongoDB connected (${isProduction ? 'production' : 'development'})`);
}

module.exports = { connectDB };
