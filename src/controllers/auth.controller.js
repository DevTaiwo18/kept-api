const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const { User, ROLES } = require('../models/User');
const Vendor = require('../models/Vendor');
const { sendEmail } = require('../utils/sendEmail');

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['agent','client','buyer','vendor']).optional().default('client'),
  // Vendor-specific fields (required when role is vendor)
  companyName: z.string().min(2).optional(),
  phone: z.string().min(10).optional(),
  serviceArea: z.string().min(2).optional(),
  serviceType: z.enum(['hauling', 'donation', 'both']).optional(),
}).refine((data) => {
  // If role is vendor, require vendor-specific fields
  if (data.role === 'vendor') {
    return data.companyName && data.phone && data.serviceArea && data.serviceType;
  }
  return true;
}, {
  message: 'Vendor registration requires companyName, phone, serviceArea, and serviceType',
  path: ['role']
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(6),
});

function getEmailTemplate(name, content) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px 0;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <tr>
                  <td style="background: linear-gradient(135deg, #e6c35a 0%, #d4af37 100%); padding: 30px 40px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-family: Arial, sans-serif; font-weight: 600;">
                      Kept House
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 40px 40px 30px 40px;">
                    <h2 style="color: #101010; margin: 0 0 20px 0; font-size: 22px; font-family: Arial, sans-serif; font-weight: 500;">
                      Hi ${name},
                    </h2>
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #f9f9f9; padding: 25px 40px; border-top: 1px solid #e0e0e0;">
                    <p style="font-size: 14px; line-height: 1.6; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif;">
                      Best regards,<br/>
                      <strong style="color: #333;">The Kept House Team</strong>
                    </p>
                    <p style="font-size: 12px; line-height: 1.5; color: #999; margin: 15px 0 0 0; font-family: Arial, sans-serif;">
                      If you have any questions, feel free to contact us at support@kepthouse.com
                    </p>
                  </td>
                </tr>
              </table>
              <table width="600" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="font-size: 12px; color: #999; margin: 0; font-family: Arial, sans-serif;">
                      © ${new Date().getFullYear()} Kept House. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function signToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

