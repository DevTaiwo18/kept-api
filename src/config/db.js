const mongoose = require('mongoose');

async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    dbName: 'kept_dev',
    family: 4,
    serverSelectionTimeoutMS: 10000,
  });
  console.log('✅ MongoDB connected');
}

module.exports = { connectDB };
