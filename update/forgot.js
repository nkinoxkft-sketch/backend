import express from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import logger from '../winstonown.js';
import cloudToken from '../Midleware/cloud.js';
import sendemail from './email.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import validator from '../Midleware/validator.js';
import { prisma } from '../database.js';

const router = express.Router();

const forgotSchema = z.object({

  email: z.email({error: 'Invalid email format'}),

});

const forgotLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 2,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const forgotValidator = validator.createValidator({

    Schema: forgotSchema

});

const strictJsonLimit = express.json({ limit: '5kb' });

router.post('/api/forgot', strictJsonLimit, cloudToken.verifyRobotOrToken, forgotLimiter, forgotValidator, async (req, res)  => {

    const ip = req.ip;

    try{

      const email  = req.body?.email;

      const resetToken = crypto.randomBytes(32).toString('hex');

      const expiresAt = Date.now() + 60 * 60 * 1000;

      await prisma.users.update( { where: { email: email}, data: {resetToken: resetToken, resetTokenExpiry: expiresAt}});
      
      logger.info('/api/forgot', {ip: ip, success: 'true', message: 'Reset email sent' } );

      logger.info('/api/forgot', {ip: ip, success: 'true', message: 'Reset email sent', productionOnly: true, resetToken: resetToken, resetTokenExpiry: expiresAt,
          email: email
         } );

      res.status(200).json({ message: "Email sent" });

      await sendemail.sendPasswordResetEmail(email, resetToken);


    }catch(err){

        if(err.code === "P2025"){

          return res.status(200).json({ message: "Email sent" });

        }

        logger.error('/api/forgot', {
          error: {
              message: err.message,
              stack: err.stack,
              code: err.code
          },
          ip: ip,
          requestId: req.id
        });

        return res.status(500).json({error: 'An unexpected error occurred. Please try again later.'});

    }


});

const regSchema = z.object({


  password: z.string()

    .min(8, 'Password must be at least 8 characters long!')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter!')
    .regex(/\d/, 'Must contain at least one number!')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character!'),

});

const resetValidator = validator.createValidator({

    Schema: regSchema

});

router.post('/api/reset-password', strictJsonLimit, forgotLimiter, resetValidator, async (req, res) => {

  const ip = req.ip;

  try {

    const { token, password } = req.body;

    const saltRounds = 10;
    
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const result = await prisma.users.findFirst({ where: {resetToken: token}});

    if(!result){

      return res.status(400).json({ error: 'Bad request' });
      
    }

    const { id: userId, resetTokenExpiry } = result;

    if(Date.now() > resetTokenExpiry){

      logger.info('/api/reset-password', {ip: ip, success: 'false', message: 'Token expired' } );

      logger.info('/api/reset-password', {ip: ip, success: 'false', message: 'Token expired', productionOnly: true, expiry: resetTokenExpiry, now: Date.now() } );

      return res.status(401).json({ error: 'Token expired' });


    }

    await prisma.users.update( {where: {id: userId}, data: {password: hashedPassword}});

    const { id } = await prisma.users.findFirst( { where: { resetToken: token } } );

    await prisma.users.update( { where: { id: id}, data: {resetToken: null} } )

    logger.info('/api/reset-password', {ip: ip, success: 'true', message: 'Password set', userId: id } );

    return res.json({ message: "Password successfully updated. You can now log in with your new password!" });

  } catch (err) {

    logger.error('/api/reset-password', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      ip: ip,
      requestId: req.id
    });
    return res.status(500).json({ error: 'Unexpected server error' });
  }
});


export default router;