exports.register = async (req, res) => {
  try {
    const input = registerSchema.parse(req.body);
    const exists = await User.findOne({ email: input.email });
    if (exists) return res.status(409).json({ message: 'Email already in use' });
    const hash = await bcrypt.hash(input.password, 10);

    let vendorProfile = null;

    // Auto-create vendor profile if registering as vendor
    if (input.role === 'vendor') {
      const vendor = await Vendor.create({
        name: input.name,
        companyName: input.companyName,
        email: input.email,
        phone: input.phone,
        serviceArea: input.serviceArea,
        serviceType: input.serviceType,
        type: input.serviceType === 'hauling' ? 'hauler' : input.serviceType === 'donation' ? 'donation_partner' : 'other',
        active: true
      });
      vendorProfile = vendor._id;
    }

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: hash,
      role: input.role,
      vendorProfile,
    });
    const token = signToken(user);

    try {
      const content = `
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          Welcome to Kept House! We're excited to have you on board.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          Your account has been successfully created with the role of <strong style="color: #e6c35a;">${input.role}</strong>.
        </p>
        <div style="background-color: #f9f9f9; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0;">
          <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0; font-family: Arial, sans-serif;">
            <strong>Account Details:</strong><br/>
            Email: ${user.email}<br/>
            Role: ${user.role}
          </p>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
          You can now log in and start exploring all the features we have to offer.
        </p>
      `;

      await sendEmail({
        to: user.email,
        subject: 'Welcome to Kept House!',
        html: getEmailTemplate(user.name, content),
        text: `Hi ${user.name}, Welcome to Kept House! We're excited to have you on board. Your account has been successfully created with the role of ${input.role}. Account Details: Email: ${user.email}, Role: ${user.role}. You can now log in and start exploring all the features we have to offer. Best regards, The Kept House Team`,
      });
    } catch (emailErr) {
      console.error('Failed to send welcome email:', emailErr);
    }

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendorProfile: user.vendorProfile
      }
    });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.login = async (req, res) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await User.findOne({ email: input.email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendorProfile: user.vendorProfile
      }
    });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.sub).select('name email role vendorProfile');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendorProfile: user.vendorProfile
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const user = await User.findOne({ email: input.email });
    
    if (!user) {
      return res.json({ message: 'If that email exists, a reset code has been sent' });
    }

    await User.updateMany(
      { resetPasswordToken: { $exists: true, $ne: null } },
      { $unset: { resetPasswordToken: "", resetPasswordExpires: "" } }
    );

    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();
    
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    try {
      const content = `
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          You requested a password reset for your Kept House account.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 20px 0; font-family: Arial, sans-serif;">
          Use the code below to reset your password:
        </p>
        <div style="background: linear-gradient(135deg, #f9f9f9 0%, #ffffff 100%); border: 2px solid #e6c35a; border-radius: 8px; padding: 30px; text-align: center; margin: 25px 0;">
          <p style="font-size: 14px; color: #666; margin: 0 0 10px 0; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 1px;">
            Your Reset Code
          </p>
          <h2 style="letter-spacing: 8px; color: #e6c35a; font-family: 'Courier New', monospace; font-size: 36px; margin: 0; font-weight: 700;">
            ${resetToken}
          </h2>
        </div>
        <div style="background-color: #fff9e6; border-left: 4px solid #e6c35a; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
          <p style="font-size: 14px; line-height: 1.6; color: #856404; margin: 0; font-family: Arial, sans-serif;">
            ⏱️ <strong>Important:</strong> This code will expire in 1 hour.
          </p>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
          If you didn't request this password reset, please ignore this email and your password will remain unchanged.
        </p>
      `;

      await sendEmail({
        to: user.email,
        subject: 'Kept House — Password Reset Request',
        html: getEmailTemplate(user.name, content),
        text: `Hi ${user.name}, You requested a password reset for your Kept House account. Use this code to reset your password: ${resetToken}. This code will expire in 1 hour. If you didn't request this, please ignore this email. Best regards, The Kept House Team`,
      });
    } catch (emailErr) {
      console.error('Failed to send password reset email:', emailErr);
      return res.status(500).json({ message: 'Failed to send reset email' });
    }

    res.json({ message: 'If that email exists, a reset code has been sent' });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const input = resetPasswordSchema.parse(req.body);
    
    const user = await User.findOne({
      resetPasswordToken: input.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    const hash = await bcrypt.hash(input.newPassword, 10);
    user.passwordHash = hash;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    try {
      const content = `
        <div style="text-align: center; padding: 20px 0;">
          <div style="display: inline-block; background-color: #e8f5e9; border-radius: 50%; width: 80px; height: 80px; line-height: 80px; margin-bottom: 20px;">
            <span style="font-size: 40px;">✓</span>
          </div>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          Your password has been successfully reset.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 15px 0; font-family: Arial, sans-serif;">
          You can now log in to your Kept House account using your new password.
        </p>
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
          <p style="font-size: 14px; line-height: 1.6; color: #856404; margin: 0; font-family: Arial, sans-serif;">
            🔒 <strong>Security Notice:</strong> If you didn't make this change, please contact us immediately at security@kepthouse.com
          </p>
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 20px 0 0 0; font-family: Arial, sans-serif;">
          For your security, we recommend using a strong, unique password that you don't use on other websites.
        </p>
      `;

      await sendEmail({
        to: user.email,
        subject: 'Kept House — Password Reset Successful',
        html: getEmailTemplate(user.name, content),
        text: `Hi ${user.name}, Your password has been successfully reset. You can now log in to your Kept House account using your new password. If you didn't make this change, please contact us immediately at security@kepthouse.com. Best regards, The Kept House Team`,
      });
    } catch (emailErr) {
      console.error('Failed to send password reset confirmation:', emailErr);
    }

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    if (err?.issues) return res.status(400).json({ message: 'Invalid input', issues: err.issues });
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};