const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.route');
const clientJobRoutes = require('./routes/clientJob.route');
const itemRoutes = require('./routes/item.route');
const marketplaceRoutes = require('./routes/marketplace.route');
const cartRoutes = require('./routes/cart.routes');
const checkoutRoutes = require('./routes/checkout.route');
const orderRoutes = require('./routes/orders.route');
const webhookRoutes = require('./routes/webhook.route');
const emailTemplateRoutes = require('./routes/emailTemplates.routes');
const fileUploadRoutes = require('./routes/fileupload.routes');
const docusignRoutes = require('./routes/docusign');
const vendorRoutes = require('./routes/vendor.route');

const app = express();

// Security & performance middleware
app.use(helmet());
app.use(compression()); // Gzip compression - reduces response size by 60-70%
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Rate limiting - protect against abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Logging - use 'combined' format in production for better performance
const isProduction = process.env.NODE_ENV === 'production';
app.use(morgan(isProduction ? 'combined' : 'dev'));

app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use('/api/files', fileUploadRoutes);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/client-jobs', clientJobRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/docusign', docusignRoutes);
app.use('/api/vendors', vendorRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date().toISOString() });
});

module.exports = app;